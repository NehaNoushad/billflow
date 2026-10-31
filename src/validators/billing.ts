import { z } from "zod";
import { PAYMENT_METHODS } from "@/lib/constants";
import { dateString, intField, lineRequestSchema, manualDiscountSchema, moneyField, objectId } from "./common";

export const manualInvoiceSchema = z.object({
  customer: objectId,
  invoiceDate: dateString,
  paymentTermsDays: intField("Payment terms", 0).max(365, "Payment terms cannot exceed 365 days"),
  lines: z.array(lineRequestSchema).min(1, "Add at least one product line"),
  manualDiscount: manualDiscountSchema,
  notes: z.string().max(1000).optional(),
  confirm: z.boolean().optional(),
});
export type ManualInvoiceInput = z.input<typeof manualInvoiceSchema>;

export const paymentSchema = z.object({
  invoiceId: objectId,
  amount: moneyField("Amount"),
  method: z.enum(PAYMENT_METHODS),
  paymentDate: dateString,
  transactionRef: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
});
export type PaymentInput = z.input<typeof paymentSchema>;

export const billingRunSchema = z.object({ asOf: dateString });

export const reasonSchema = z.string().trim().min(3, "Please give a reason (at least 3 characters)").max(300);
