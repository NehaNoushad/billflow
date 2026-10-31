export const ROLES = ["ADMIN", "STAFF", "CUSTOMER"] as const;
export type Role = (typeof ROLES)[number];

export const SUBSCRIPTION_STATUSES = ["DRAFT", "QUOTATION", "CONFIRMED", "ACTIVE", "PAUSED", "CLOSED"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Allowed subscription lifecycle transitions: DRAFT → QUOTATION → CONFIRMED → ACTIVE → CLOSED, plus pause/resume. */
export const SUBSCRIPTION_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  DRAFT: ["QUOTATION", "CONFIRMED", "CLOSED"],
  QUOTATION: ["DRAFT", "CONFIRMED", "CLOSED"],
  CONFIRMED: ["ACTIVE", "CLOSED"],
  ACTIVE: ["PAUSED", "CLOSED"],
  PAUSED: ["ACTIVE", "CLOSED"],
  CLOSED: [],
};

export const QUOTATION_STATUSES = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

export const INVOICE_STATUSES = ["DRAFT", "CONFIRMED", "PAID", "CANCELLED"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "UPI", "CARD", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ["COMPLETED", "FAILED", "VOIDED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const TAX_TYPES = ["CGST", "SGST", "IGST", "GST", "VAT", "OTHER"] as const;
export type TaxType = (typeof TAX_TYPES)[number];

export const DISCOUNT_TYPES = ["PERCENTAGE", "FIXED"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const PRODUCT_TYPES = ["SOFTWARE", "SERVICE", "ADD_ON", "SUPPORT", "HARDWARE", "OTHER"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const REQUEST_TYPES = ["PAUSE", "CANCEL", "PLAN_CHANGE", "RESUME"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

export const PAGE_SIZE = 20;

export function humanize(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
