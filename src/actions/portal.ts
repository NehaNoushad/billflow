"use server";

import { revalidatePath } from "next/cache";
import { connectDB } from "@/lib/db";
import { requireAction, type CurrentUser } from "@/lib/auth/guard";
import { AuthError, BusinessError } from "@/lib/errors";
import { businessToday } from "@/lib/dates";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { isObjectId, logActivity, runAction } from "@/lib/utils-server";
import { Customer, Invoice, Subscription, SubscriptionPlan, SubscriptionRequest, User } from "@/models";
import { changePasswordSchema, profileSchema, subscriptionRequestSchema } from "@/validators/portal";
import { planAvailability, renewSubscription } from "@/services/subscriptions";
import { recordPayment } from "@/services/payments";

async function customerUser(): Promise<CurrentUser & { customerId: string }> {
  const user = await requireAction("portal.access");
  if (!user.customerId) throw new AuthError("Your account is not linked to a customer record.");
  await connectDB();
  return user as CurrentUser & { customerId: string };
}

/** Load a subscription only if it belongs to the signed-in customer. */
async function ownSubscription(user: { customerId: string }, id: string) {
  if (!isObjectId(id)) throw new BusinessError("Subscription not found.");
  const sub = await Subscription.findOne({ _id: id, customer: user.customerId }).lean();
  if (!sub) throw new BusinessError("Subscription not found.");
  return sub;
}

function revalidatePortal() {
  revalidatePath("/portal", "layout");
}

export async function submitSubscriptionRequestAction(input: unknown) {
  return runAction(async () => {
    const user = await customerUser();
    const data = subscriptionRequestSchema.parse(input);
    const sub = await ownSubscription(user, data.subscriptionId);
    const rules = sub.planSnapshot ?? {};

    if (await SubscriptionRequest.exists({ subscription: sub._id, status: "PENDING" })) throw new BusinessError("There is already a pending request for this subscription.");
    if (data.type === "PAUSE") {
      if (sub.status !== "ACTIVE") throw new BusinessError("Only active subscriptions can be paused.");
      if (rules.allowPause === false) throw new BusinessError("Your plan does not allow pausing.");
    }
    if (data.type === "RESUME" && sub.status !== "PAUSED") throw new BusinessError("Only paused subscriptions can be resumed.");
    if (data.type === "CANCEL") {
      if (!["ACTIVE", "PAUSED"].includes(sub.status)) throw new BusinessError("This subscription cannot be cancelled.");
      if (rules.allowEarlyClose === false) throw new BusinessError("Your plan does not allow early cancellation. It will end on its expiry date.");
    }
    if (data.type === "PLAN_CHANGE") {
      if (sub.status !== "ACTIVE") throw new BusinessError("Plan changes are available for active subscriptions.");
      if (String(sub.plan) === data.targetPlan) throw new BusinessError("You are already on this plan.");
      const plan = await SubscriptionPlan.findById(data.targetPlan).lean();
      if (!plan) throw new BusinessError("Plan not found.");
      const unavailable = planAvailability(plan);
      if (unavailable) throw new BusinessError(unavailable);
    }

    const req = await SubscriptionRequest.create({ subscription: sub._id, customer: user.customerId, type: data.type, targetPlan: data.type === "PLAN_CHANGE" ? data.targetPlan : undefined, message: data.message || undefined });
    await logActivity({ actor: user, action: "subscription.request", entityType: "SubscriptionRequest", entityId: req._id, entityLabel: sub.number, customer: user.customerId, message: `${user.name} requested ${data.type.replace("_", " ").toLowerCase()} for ${sub.number}` });
    revalidatePortal();
    return undefined;
  }, "Request sent. Our team will review it shortly.");
}

export async function withdrawRequestAction(requestId: string) {
  return runAction(async () => {
    const user = await customerUser();
    if (!isObjectId(requestId)) throw new BusinessError("Request not found.");
    const res = await SubscriptionRequest.updateOne({ _id: requestId, customer: user.customerId, status: "PENDING" }, { $set: { status: "REJECTED", resolvedAt: new Date(), resolutionNote: "Withdrawn by customer" } });
    if (res.modifiedCount === 0) throw new BusinessError("Only pending requests can be withdrawn.");
    revalidatePortal();
    return undefined;
  }, "Request withdrawn");
}

export async function renewMySubscriptionAction(subscriptionId: string) {
  return runAction(async () => {
    const user = await customerUser();
    const sub = await ownSubscription(user, subscriptionId);
    if (sub.status !== "ACTIVE") throw new BusinessError("Only active subscriptions can be renewed.");
    await renewSubscription(String(sub._id), user);
    revalidatePortal();
    return undefined;
  }, "Subscription renewed for another term");
}

/** Demo payment: records a simulated card payment. No real money moves and the record is flagged `simulated`. */
export async function paySimulatedAction(invoiceId: string) {
  return runAction(async () => {
    const user = await customerUser();
    if (!isObjectId(invoiceId)) throw new BusinessError("Invoice not found.");
    const invoice = await Invoice.findOne({ _id: invoiceId, customer: user.customerId, status: { $ne: "DRAFT" } }).lean();
    if (!invoice) throw new BusinessError("Invoice not found.");
    if (invoice.status !== "CONFIRMED" || invoice.amountDue <= 0) throw new BusinessError("This invoice has nothing left to pay.");
    await recordPayment({
      invoiceId: String(invoice._id),
      amount: invoice.amountDue,
      method: "CARD",
      paymentDate: businessToday(),
      transactionRef: `SIM-${Date.now().toString(36).toUpperCase()}`,
      notes: "Simulated online payment from the customer portal (demo — no real money collected)",
      simulated: true,
      actor: user,
    });
    revalidatePortal();
    return undefined;
  }, "Demo payment recorded — no real money was collected");
}

export async function updateProfileAction(input: unknown) {
  return runAction(async () => {
    const user = await customerUser();
    const data = profileSchema.parse(input);
    await Customer.updateOne(
      { _id: user.customerId },
      { $set: { name: data.name, phone: data.phone || undefined, companyName: data.companyName || undefined, taxId: data.taxId || undefined, billingAddress: { ...data.billingAddress, country: data.billingAddress.country || "India" } } }
    );
    await User.updateOne({ _id: user.id }, { $set: { name: data.name } });
    await logActivity({ actor: user, action: "customer.profileUpdated", entityType: "Customer", entityId: user.customerId, customer: user.customerId, message: `${data.name} updated their profile` });
    revalidatePortal();
    return undefined;
  }, "Profile updated");
}

export async function changePasswordAction(input: unknown) {
  return runAction(async () => {
    const user = await customerUser();
    const data = changePasswordSchema.parse(input);
    const record = await User.findById(user.id).select("+passwordHash").lean();
    if (!record || !(await verifyPassword(data.currentPassword, record.passwordHash))) throw new BusinessError("Your current password is incorrect.");
    await User.updateOne({ _id: user.id }, { $set: { passwordHash: await hashPassword(data.password) } });
    await logActivity({ actor: user, action: "user.passwordChanged", entityType: "User", entityId: user.id, customer: user.customerId, message: `${user.name} changed their password` });
    return undefined;
  }, "Password changed");
}
