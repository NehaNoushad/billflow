import { Types } from "mongoose";
import { Customer, Invoice, InvoiceLine, Payment } from "@/models";
import { computeTotals, type DiscountRule, type LineInput, type ManualDiscount } from "@/lib/billing/calc";
import { addDaysUTC, businessToday } from "@/lib/dates";
import { BusinessError } from "@/lib/errors";
import { logActivity, nextNumber } from "@/lib/utils-server";
import type { CurrentUser } from "@/lib/auth/guard";
import { consumeDiscountUsage, releaseDiscountUsage } from "./pricing";

export function formatAddress(a?: { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; postalCode?: string | null; country?: string | null } | null) {
  if (!a) return "";
  return [a.line1, a.line2, [a.city, a.state, a.postalCode].filter(Boolean).join(" "), a.country].filter(Boolean).join(", ");
}

type CreateInvoiceInput = {
  customerId: string;
  lines: LineInput[];
  discountRules?: DiscountRule[];
  manualDiscount?: ManualDiscount | null;
  invoiceDate?: Date;
  paymentTermsDays: number;
  status: "DRAFT" | "CONFIRMED";
  source: "BILLING_ENGINE" | "MANUAL";
  subscription?: { id: string; number: string };
  periodStart?: Date;
  periodEnd?: Date;
  idempotencyKey?: string;
  billingExecution?: string;
  notes?: string;
  actor?: CurrentUser | null;
};

/**
 * Create an invoice and its InvoiceLine documents from line snapshots.
 * Discount usage is consumed atomically; on any failure the invoice is rolled back (compensating delete)
 * so no half-written invoice remains. Throws a Mongo E11000 error if idempotencyKey already exists.
 */
export async function createInvoice(input: CreateInvoiceInput) {
  const customer = await Customer.findById(input.customerId).lean();
  if (!customer) throw new BusinessError("Customer not found.");
  if (input.lines.length === 0) throw new BusinessError("An invoice needs at least one line.");

  const invoiceDate = input.invoiceDate ?? businessToday();
  const ctx = { on: invoiceDate, subscriptionId: input.subscription?.id };
  let rules = input.discountRules ?? [];
  let totals = computeTotals(input.lines, rules, ctx, input.manualDiscount);

  // Reserve discount usage; if a limited discount ran out concurrently, recompute without it.
  let consumed: string[] = [];
  const wanted = totals.discounts.map((d) => d.discount).filter(Boolean) as string[];
  if (wanted.length) {
    const exhausted = await consumeDiscountUsage(wanted);
    consumed = wanted.filter((id) => !exhausted.includes(id));
    if (exhausted.length) {
      rules = rules.filter((r) => !exhausted.includes(r._id));
      totals = computeTotals(input.lines, rules, ctx, input.manualDiscount);
      const stillWanted = new Set(totals.discounts.map((d) => d.discount).filter(Boolean) as string[]);
      const toRelease = consumed.filter((id) => !stillWanted.has(id));
      await releaseDiscountUsage(toRelease);
      consumed = consumed.filter((id) => stillWanted.has(id));
    }
  }

  let invoiceId: Types.ObjectId | null = null;
  try {
    const number = await nextNumber("INV", invoiceDate);
    const invoice = await Invoice.create({
      number,
      customer: customer._id,
      customerSnapshot: {
        name: customer.name,
        email: customer.email,
        companyName: customer.companyName,
        taxId: customer.taxId,
        address: formatAddress(customer.billingAddress),
      },
      subscription: input.subscription?.id,
      subscriptionNumber: input.subscription?.number,
      source: input.source,
      idempotencyKey: input.idempotencyKey,
      invoiceDate,
      dueDate: addDaysUTC(invoiceDate, input.paymentTermsDays),
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      paymentTermsDays: input.paymentTermsDays,
      discounts: totals.discounts,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      taxTotal: totals.taxTotal,
      taxBreakdown: totals.taxBreakdown,
      total: totals.total,
      amountPaid: 0,
      amountDue: totals.total,
      status: totals.total === 0 && input.status === "CONFIRMED" ? "PAID" : input.status,
      confirmedAt: input.status === "CONFIRMED" ? new Date() : undefined,
      paidAt: totals.total === 0 && input.status === "CONFIRMED" ? new Date() : undefined,
      billingExecution: input.billingExecution,
      notes: input.notes,
      createdBy: input.actor?.id,
    });
    invoiceId = invoice._id;
    await InvoiceLine.insertMany(
      totals.lines.map((l, position) => ({
        invoice: invoice._id,
        position,
        product: l.product,
        productName: l.productName,
        variant: l.variant,
        variantName: l.variantName,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxes: l.taxes,
        subtotal: l.subtotal,
        discountAmount: l.discountAmount,
        taxAmount: l.taxAmount,
        total: l.total,
      }))
    );
    return invoice.toObject();
  } catch (err) {
    await releaseDiscountUsage(consumed);
    if (invoiceId) {
      await InvoiceLine.deleteMany({ invoice: invoiceId });
      await Invoice.deleteOne({ _id: invoiceId });
    }
    throw err;
  }
}

