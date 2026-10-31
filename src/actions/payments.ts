"use server";

import { revalidatePath } from "next/cache";
import { connectDB } from "@/lib/db";
import { Invoice, Payment } from "@/models";
import { assertCustomerAccess, requireAction } from "@/lib/auth/guard";
import { BusinessError, isObjectId, runAction, type ActionResult } from "@/lib/utils-server";
import { paymentSchema, reasonSchema } from "@/validators/billing";
import { recordPayment, voidPayment } from "@/services/payments";
import { addDaysUTC, businessToday, parseDateInput } from "@/lib/dates";

export async function recordPaymentAction(input: unknown): Promise<ActionResult<{ paymentId: string; invoiceStatus: string }>> {
  return runAction(async () => {
    const user = await requireAction("payments.record");
    const data = paymentSchema.parse(input);
    await connectDB();
    const invoice = await Invoice.findById(data.invoiceId).select("customer").lean();
    if (!invoice) throw new BusinessError("Invoice not found.");
    await assertCustomerAccess(user, invoice.customer);
    const paymentDate = parseDateInput(data.paymentDate);
    if (paymentDate > addDaysUTC(businessToday(), 1)) throw new BusinessError("Payment date cannot be in the future.");
    const { payment, invoice: updated } = await recordPayment({
      invoiceId: data.invoiceId,
      amount: data.amount,
      method: data.method,
      paymentDate,
      transactionRef: data.transactionRef || undefined,
      notes: data.notes || undefined,
      actor: user,
    });
    revalidatePath(`/invoices/${data.invoiceId}`);
    revalidatePath("/invoices");
    revalidatePath("/payments");
    return { paymentId: String(payment._id), invoiceStatus: updated.status };
  }, "Payment recorded");
}

export async function voidPaymentAction(id: string, reason?: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireAction("billing.run"); // ADMIN-only financial correction
    if (!isObjectId(id)) throw new BusinessError("Payment not found.");
    await connectDB();
    const payment = await Payment.findById(id).select("customer invoice").lean();
    if (!payment) throw new BusinessError("Payment not found.");
    await assertCustomerAccess(user, payment.customer);
    await voidPayment(id, reasonSchema.parse(reason ?? ""), user);
    revalidatePath("/payments");
    revalidatePath(`/invoices/${payment.invoice}`);
    return undefined;
  }, "Payment voided and invoice balance restored");
}
