"use server";

import { revalidatePath } from "next/cache";
import { connectDB } from "@/lib/db";
import { Customer, Quotation, QuotationTemplate, Subscription, SubscriptionPlan } from "@/models";
import { quotationSchema, templateSchema } from "@/validators/sales";
import { assertCustomerAccess, requireAction, type CurrentUser } from "@/lib/auth/guard";
import { BusinessError, getSettings, isObjectId, logActivity, nextNumber, runAction, type ActionResult } from "@/lib/utils-server";
import { addDaysUTC, businessToday, formatDate, parseDateInput } from "@/lib/dates";
import { computeTotals, type LineInput } from "@/lib/billing/calc";
import { formatMoney } from "@/lib/money";
import { appUrl, sendEmail } from "@/lib/email";
import { loadAutoDiscountRules } from "@/services/pricing";
import { buildSalesLines, expireQuotations, parseManualDiscount } from "@/services/quotations";
import { createSubscription, planAvailability } from "@/services/subscriptions";

function historyEntry(user: CurrentUser, from: string | undefined, to: string, note?: string) {
  return { from, to, at: new Date(), by: user.id, byName: user.name, note };
}

async function loadQuotation(user: CurrentUser, id: string) {
  if (!isObjectId(id)) throw new BusinessError("Invalid quotation.");
  await connectDB();
  await expireQuotations({ _id: id });
  const q = await Quotation.findById(id).lean();
  if (!q) throw new BusinessError("Quotation not found.");
  await assertCustomerAccess(user, q.customer);
  return q;
}

function revalidateQuote(id?: string) {
  revalidatePath("/quotations");
  if (id) revalidatePath(`/quotations/${id}`);
}

export async function saveQuotationAction(id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await requireAction("quotations.manage");
    const data = quotationSchema.parse(input);
    await connectDB();
    await assertCustomerAccess(user, data.customer);
    const [customer, plan] = await Promise.all([Customer.findById(data.customer).lean(), SubscriptionPlan.findById(data.plan).lean()]);
    if (!customer) throw new BusinessError("Customer not found.");
    if (customer.status !== "ACTIVE") throw new BusinessError("This customer is inactive.");
    if (!plan) throw new BusinessError("Plan not found.");
    const unavailable = planAvailability(plan);
    if (unavailable) throw new BusinessError(unavailable);
    if (data.lines.some((l) => l.quantity < (plan.minQuantity ?? 1))) throw new BusinessError(`${plan.name} requires a minimum quantity of ${plan.minQuantity} per product.`);

    const quotationDate = parseDateInput(data.quotationDate);
    const lines = await buildSalesLines(data.lines, data.plan, { allowPriceOverride: true });
    const rules = await loadAutoDiscountRules();
    const totals = computeTotals(lines, rules, { on: quotationDate }, parseManualDiscount(data.manualDiscount));
    const doc = {
      customer: customer._id,
      customerSnapshot: { name: customer.name, email: customer.email, companyName: customer.companyName },
      plan: plan._id,
      planSnapshot: { name: plan.name, billingInterval: plan.billingInterval, basePrice: plan.basePrice, termLength: plan.termLength },
      template: data.template,
      quotationDate,
      validityDays: data.validityDays,
      expiryDate: addDaysUTC(quotationDate, data.validityDays),
      lines: totals.lines,
      discounts: totals.discounts,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      taxTotal: totals.taxTotal,
      total: totals.total,
      notes: data.notes || undefined,
    };

    if (id) {
      const existing = await loadQuotation(user, id);
      if (existing.status !== "DRAFT") throw new BusinessError("Only draft quotations can be edited.");
      await Quotation.updateOne({ _id: id, status: "DRAFT" }, { $set: doc, $push: { history: historyEntry(user, "DRAFT", "DRAFT", "Edited") } });
      revalidateQuote(id);
      return { id };
    }
    const quote = await Quotation.create({ ...doc, number: await nextNumber("QT"), status: "DRAFT", history: [historyEntry(user, undefined, "DRAFT", data.template ? "Created from template" : "Created")], createdBy: user.id });
    await logActivity({ actor: user, action: "quotation.created", entityType: "Quotation", entityId: quote._id, entityLabel: quote.number, customer: customer._id, message: `Quotation ${quote.number} created for ${customer.name} (${formatMoney(quote.total)})` });
    revalidateQuote();
    return { id: String(quote._id) };
  }, id ? "Quotation updated" : "Quotation created");
}

