import { Customer, Subscription, SubscriptionPlan, type SubscriptionDoc } from "@/models";
import { computeTotals, type LineInput, type ManualDiscount } from "@/lib/billing/calc";
import { SUBSCRIPTION_TRANSITIONS, type SubscriptionStatus } from "@/lib/constants";
import { addInterval, businessToday, daysBetween, addDaysUTC, utcDay, type BillingInterval } from "@/lib/dates";
import { BusinessError } from "@/lib/errors";
import { logActivity, nextNumber } from "@/lib/utils-server";
import type { CurrentUser } from "@/lib/auth/guard";

export function canTransition(from: SubscriptionStatus, to: SubscriptionStatus) {
  return SUBSCRIPTION_TRANSITIONS[from].includes(to);
}

/** A plan can be sold only when published and inside its availability window. */
export function planAvailability(plan: { status: string; availableFrom?: Date | null; availableUntil?: Date | null }, on = businessToday()): string | null {
  if (plan.status !== "PUBLISHED") return plan.status === "ARCHIVED" ? "This plan is archived." : "This plan is not published yet.";
  if (plan.availableFrom && utcDay(plan.availableFrom) > on) return "This plan is not available yet.";
  if (plan.availableUntil && utcDay(plan.availableUntil) < on) return "This plan is no longer available.";
  return null;
}

type CreateSubscriptionInput = {
  customerId: string;
  planId: string;
  lines: LineInput[];
  startDate: Date;
  paymentTermsDays: number;
  manualDiscount?: ManualDiscount | null;
  status?: "DRAFT" | "QUOTATION" | "CONFIRMED";
  quotationId?: string;
  notes?: string;
  actor: CurrentUser | null;
  skipAvailabilityCheck?: boolean;
};

export async function createSubscription(input: CreateSubscriptionInput) {
  const [customer, plan] = await Promise.all([Customer.findById(input.customerId).lean(), SubscriptionPlan.findById(input.planId).lean()]);
  if (!customer) throw new BusinessError("Customer not found.");
  if (customer.status !== "ACTIVE") throw new BusinessError("Customer is inactive.");
  if (!plan) throw new BusinessError("Plan not found.");
  if (!input.skipAvailabilityCheck) {
    const unavailable = planAvailability(plan, input.startDate < businessToday() ? businessToday() : input.startDate);
    if (unavailable) throw new BusinessError(unavailable);
  }
  if (input.lines.length === 0) throw new BusinessError("Add at least one product line.");
  const productLines = input.lines.filter((l) => l.product);
  if (productLines.some((l) => l.quantity < (plan.minQuantity ?? 1))) throw new BusinessError(`This plan requires a minimum quantity of ${plan.minQuantity} per product.`);

  const totals = computeTotals(input.lines, [], undefined, input.manualDiscount);
  const interval = plan.billingInterval as BillingInterval;
  const start = utcDay(input.startDate);
  const expiry = addInterval(start, interval, plan.termLength ?? 12, start.getUTCDate());
  const status = input.status ?? "DRAFT";

  const sub = await Subscription.create({
    number: await nextNumber("SUB"),
    customer: customer._id,
    customerSnapshot: { name: customer.name, email: customer.email, companyName: customer.companyName },
    plan: plan._id,
    planSnapshot: {
      name: plan.name,
      basePrice: plan.basePrice,
      termLength: plan.termLength,
      autoClose: plan.autoClose,
      allowEarlyClose: plan.allowEarlyClose,
      allowPause: plan.allowPause,
      allowRenewal: plan.allowRenewal,
    },
    quotation: input.quotationId,
    billingInterval: interval,
    startDate: start,
    expiryDate: expiry,
    nextBillingDate: start,
    billingAnchorDay: start.getUTCDate(),
    paymentTermsDays: input.paymentTermsDays,
    lines: totals.lines,
    manualDiscount: totals.discounts.find((d) => d.type === "MANUAL"),
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    taxTotal: totals.taxTotal,
    total: totals.total,
    status,
    notes: input.notes,
    history: [{ to: status, by: input.actor?.id, byName: input.actor?.name ?? "System", note: input.quotationId ? "Created from quotation" : "Created" }],
    createdBy: input.actor?.id,
  });
  await logActivity({ actor: input.actor, action: "subscription.created", entityType: "Subscription", entityId: sub._id, entityLabel: sub.number, customer: customer._id, message: `Subscription ${sub.number} created for ${customer.name} (${plan.name})` });
  return sub.toObject();
}

/** Recompute lines/totals for a subscription that has not started billing yet. */
export async function updateSubscriptionLines(id: string, lines: LineInput[], manualDiscount: ManualDiscount | null, startDate: Date, paymentTermsDays: number, notes?: string) {
  const sub = await Subscription.findById(id);
  if (!sub) throw new BusinessError("Subscription not found.");
  if (!["DRAFT", "QUOTATION"].includes(sub.status)) throw new BusinessError("Only draft or quotation-stage subscriptions can be edited. Confirmed subscriptions keep their agreed pricing.");
  const totals = computeTotals(lines, [], undefined, manualDiscount);
  const start = utcDay(startDate);
  Object.assign(sub, {
    lines: totals.lines,
    manualDiscount: totals.discounts.find((d) => d.type === "MANUAL") ?? undefined,
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    taxTotal: totals.taxTotal,
    total: totals.total,
    startDate: start,
    nextBillingDate: start,
    billingAnchorDay: start.getUTCDate(),
    expiryDate: addInterval(start, sub.billingInterval as BillingInterval, sub.planSnapshot?.termLength ?? 12, start.getUTCDate()),
    paymentTermsDays,
    notes,
  });
  await sub.save();
  return sub.toObject();
}

type TransitionOptions = { note?: string; actor: CurrentUser | null; asOf?: Date; force?: boolean };

