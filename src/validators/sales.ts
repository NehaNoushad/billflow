import { z } from "zod";
import { dateString, intField, lineRequestSchema, manualDiscountSchema, objectId, optionalObjectId } from "./common";
import { emailSchema } from "./auth";

// Server actions drop `undefined` keys when serializing, so optional ids must be explicitly optional.
const salesLineSchema = lineRequestSchema.extend({ variant: optionalObjectId.optional() });

export const customerSchema = z.object({
  name: z.string().trim().min(2, "Enter the customer name").max(120),
  email: emailSchema,
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  companyName: z.string().trim().max(160).optional().or(z.literal("")),
  line1: z.string().trim().max(200).optional().or(z.literal("")),
  line2: z.string().trim().max(200).optional().or(z.literal("")),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  state: z.string().trim().max(80).optional().or(z.literal("")),
  postalCode: z.string().trim().max(20).optional().or(z.literal("")),
  country: z.string().trim().max(80).optional().or(z.literal("")),
  taxId: z
    .string()
    .trim()
    .toUpperCase()
    .max(20)
    .refine((v) => v === "" || /^[0-9A-Z]{15}$/.test(v), "GSTIN must be 15 letters/digits")
    .optional()
    .or(z.literal("")),
  status: z.enum(["ACTIVE", "INACTIVE"]),
  assignedStaff: optionalObjectId.optional(),
  notes: z.string().max(2000).optional().or(z.literal("")),
});
export type CustomerInput = z.input<typeof customerSchema>;

export const quotationSchema = z.object({
  customer: z.string().regex(/^[a-f\d]{24}$/i, "Select a customer"),
  plan: z.string().regex(/^[a-f\d]{24}$/i, "Select a plan"),
  template: optionalObjectId.optional(),
  quotationDate: dateString,
  validityDays: intField("Validity", 1).max(365, "Validity can be at most 365 days"),
  lines: z.array(salesLineSchema).min(1, "Add at least one product line"),
  manualDiscount: manualDiscountSchema,
  notes: z.string().max(4000).optional().or(z.literal("")),
});
export type QuotationInput = z.input<typeof quotationSchema>;

export const templateSchema = z.object({
  name: z.string().trim().min(2, "Enter a template name").max(120),
  description: z.string().max(500).optional().or(z.literal("")),
  plan: optionalObjectId.optional(),
  validityDays: intField("Validity", 1).max(365),
  lines: z
    .array(z.object({ product: objectId, variant: optionalObjectId.optional(), quantity: intField("Quantity", 1) }))
    .min(1, "Add at least one product line"),
  notes: z.string().max(4000).optional().or(z.literal("")),
});
export type TemplateInput = z.input<typeof templateSchema>;

export const subscriptionSchema = z.object({
  customer: z.string().regex(/^[a-f\d]{24}$/i, "Select a customer"),
  plan: z.string().regex(/^[a-f\d]{24}$/i, "Select a plan"),
  startDate: dateString,
  paymentTermsDays: intField("Payment terms", 0).max(180, "Payment terms can be at most 180 days"),
  lines: z.array(salesLineSchema).min(1, "Add at least one product line"),
  manualDiscount: manualDiscountSchema,
  notes: z.string().max(4000).optional().or(z.literal("")),
  status: z.enum(["DRAFT", "CONFIRMED"]).default("DRAFT"),
});
export type SubscriptionInput = z.input<typeof subscriptionSchema>;
