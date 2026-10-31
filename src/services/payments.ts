import { Invoice, Payment } from "@/models";
import { BusinessError } from "@/lib/errors";
import { getSettings, logActivity, nextNumber } from "@/lib/utils-server";
import { formatMoney } from "@/lib/money";
import type { CurrentUser } from "@/lib/auth/guard";
import type { PaymentMethod } from "@/lib/constants";

type RecordPaymentInput = {
  invoiceId: string;
  amount: number; // paise
  method: PaymentMethod;
  paymentDate: Date;
  transactionRef?: string;
  notes?: string;
  simulated?: boolean;
  actor: CurrentUser | null;
};

/**
 * Record a payment against a confirmed invoice.
 * The invoice balance is updated with a single atomic, conditional update so concurrent payments
 * can never overpay an invoice. Status flips to PAID only when the balance reaches exactly zero.
 */
export async function recordPayment(input: RecordPaymentInput) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new BusinessError("Payment amount must be greater than zero.");
  const invoice = await Invoice.findById(input.invoiceId).lean();
  if (!invoice) throw new BusinessError("Invoice not found.");
  if (invoice.status === "DRAFT") throw new BusinessError("Confirm the invoice before recording payments.");
  if (invoice.status === "CANCELLED") throw new BusinessError("Cannot record a payment on a cancelled invoice.");
  if (invoice.status === "PAID" || invoice.amountDue <= 0) throw new BusinessError("This invoice is already fully paid.");
  if (input.amount > invoice.amountDue) throw new BusinessError(`Amount exceeds the outstanding balance of ${formatMoney(invoice.amountDue)}.`);

  const settings = await getSettings();
  if (!settings.allowPartialPayments && input.amount !== invoice.amountDue) {
    throw new BusinessError(`Partial payments are disabled. Pay the full outstanding amount of ${formatMoney(invoice.amountDue)}.`);
  }

  const updated = await Invoice.findOneAndUpdate(
    { _id: invoice._id, status: "CONFIRMED", amountDue: { $gte: input.amount } },
    [
      { $set: { amountPaid: { $add: ["$amountPaid", input.amount] } } },
      { $set: { amountDue: { $subtract: ["$total", "$amountPaid"] } } },
      {
        $set: {
          status: { $cond: [{ $lte: ["$amountDue", 0] }, "PAID", "$status"] },
          paidAt: { $cond: [{ $lte: ["$amountDue", 0] }, "$$NOW", "$paidAt"] },
        },
      },
    ],
    { returnDocument: "after", updatePipeline: true }
  ).lean();
  if (!updated) throw new BusinessError("The invoice balance changed while saving. Refresh and try again.");

  try {
    const payment = await Payment.create({
      number: await nextNumber("PAY"),
      customer: invoice.customer,
      invoice: invoice._id,
      invoiceNumber: invoice.number,
      method: input.method,
      amount: input.amount,
      paymentDate: input.paymentDate,
      transactionRef: input.transactionRef,
      notes: input.notes,
      status: "COMPLETED",
      simulated: !!input.simulated,
      recordedBy: input.actor?.id,
    });
    await logActivity({
      actor: input.actor,
      action: "payment.recorded",
      entityType: "Payment",
      entityId: payment._id,
      entityLabel: payment.number,
      customer: invoice.customer,
      message: `${input.simulated ? "Simulated payment" : "Payment"} of ${formatMoney(input.amount)} recorded for ${invoice.number}${updated.status === "PAID" ? " — invoice fully paid" : ""}`,
    });
    return { payment: payment.toObject(), invoice: updated };
  } catch (err) {
    // Roll the balance back if the payment document could not be written.
    await Invoice.updateOne({ _id: invoice._id }, [
      { $set: { amountPaid: { $subtract: ["$amountPaid", input.amount] } } },
      { $set: { amountDue: { $subtract: ["$total", "$amountPaid"] }, status: "CONFIRMED", paidAt: null } },
    ], { updatePipeline: true });
    throw err;
  }
}

/** Void a payment (admin correction): restores the invoice balance and re-opens it. */
export async function voidPayment(paymentId: string, reason: string, actor: CurrentUser) {
  const payment = await Payment.findOneAndUpdate({ _id: paymentId, status: "COMPLETED" }, { $set: { status: "VOIDED", notes: reason } }, { returnDocument: "after" }).lean();
  if (!payment) throw new BusinessError("Only completed payments can be voided.");
  await Invoice.updateOne({ _id: payment.invoice }, [
    { $set: { amountPaid: { $max: [0, { $subtract: ["$amountPaid", payment.amount] }] } } },
    { $set: { amountDue: { $subtract: ["$total", "$amountPaid"] } } },
    { $set: { status: { $cond: [{ $eq: ["$status", "PAID"] }, "CONFIRMED", "$status"] }, paidAt: null } },
  ], { updatePipeline: true });
  await logActivity({ actor, action: "payment.voided", entityType: "Payment", entityId: payment._id, entityLabel: payment.number, customer: payment.customer, message: `Payment ${payment.number} voided: ${reason}` });
  return payment;
}