async function setStatus(user: CurrentUser, id: string, from: string[], to: string, note?: string) {
  const q = await loadQuotation(user, id);
  if (q.status === "EXPIRED") throw new BusinessError("This quotation has expired.");
  if (!from.includes(q.status)) throw new BusinessError(`Cannot move a ${q.status.toLowerCase()} quotation to ${to.toLowerCase()}.`);
  const updated = await Quotation.findOneAndUpdate(
    { _id: id, status: q.status },
    { $set: { status: to }, $push: { history: historyEntry(user, q.status, to, note) } },
    { returnDocument: "after" }
  ).lean();
  if (!updated) throw new BusinessError("The quotation was changed by someone else. Refresh and try again.");
  await logActivity({ actor: user, action: `quotation.${to.toLowerCase()}`, entityType: "Quotation", entityId: q._id, entityLabel: q.number, customer: q.customer, message: `Quotation ${q.number}: ${q.status} → ${to}${note ? ` (${note})` : ""}` });
  revalidateQuote(id);
  return updated;
}

export async function sendQuotationAction(id: string): Promise<ActionResult<void>> {
  const res = await runAction(async () => {
    const user = await requireAction("quotations.manage");
    const q = await setStatus(user, id, ["DRAFT"], "SENT");
    return sendEmail({
      to: q.customerSnapshot?.email ?? "",
      subject: `Quotation ${q.number} from ${(await getSettings()).companyName}`,
      text: `Quotation ${q.number} for ${formatMoney(q.total)} is valid until ${formatDate(q.expiryDate)}. Download: ${appUrl()}/api/quotations/${id}/pdf`,
      html: `<p>Hello ${q.customerSnapshot?.name},</p><p>Please find quotation <b>${q.number}</b> for <b>${formatMoney(q.total)}</b>, valid until ${formatDate(q.expiryDate)}.</p>`,
    }).catch(() => false);
  });
  if (!res.ok) return res;
  return { ok: true, message: res.data ? "Quotation emailed to the customer" : "Quotation marked as sent (email is not configured)" };
}

export async function acceptQuotationAction(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireAction("quotations.manage");
    await setStatus(user, id, ["SENT"], "ACCEPTED", "Customer accepted");
  }, "Quotation accepted");
}

export async function rejectQuotationAction(id: string, reason?: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireAction("quotations.manage");
    await setStatus(user, id, ["DRAFT", "SENT"], "REJECTED", reason?.trim() || "Rejected by customer");
  }, "Quotation rejected");
}

