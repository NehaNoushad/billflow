"use server";

import { revalidatePath } from "next/cache";
import { connectDB } from "@/lib/db";
import { Subscription, SubscriptionPlan, SubscriptionRequest } from "@/models";
import { subscriptionSchema } from "@/validators/sales";
import { assertCustomerAccess, requireAction, type CurrentUser } from "@/lib/auth/guard";
import { BusinessError, isObjectId, logActivity, runAction, type ActionResult } from "@/lib/utils-server";
import { businessToday, parseDateInput } from "@/lib/dates";
import type { SubscriptionStatus } from "@/lib/constants";
import type { LineInput } from "@/lib/billing/calc";
import { buildSalesLines, parseManualDiscount } from "@/services/quotations";
import { createSubscription, renewSubscription, transitionSubscription, updateSubscriptionLines } from "@/services/subscriptions";

async function loadSub(user: CurrentUser, id: string) {
  if (!isObjectId(id)) throw new BusinessError("Invalid subscription.");
  await connectDB();
  const sub = await Subscription.findById(id).lean();
  if (!sub) throw new BusinessError("Subscription not found.");
  await assertCustomerAccess(user, sub.customer);
  return sub;
}

function revalidateSub(id?: string) {
  revalidatePath("/subscriptions");
  if (id) revalidatePath(`/subscriptions/${id}`);
}

export async function saveSubscriptionAction(id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await requireAction("subscriptions.manage");
    const data = subscriptionSchema.parse(input);
    await connectDB();
    await assertCustomerAccess(user, data.customer);
    const lines = await buildSalesLines(data.lines, data.plan);
    const manual = parseManualDiscount(data.manualDiscount);
    const startDate = parseDateInput(data.startDate);

    if (id) {
      const sub = await loadSub(user, id);
      if (String(sub.plan) !== data.plan || String(sub.customer) !== data.customer) throw new BusinessError("Customer and plan cannot be changed after creation. Create a new subscription instead.");
      const plan = await SubscriptionPlan.findById(data.plan).lean();
      if (plan && data.lines.some((l) => l.quantity < (plan.minQuantity ?? 1))) throw new BusinessError(`This plan requires a minimum quantity of ${plan.minQuantity} per product.`);
      await updateSubscriptionLines(id, lines, manual, startDate, data.paymentTermsDays, data.notes || undefined);
      await logActivity({ actor: user, action: "subscription.updated", entityType: "Subscription", entityId: sub._id, entityLabel: sub.number, customer: sub.customer, message: `Subscription ${sub.number} updated` });
      revalidateSub(id);
      return { id };
    }
    const sub = await createSubscription({
      customerId: data.customer,
      planId: data.plan,
      lines,
      startDate,
      paymentTermsDays: data.paymentTermsDays,
      manualDiscount: manual,
      status: data.status,
      notes: data.notes || undefined,
      actor: user,
    });
    revalidateSub();
    return { id: String(sub._id) };
  }, id ? "Subscription updated" : "Subscription created");
}

const MESSAGES: Partial<Record<SubscriptionStatus, string>> = {
  QUOTATION: "Subscription moved to quotation stage",
  CONFIRMED: "Subscription confirmed",
  ACTIVE: "Subscription is now active",
  PAUSED: "Subscription paused — billing is on hold",
  CLOSED: "Subscription closed",
};

export async function transitionSubscriptionAction(id: string, to: SubscriptionStatus, note?: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireAction("subscriptions.manage");
    const sub = await loadSub(user, id);
    if (to === "CLOSED" && !["DRAFT", "QUOTATION", "CONFIRMED"].includes(sub.status) && !note?.trim()) throw new BusinessError("Please give a reason for closing.");
    await transitionSubscription(id, to, { actor: user, note: note?.trim() || undefined });
    revalidateSub(id);
  }, MESSAGES[to] ?? "Subscription updated");
}

/** Admin override: close even when the plan forbids early closure. */
export async function forceCloseSubscriptionAction(id: string, reason?: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireAction("settings.manage");
    await loadSub(user, id);
    if (!reason?.trim()) throw new BusinessError("Please give a reason for the override.");
    await transitionSubscription(id, "CLOSED", { actor: user, note: `Admin override: ${reason.trim()}`, force: true });
    revalidateSub(id);
  }, "Subscription closed (admin override)");
}

export async function renewSubscriptionAction(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireAction("subscriptions.manage");
    await loadSub(user, id);
    await renewSubscription(id, user);
    revalidateSub(id);
  }, "Subscription renewed for another term");
}

export async function resolveRequestAction(requestId: string, approve: boolean, note?: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireAction("subscriptions.manage");
    if (!isObjectId(requestId)) throw new BusinessError("Invalid request.");
    await connectDB();
    const req = await SubscriptionRequest.findById(requestId).lean();
    if (!req) throw new BusinessError("Request not found.");
    if (req.status !== "PENDING") throw new BusinessError("This request has already been resolved.");
    const sub = await loadSub(user, String(req.subscription));
    const resolutionNote = note?.trim() || undefined;

    if (approve) {
      const reqNote = `Customer request${req.message ? `: ${req.message}` : ""}`;
      const force = user.role === "ADMIN";
      switch (req.type) {
        case "PAUSE":
          await transitionSubscription(String(sub._id), "PAUSED", { actor: user, note: reqNote });
          break;
        case "RESUME":
          await transitionSubscription(String(sub._id), "ACTIVE", { actor: user, note: reqNote });
          break;
        case "CANCEL":
          await transitionSubscription(String(sub._id), "CLOSED", { actor: user, note: reqNote, force });
          break;
        case "PLAN_CHANGE": {
          if (!req.targetPlan) throw new BusinessError("The request has no target plan.");
          const productLines = (sub.lines as unknown as LineInput[]).filter((l) => l.product);
          const lines = await buildSalesLines(
            productLines.map((l) => ({ product: String(l.product), variant: l.variant ? String(l.variant) : undefined, quantity: l.quantity })),
            String(req.targetPlan)
          );
          const created = await createSubscription({
            customerId: String(sub.customer),
            planId: String(req.targetPlan),
            lines,
            startDate: businessToday(),
            paymentTermsDays: sub.paymentTermsDays ?? 15,
            status: "CONFIRMED",
            notes: `Plan change from ${sub.number}`,
            actor: user,
          });
          await transitionSubscription(String(sub._id), "CLOSED", { actor: user, note: `Plan changed — replaced by ${created.number}`, force: true });
          break;
        }
      }
    }
    await SubscriptionRequest.updateOne(
      { _id: requestId, status: "PENDING" },
      { $set: { status: approve ? "APPROVED" : "REJECTED", resolvedBy: user.id, resolvedAt: new Date(), resolutionNote } }
    );
    await logActivity({ actor: user, action: `request.${approve ? "approved" : "rejected"}`, entityType: "Subscription", entityId: sub._id, entityLabel: sub.number, customer: sub.customer, message: `${req.type.replace("_", " ").toLowerCase()} request for ${sub.number} ${approve ? "approved" : "rejected"}${resolutionNote ? ` (${resolutionNote})` : ""}` });
    revalidateSub(String(sub._id));
  }, approve ? "Request approved" : "Request rejected");
}
