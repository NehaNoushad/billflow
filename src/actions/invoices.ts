"use server";

import { revalidatePath } from "next/cache";
import { connectDB } from "@/lib/db";
import { Customer, Invoice, InvoiceLine, Payment } from "@/models";
import { assertCustomerAccess, requireAction } from "@/lib/auth/guard";
import { BusinessError, getSettings, isObjectId, logActivity, runAction, type ActionResult } from "@/lib/utils-server";
import { manualInvoiceSchema, reasonSchema } from "@/validators/billing";
import { buildLineSnapshots } from "@/services/pricing";
import { cancelInvoice, confirmInvoice, createInvoice, updateDraftInvoice } from "@/services/invoices";
import { parseDateInput } from "@/lib/dates";
import { toPaise } from "@/lib/money";
import { emailConfigured, sendEmail } from "@/lib/email";
import { invoicePdf } from "@/lib/pdf";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import type { ManualDiscount } from "@/lib/billing/calc";

function parseManualDiscount(md: { type: "PERCENTAGE" | "FIXED"; value?: string | number; name?: string } | null | undefined): ManualDiscount | null {
  if (!md || md.value === undefined || md.value === "" || Number(md.value) === 0) return null;
  const s = String(md.value).trim();
  if (md.type === "FIXED") {
    try {
      return { name: md.name || "Discount", type: "FIXED", value: toPaise(s) };
    } catch {
      throw new BusinessError("Discount amount is invalid.");
    }
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s) || Number(s) > 100) throw new BusinessError("Discount percentage must be between 0 and 100.");
  const [w, f = ""] = s.split(".");
  return { name: md.name || "Discount", type: "PERCENTAGE", value: Number(w) * 100 + Number((f + "00").slice(0, 2)) };
}

async function linesFromInput(lines: { product: string; variant?: string; quantity: number; unitPrice?: string | number | null }[]) {
  return buildLineSnapshots(
    lines.map((l) => {
      let unitPrice: number | null = null;
      if (l.unitPrice !== undefined && l.unitPrice !== null && String(l.unitPrice).trim() !== "") {
        try {
          unitPrice = toPaise(l.unitPrice);
        } catch {
          throw new BusinessError("A unit price is invalid.");
        }
      }
      return { product: l.product, variant: l.variant, quantity: l.quantity, unitPrice };
    }),
    { allowPriceOverride: true }
  );
}

export async function createManualInvoiceAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await requireAction("invoices.manage");
    const data = manualInvoiceSchema.parse(input);
    await connectDB();
    await assertCustomerAccess(user, data.customer);
    const customer = await Customer.findById(data.customer).lean();
    if (!customer) throw new BusinessError("Customer not found.");
    if (customer.status !== "ACTIVE") throw new BusinessError("Cannot invoice an inactive customer.");
    const lines = await linesFromInput(data.lines);
    const invoice = await createInvoice({
      customerId: data.customer,
      lines,
      manualDiscount: parseManualDiscount(data.manualDiscount),
      invoiceDate: parseDateInput(data.invoiceDate),
      paymentTermsDays: data.paymentTermsDays,
      status: data.confirm ? "CONFIRMED" : "DRAFT",
      source: "MANUAL",
      notes: data.notes,
      actor: user,
    });
    await logActivity({ actor: user, action: "invoice.created", entityType: "Invoice", entityId: invoice._id, entityLabel: invoice.number, customer: invoice.customer, message: `Manual invoice ${invoice.number} created for ${customer.name} (${formatMoney(invoice.total)})${data.confirm ? " and confirmed" : ""}` });
    revalidatePath("/invoices");
    return { id: String(invoice._id) };
  }, "Invoice saved");
}

