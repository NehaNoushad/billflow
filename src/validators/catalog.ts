import { z } from "zod";
import { BILLING_INTERVALS } from "@/lib/dates";
import { DISCOUNT_TYPES, PRODUCT_TYPES, TAX_TYPES } from "@/lib/constants";
import { toPaise } from "@/lib/money";
import { intField, moneyField, objectId, optionalDateString, optionalObjectId, percentField } from "./common";

// Forms submit raw string values (zodResolver raw mode); the server parses them with these schemas.

export const variantSchema = z.object({
  _id: optionalObjectId.optional(),
  name: z.string().trim().min(1, "Variant name is required").max(60),
  extraPrice: moneyField("Extra price"),
});

export const productSchema = z
  .object({
    name: z.string().trim().min(2, "Enter a product name").max(120),
    type: z.enum(PRODUCT_TYPES),
    description: z.string().trim().max(2000).optional(),
    salesPrice: moneyField("Sales price"),
    costPrice: moneyField("Cost price"),
    imageUrl: z.union([z.string().trim().url("Enter a valid URL"), z.literal("")]).optional(),
    taxes: z.array(objectId).default([]),
    status: z.enum(["ACTIVE", "ARCHIVED"]),
    variants: z.array(variantSchema).max(30).default([]),
  })
  .refine((d) => new Set(d.variants.map((v) => v.name.toLowerCase())).size === d.variants.length, { message: "Variant names must be unique", path: ["variants"] });

export const planSchema = z
  .object({
    name: z.string().trim().min(2, "Enter a plan name").max(120),
    description: z.string().trim().max(2000).optional(),
    products: z.array(objectId).default([]),
    billingInterval: z.enum(BILLING_INTERVALS as [string, ...string[]]),
    basePrice: moneyField("Plan fee"),
    taxes: z.array(objectId).default([]),
    minQuantity: intField("Minimum quantity", 1),
    termLength: intField("Term length", 1),
    availableFrom: optionalDateString.optional(),
    availableUntil: optionalDateString.optional(),
    autoClose: z.boolean(),
    allowEarlyClose: z.boolean(),
    allowPause: z.boolean(),
    allowRenewal: z.boolean(),
    status: z.enum(["DRAFT", "PUBLISHED"]),
  })
  .refine((d) => !d.availableFrom || !d.availableUntil || d.availableUntil >= d.availableFrom, { message: "End date must be on or after the start date", path: ["availableUntil"] });

export const taxSchema = z.object({
  name: z.string().trim().min(2, "Enter a tax name").max(80),
  rate: percentField("Tax rate"),
  type: z.enum(TAX_TYPES),
  description: z.string().trim().max(500).optional(),
  active: z.boolean(),
});

export const discountSchema = z
  .object({
    name: z.string().trim().min(2, "Enter a discount name").max(120),
    code: z.string().trim().max(30).optional(),
    type: z.enum(DISCOUNT_TYPES),
    value: z.union([z.string(), z.number()]),
    minPurchase: moneyField("Minimum purchase"),
    minQuantity: intField("Minimum quantity", 0),
    applicableProducts: z.array(objectId).default([]),
    applicableSubscriptions: z.array(objectId).default([]),
    startDate: optionalDateString.optional(),
    endDate: optionalDateString.optional(),
    usageLimit: z.union([z.literal(""), z.null(), z.undefined(), intField("Usage limit", 1)]).transform((v) => (v === "" || v == null ? undefined : v)),
    autoApply: z.boolean(),
    active: z.boolean(),
  })
  .refine((d) => !d.startDate || !d.endDate || d.endDate >= d.startDate, { message: "End date must be on or after the start date", path: ["endDate"] })
  .transform((d, ctx) => {
    const raw = String(d.value).trim();
    let value = 0;
    if (d.type === "PERCENTAGE") {
      if (!/^\d+(\.\d{1,2})?$/.test(raw) || Number(raw) <= 0 || Number(raw) > 100) {
        ctx.addIssue({ code: "custom", message: "Percentage must be greater than 0 and at most 100", path: ["value"] });
        return z.NEVER;
      }
      const [w, f = ""] = raw.split(".");
      value = Number(w) * 100 + Number((f + "00").slice(0, 2));
    } else {
      try {
        value = toPaise(raw);
      } catch {
        value = 0;
      }
      if (value <= 0) {
        ctx.addIssue({ code: "custom", message: "Fixed amount must be greater than zero", path: ["value"] });
        return z.NEVER;
      }
    }
    return { ...d, value };
  });

export type ProductFormValues = z.input<typeof productSchema>;
export type PlanFormValues = z.input<typeof planSchema>;
export type TaxFormValues = z.input<typeof taxSchema>;
export type DiscountFormValues = z.input<typeof discountSchema>;