export async function convertQuotationAction(id: string): Promise<ActionResult<{ subscriptionId: string }>> {
  return runAction(async () => {
    const user = await requireAction("subscriptions.manage");
    const q = await loadQuotation(user, id);
    if (q.status === "EXPIRED") throw new BusinessError("Expired quotations cannot be converted.");
    if (q.status === "REJECTED") throw new BusinessError("Rejected quotations cannot be converted.");
    if (q.status !== "ACCEPTED") throw new BusinessError("Only accepted quotations can be converted to a subscription.");
    if (q.subscription) throw new BusinessError("This quotation has already been converted.");
    if (!q.plan) throw new BusinessError("The quotation has no plan.");
    const settings = await getSettings();
    // Keep the quoted (possibly negotiated) prices exactly as snapshotted.
    const lines: LineInput[] = (q.lines as unknown as LineInput[]).map((l) => ({
      product: l.product ? String(l.product) : undefined,
      productName: l.productName,
      variant: l.variant ? String(l.variant) : undefined,
      variantName: l.variantName ?? undefined,
      description: l.description ?? undefined,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      costPrice: l.costPrice ?? 0,
      taxes: (l.taxes ?? []).map((t) => ({ tax: t.tax ? String(t.tax) : undefined, name: t.name, type: t.type, rateBps: t.rateBps })),
    }));
    const manual = (q.discounts ?? []).find((d: { type: string }) => d.type === "MANUAL") as { name: string; amount: number } | undefined;
    const today = businessToday();
    const sub = await createSubscription({
      customerId: String(q.customer),
      planId: String(q.plan),
      lines,
      startDate: today,
      paymentTermsDays: settings.defaultPaymentTermsDays ?? 15,
      manualDiscount: manual ? { name: manual.name, type: "FIXED", value: manual.amount } : null,
      status: "CONFIRMED",
      quotationId: id,
      notes: q.notes ?? undefined,
      actor: user,
    });
    // Claim the quotation atomically; undo the subscription if someone converted it first.
    const claimed = await Quotation.findOneAndUpdate(
      { _id: id, status: "ACCEPTED", $or: [{ subscription: null }, { subscription: { $exists: false } }] },
      { $set: { subscription: sub._id }, $push: { history: historyEntry(user, "ACCEPTED", "ACCEPTED", `Converted to subscription ${sub.number}`) } }
    );
    if (!claimed) {
      await Subscription.deleteOne({ _id: sub._id });
      throw new BusinessError("This quotation has already been converted.");
    }
    revalidateQuote(id);
    revalidatePath("/subscriptions");
    return { subscriptionId: String(sub._id) };
  }, "Subscription created from quotation");
}

export async function duplicateQuotationAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await requireAction("quotations.manage");
    const q = await loadQuotation(user, id);
    const today = businessToday();
    const copy = await Quotation.create({
      number: await nextNumber("QT"),
      customer: q.customer,
      customerSnapshot: q.customerSnapshot,
      plan: q.plan,
      planSnapshot: q.planSnapshot,
      template: q.template,
      quotationDate: today,
      validityDays: q.validityDays,
      expiryDate: addDaysUTC(today, q.validityDays ?? 30),
      lines: q.lines,
      discounts: q.discounts,
      subtotal: q.subtotal,
      discountTotal: q.discountTotal,
      taxTotal: q.taxTotal,
      total: q.total,
      notes: q.notes,
      status: "DRAFT",
      history: [historyEntry(user, undefined, "DRAFT", `Duplicated from ${q.number}`)],
      createdBy: user.id,
    });
    revalidateQuote();
    return { id: String(copy._id) };
  }, "Draft copy created");
}

/* ------------------------------------------------------------ Templates */

export async function saveTemplateAction(id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await requireAction("quotations.manage");
    const data = templateSchema.parse(input);
    await connectDB();
    const doc = {
      name: data.name,
      description: data.description || undefined,
      plan: data.plan,
      validityDays: data.validityDays,
      lines: data.lines.map((l) => ({ product: l.product, variant: l.variant, quantity: l.quantity })),
      notes: data.notes || undefined,
    };
    if (id) {
      if (!isObjectId(id)) throw new BusinessError("Invalid template.");
      const res = await QuotationTemplate.updateOne({ _id: id }, { $set: doc });
      if (!res.matchedCount) throw new BusinessError("Template not found.");
      revalidatePath("/quotations/templates");
      return { id };
    }
    const t = await QuotationTemplate.create(doc);
    await logActivity({ actor: user, action: "quotationTemplate.created", entityType: "QuotationTemplate", entityId: t._id, entityLabel: t.name, message: `Quotation template "${t.name}" created` });
    revalidatePath("/quotations/templates");
    return { id: String(t._id) };
  }, id ? "Template updated" : "Template created");
}

export async function deleteTemplateAction(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireAction("quotations.manage");
    if (!isObjectId(id)) throw new BusinessError("Invalid template.");
    await connectDB();
    // Quotations keep their own snapshots, so deleting a template never changes history.
    const t = await QuotationTemplate.findByIdAndDelete(id).lean();
    if (!t) throw new BusinessError("Template not found.");
    await logActivity({ actor: user, action: "quotationTemplate.deleted", entityType: "QuotationTemplate", entityId: t._id, entityLabel: t.name, message: `Quotation template "${t.name}" deleted` });
    revalidatePath("/quotations/templates");
  }, "Template deleted");
}