export async function updateManualInvoiceAction(id: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await requireAction("invoices.manage");
    if (!isObjectId(id)) throw new BusinessError("Invoice not found.");
    const data = manualInvoiceSchema.parse(input);
    await connectDB();
    const existing = await Invoice.findById(id).lean();
    if (!existing) throw new BusinessError("Invoice not found.");
    await assertCustomerAccess(user, existing.customer);
    if (String(existing.customer) !== data.customer) throw new BusinessError("The customer of an existing invoice cannot be changed.");
    const lines = await linesFromInput(data.lines);
    await updateDraftInvoice(id, lines, parseManualDiscount(data.manualDiscount), data.paymentTermsDays, parseDateInput(data.invoiceDate), data.notes);
    await logActivity({ actor: user, action: "invoice.updated", entityType: "Invoice", entityId: existing._id, entityLabel: existing.number, customer: existing.customer, message: `Draft invoice ${existing.number} updated` });
    if (data.confirm) await confirmInvoice(id, user);
    revalidatePath(`/invoices/${id}`);
    return { id };
  }, "Invoice updated");
}

async function loadScoped(id: string) {
  const user = await requireAction("invoices.manage");
  if (!isObjectId(id)) throw new BusinessError("Invoice not found.");
  await connectDB();
  const invoice = await Invoice.findById(id).lean();
  if (!invoice) throw new BusinessError("Invoice not found.");
  await assertCustomerAccess(user, invoice.customer);
  return { user, invoice };
}

export async function confirmInvoiceAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const { user } = await loadScoped(id);
    await confirmInvoice(id, user);
    revalidatePath(`/invoices/${id}`);
    revalidatePath("/invoices");
    return undefined;
  }, "Invoice confirmed");
}

export async function cancelInvoiceAction(id: string, reason?: string): Promise<ActionResult> {
  return runAction(async () => {
    const { user } = await loadScoped(id);
    await cancelInvoice(id, reasonSchema.parse(reason ?? ""), user);
    revalidatePath(`/invoices/${id}`);
    revalidatePath("/invoices");
    return undefined;
  }, "Invoice cancelled");
}

export async function emailInvoiceAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const { user, invoice } = await loadScoped(id);
    if (!emailConfigured()) throw new BusinessError("Email is not configured. Add SMTP settings to enable sending invoices.");
    if (invoice.status === "DRAFT" || invoice.status === "CANCELLED") throw new BusinessError("Only confirmed or paid invoices can be emailed.");
    const to = invoice.customerSnapshot?.email;
    if (!to) throw new BusinessError("The customer has no email address.");
    const [lines, payments, settings] = await Promise.all([
      InvoiceLine.find({ invoice: invoice._id }).sort({ position: 1 }).lean(),
      Payment.find({ invoice: invoice._id }).lean(),
      getSettings(),
    ]);
    const pdf = invoicePdf(invoice as never, lines as never, payments as never, settings);
    const sent = await sendEmail({
      to,
      subject: `Invoice ${invoice.number} from ${settings.companyName}`,
      text: `Hi ${invoice.customerSnapshot?.name ?? ""}, please find invoice ${invoice.number} for ${formatMoney(invoice.total)} attached. Amount due: ${formatMoney(invoice.amountDue)} by ${formatDate(invoice.dueDate)}.`,
      html: `<p>Hi ${invoice.customerSnapshot?.name ?? ""},</p><p>Please find invoice <b>${invoice.number}</b> for <b>${formatMoney(invoice.total)}</b> attached.</p><p>Amount due: <b>${formatMoney(invoice.amountDue)}</b> by ${formatDate(invoice.dueDate)}.</p><p>${settings.invoiceFooter ?? ""}</p>`,
      attachments: [{ filename: `${invoice.number}.pdf`, content: pdf }],
    });
    if (!sent) throw new BusinessError("Email could not be sent.");
    await Invoice.updateOne({ _id: invoice._id }, { $set: { emailedAt: new Date() } });
    await logActivity({ actor: user, action: "invoice.emailed", entityType: "Invoice", entityId: invoice._id, entityLabel: invoice.number, customer: invoice.customer, message: `Invoice ${invoice.number} emailed to ${to}` });
    revalidatePath(`/invoices/${id}`);
    return undefined;
  }, "Invoice emailed");
}
