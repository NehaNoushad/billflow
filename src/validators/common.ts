import { z } from "zod";
import { toPaise } from "@/lib/money";

/** Rupee amount entered in a form ("1234.50") → validated, converted to integer paise. */
export const moneyField = (label = "Amount") =>
  z
    .union([z.string(), z.number()])
    .transform((v, ctx) => {
      try {
        const p = toPaise(v);
        if (p < 0) throw new Error();
        return p;
      } catch {
        ctx.addIssue({ code: "custom", message: `${label} must be a valid amount with up to 2 decimals` });
        return z.NEVER;
      }
    });

/** Percentage entered as "18" or "2.5" → basis points (1800, 250). */
export const percentField = (label = "Percentage") =>
  z
    .union([z.string(), z.number()])
    .transform((v, ctx) => {
      const s = String(v).trim();
      if (!/^\d+(\.\d{1,2})?$/.test(s) || Number(s) > 100) {
        ctx.addIssue({ code: "custom", message: `${label} must be between 0 and 100 with up to 2 decimals` });
        return z.NEVER;
      }
      const [w, f = ""] = s.split(".");
      return Number(w) * 100 + Number((f + "00").slice(0, 2));
    });

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
export const optionalObjectId = z.union([objectId, z.literal(""), z.null(), z.undefined()]).optional().transform((v) => v || undefined);

export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date");
export const optionalDateString = z.union([dateString, z.literal(""), z.null(), z.undefined()]).optional().transform((v) => v || undefined);

export const intField = (label: string, min = 0) => z.coerce.number({ message: `${label} must be a number` }).int(`${label} must be a whole number`).min(min, `${label} must be at least ${min}`);

export const lineRequestSchema = z.object({
  product: objectId,
  variant: optionalObjectId,
  quantity: intField("Quantity", 1),
  unitPrice: z.union([z.string(), z.number(), z.null(), z.undefined()]).optional(),
});

export const manualDiscountSchema = z
  .object({
    type: z.enum(["PERCENTAGE", "FIXED"]),
    value: z.union([z.string(), z.number()]).optional(),
    name: z.string().max(80).optional(),
  })
  .optional()
  .nullable();
