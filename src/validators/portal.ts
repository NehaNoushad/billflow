import { z } from "zod";
import { objectId, optionalObjectId } from "./common";
import { passwordSchema } from "./auth";

export const subscriptionRequestSchema = z
  .object({
    subscriptionId: objectId,
    type: z.enum(["PAUSE", "CANCEL", "PLAN_CHANGE", "RESUME"]),
    targetPlan: optionalObjectId,
    message: z.string().trim().max(500, "Keep the message under 500 characters").optional(),
  })
  .refine((d) => d.type !== "PLAN_CHANGE" || !!d.targetPlan, { message: "Choose the plan you want to move to", path: ["targetPlan"] });

const opt = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const profileSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(100),
  phone: z
    .string()
    .trim()
    .max(20)
    .regex(/^[+\d][\d\s-]{5,19}$/, "Enter a valid phone number")
    .optional()
    .or(z.literal("")),
  companyName: opt(120),
  taxId: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9]{2}[A-Z0-9]{13}$/, "GSTIN must be 15 characters (e.g. 32AAACL1234F1Z2)")
    .optional()
    .or(z.literal("")),
  billingAddress: z.object({
    line1: opt(120),
    line2: opt(120),
    city: opt(60),
    state: opt(60),
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "PIN code must be 6 digits")
      .optional()
      .or(z.literal("")),
    country: opt(60),
  }),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, { message: "Passwords do not match", path: ["confirmPassword"] })
  .refine((d) => d.password !== d.currentPassword, { message: "Choose a password different from the current one", path: ["password"] });

export type ProfileInput = z.input<typeof profileSchema>;
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;