/** Replace a DRAFT invoice's lines and totals (manual invoices only). */
export async function updateDraftInvoice(invoiceId: string, lines: LineInput[], manualDiscount: ManualDiscount | null, paymentTermsDays: number, invoiceDate: Date, notes: string | undefined) {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) throw new BusinessError("Invoice not found.");
  if (invoice.status !== "DRAFT") throw new BusinessError("Only draft invoices can be edited. Confirmed and paid invoices are locked to protect financial records.");
  const totals = computeTotals(lines, [], undefined, manualDiscount);
  await InvoiceLine.deleteMany({ invoice: invoice._id });
  await InvoiceLine.insertMany(totals.lines.map((l, position) => ({ invoice: invoice._id, position, ...l })));
  Object.assign(invoice, {
    invoiceDate,
    dueDate: addDaysUTC(invoiceDate, paymentTermsDays),
    paymentTermsDays,
    discounts: totals.discounts,
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    taxTotal: totals.taxTotal,
    taxBreakdown: totals.taxBreakdown,
    total: totals.total,
    amountDue: totals.total,
    notes,
  });
  await invoice.save();
  return invoice.toObject();
}

export async function confirmInvoice(invoiceId: string, actor: CurrentUser) {
  const invoice = await Invoice.findOneAndUpdate(
    { _id: invoiceId, status: "DRAFT" },
    { $set: { status: "CONFIRMED", confirmedAt: new Date() } },
    { returnDocument: "after" }
  ).lean();
  if (!invoice) throw new BusinessError("Only draft invoices can be confirmed.");
  if (invoice.total === 0) await Invoice.updateOne({ _id: invoice._id }, { $set: { status: "PAID", paidAt: new Date() } });
  await logActivity({ actor, action: "invoice.confirmed", entityType: "Invoice", entityId: invoice._id, entityLabel: invoice.number, customer: invoice.customer, message: `Invoice ${invoice.number} confirmed` });
  return invoice;
}

export async function cancelInvoice(invoiceId: string, reason: string, actor: CurrentUser) {
  const paid = await Payment.countDocuments({ invoice: invoiceId, status: "COMPLETED" });
  if (paid > 0) throw new BusinessError("This invoice has recorded payments and cannot be cancelled. Void the payments first.");
  const invoice = await Invoice.findOneAndUpdate(
    { _id: invoiceId, status: { $in: ["DRAFT", "CONFIRMED"] }, amountPaid: 0 },
    { $set: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason, amountDue: 0 } },
    { returnDocument: "after" }
  ).lean();
  if (!invoice) throw new BusinessError("Only unpaid draft or confirmed invoices can be cancelled.");
  // Give back any limited-use discounts this invoice consumed.
  await releaseDiscountUsage(invoice.discounts.map((d: { discount?: unknown }) => d.discount).filter(Boolean).map(String));
  await logActivity({ actor, action: "invoice.cancelled", entityType: "Invoice", entityId: invoice._id, entityLabel: invoice.number, customer: invoice.customer, message: `Invoice ${invoice.number} cancelled: ${reason}` });
  return invoice;
}

/** Invoices are overdue when confirmed, unpaid, and past their due date. Overdue is derived, never stored. */
export function overdueFilter(today = businessToday()) {
  return { status: "CONFIRMED", amountDue: { $gt: 0 }, dueDate: { $lt: today } };
}

export function isOverdue(inv: { status: string; amountDue: number; dueDate: Date | string }, today = businessToday()) {
  return inv.status === "CONFIRMED" && inv.amountDue > 0 && new Date(inv.dueDate) < today;
}