/**
 * Move a subscription to a new status, enforcing the lifecycle graph and the plan's rules.
 * Uses a conditional update on the current status so two concurrent transitions cannot both succeed.
 */
export async function transitionSubscription(id: string, to: SubscriptionStatus, opts: TransitionOptions) {
  const sub = await Subscription.findById(id).lean();
  if (!sub) throw new BusinessError("Subscription not found.");
  const from = sub.status as SubscriptionStatus;
  if (!canTransition(from, to)) throw new BusinessError(`Cannot move a subscription from ${from} to ${to}.`);

  const today = opts.asOf ?? businessToday();
  const set: Record<string, unknown> = { status: to };
  let note = opts.note;

  if (to === "ACTIVE" && from === "CONFIRMED") {
    set.activatedAt = new Date();
    // If activation happens after the planned start, billing begins on the activation date.
    if (utcDay(sub.startDate) < today && !sub.lastBilledAt) {
      set.nextBillingDate = sub.nextBillingDate && utcDay(sub.nextBillingDate) > utcDay(sub.startDate) ? sub.nextBillingDate : sub.startDate;
    }
  }
  if (to === "PAUSED") {
    if (!opts.force && sub.planSnapshot?.allowPause === false) throw new BusinessError("This plan does not allow pausing.");
    set.pausedAt = today;
  }
  if (to === "ACTIVE" && from === "PAUSED") {
    // Paused time is not billed: shift the next billing date and expiry forward by the paused duration.
    const pausedAt = sub.pausedAt ? utcDay(sub.pausedAt) : today;
    const pausedDays = Math.max(0, daysBetween(pausedAt, today));
    if (sub.nextBillingDate) set.nextBillingDate = addDaysUTC(utcDay(sub.nextBillingDate), pausedDays);
    if (sub.expiryDate) set.expiryDate = addDaysUTC(utcDay(sub.expiryDate), pausedDays);
    set.pausedAt = null;
    note = note ?? `Resumed after ${pausedDays} paused day(s); billing shifted forward`;
  }
  if (to === "CLOSED") {
    const atExpiry = sub.expiryDate && utcDay(sub.expiryDate) <= today;
    if (from === "ACTIVE" || from === "PAUSED") {
      if (!atExpiry && !opts.force && sub.planSnapshot?.allowEarlyClose === false) throw new BusinessError("This plan does not allow early closure.");
    }
    set.closedAt = new Date();
    set.closeReason = note ?? (atExpiry ? "Expired" : "Closed early");
    set.nextBillingDate = null;
  }

  const update: Record<string, unknown> = {
    $set: set,
    $push: { history: { from, to, at: new Date(), by: opts.actor?.id, byName: opts.actor?.name ?? "System", note } },
  };
  if (to === "ACTIVE" && from === "PAUSED") {
    (update.$push as Record<string, unknown>).pausePeriods = { from: sub.pausedAt ?? today, to: today };
  }
  const updated = await Subscription.findOneAndUpdate({ _id: id, status: from }, update, { returnDocument: "after" }).lean();
  if (!updated) throw new BusinessError("The subscription was changed by someone else. Refresh and try again.");

  await logActivity({
    actor: opts.actor,
    action: `subscription.${to.toLowerCase()}`,
    entityType: "Subscription",
    entityId: sub._id,
    entityLabel: sub.number,
    customer: sub.customer,
    message: `Subscription ${sub.number}: ${from} → ${to}${note ? ` (${note})` : ""}`,
  });
  return updated;
}

/** Extend a subscription by one more term. Allowed for active/paused subscriptions on renewable plans. */
export async function renewSubscription(id: string, actor: CurrentUser | null) {
  const sub = await Subscription.findById(id).lean();
  if (!sub) throw new BusinessError("Subscription not found.");
  if (sub.planSnapshot?.allowRenewal === false) throw new BusinessError("This plan does not allow renewal.");
  if (!["ACTIVE", "PAUSED"].includes(sub.status)) throw new BusinessError("Only active or paused subscriptions can be renewed.");
  const interval = sub.billingInterval as BillingInterval;
  const currentExpiry = sub.expiryDate ? utcDay(sub.expiryDate) : businessToday();
  const newExpiry = addInterval(currentExpiry, interval, sub.planSnapshot?.termLength ?? 12, sub.billingAnchorDay ?? undefined);
  const updated = await Subscription.findOneAndUpdate(
    { _id: id, status: sub.status },
    {
      $set: { expiryDate: newExpiry },
      $inc: { renewalCount: 1 },
      $push: { history: { from: sub.status, to: sub.status, at: new Date(), by: actor?.id, byName: actor?.name ?? "System", note: `Renewed until ${newExpiry.toISOString().slice(0, 10)}` } },
    },
    { returnDocument: "after" }
  ).lean();
  if (!updated) throw new BusinessError("The subscription was changed by someone else. Refresh and try again.");
  await logActivity({ actor, action: "subscription.renewed", entityType: "Subscription", entityId: sub._id, entityLabel: sub.number, customer: sub.customer, message: `Subscription ${sub.number} renewed until ${newExpiry.toISOString().slice(0, 10)}` });
  return updated;
}

export function monthlyValue(sub: Pick<SubscriptionDoc, "subtotal" | "discountTotal" | "billingInterval">): number {
  // MRR uses net recurring value excluding tax, normalised to a month (integer paise).
  const net = (sub.subtotal ?? 0) - (sub.discountTotal ?? 0);
  switch (sub.billingInterval) {
    case "DAILY":
      return Math.round((net * 365) / 12);
    case "WEEKLY":
      return Math.round((net * 52) / 12);
    case "YEARLY":
      return Math.round(net / 12);
    default:
      return net;
  }
}
