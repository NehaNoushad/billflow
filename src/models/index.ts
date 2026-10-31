import mongoose, { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";
import { DiscountSnapshotSchema, HistoryEntrySchema, LineSnapshotSchema } from "./shared";
import {
  DISCOUNT_TYPES,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PRODUCT_TYPES,
  QUOTATION_STATUSES,
  REQUEST_TYPES,
  ROLES,
  SUBSCRIPTION_STATUSES,
  TAX_TYPES,
} from "@/lib/constants";
import { BILLING_INTERVALS } from "@/lib/dates";

function getModel<T>(name: string, schema: Schema<T>): Model<T> {
  return (models[name] as Model<T>) || model<T>(name, schema);
}

const ts = { timestamps: true } as const;

/* ------------------------------------------------------------------ User */
const UserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true, default: "CUSTOMER" },
    customer: { type: Schema.Types.ObjectId, ref: "Customer" },
    active: { type: Boolean, default: true },
    sessionVersion: { type: Number, default: 0 }, // bump to invalidate existing sessions
    lastLoginAt: { type: Date },
  },
  ts
);
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ role: 1 });
export const User = getModel("User", UserSchema);

const PasswordResetTokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date },
  },
  ts
);
PasswordResetTokenSchema.index({ tokenHash: 1 }, { unique: true });
PasswordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });
export const PasswordResetToken = getModel("PasswordResetToken", PasswordResetTokenSchema);

const RateLimitSchema = new Schema({
  key: { type: String, required: true },
  count: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
});
RateLimitSchema.index({ key: 1 }, { unique: true });
RateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const RateLimit = getModel("RateLimit", RateLimitSchema);

/* -------------------------------------------------------------- Customer */
const CustomerSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    companyName: { type: String, trim: true },
    billingAddress: {
      line1: String,
      line2: String,
      city: String,
      state: String,
      postalCode: String,
      country: { type: String, default: "India" },
    },
    taxId: { type: String, trim: true }, // GSTIN
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE" },
    assignedStaff: { type: Schema.Types.ObjectId, ref: "User" },
    user: { type: Schema.Types.ObjectId, ref: "User" },
    notes: String,
  },
  ts
);
CustomerSchema.index({ email: 1 }, { unique: true });
CustomerSchema.index({ status: 1, createdAt: -1 });
CustomerSchema.index({ assignedStaff: 1 });
CustomerSchema.index({ name: "text", companyName: "text", email: "text" });
export const Customer = getModel("Customer", CustomerSchema);

/* ------------------------------------------------------------------- Tax */
const TaxSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    rateBps: { type: Number, required: true, min: 0, max: 10000 },
    type: { type: String, enum: TAX_TYPES, required: true },
    description: String,
    active: { type: Boolean, default: true },
  },
  ts
);
TaxSchema.index({ name: 1 }, { unique: true });
export const Tax = getModel("Tax", TaxSchema);

/* --------------------------------------------------------------- Product */
const ProductSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: PRODUCT_TYPES, required: true },
    description: String,
    salesPrice: { type: Number, required: true, min: 0 }, // paise
    costPrice: { type: Number, default: 0, min: 0 },
    imageUrl: String,
    taxes: [{ type: Schema.Types.ObjectId, ref: "Tax" }],
    status: { type: String, enum: ["ACTIVE", "ARCHIVED"], default: "ACTIVE" },
  },
  ts
);
ProductSchema.index({ name: 1 });
ProductSchema.index({ status: 1, type: 1 });
export const Product = getModel("Product", ProductSchema);

const ProductVariantSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    name: { type: String, required: true, trim: true },
    extraPrice: { type: Number, default: 0, min: 0 }, // paise added to product salesPrice
    active: { type: Boolean, default: true },
  },
  ts
);
ProductVariantSchema.index({ product: 1, name: 1 }, { unique: true });
export const ProductVariant = getModel("ProductVariant", ProductVariantSchema);

/* ------------------------------------------------------ SubscriptionPlan */
const SubscriptionPlanSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: String,
    products: [{ type: Schema.Types.ObjectId, ref: "Product" }],
    billingInterval: { type: String, enum: BILLING_INTERVALS, required: true },
    basePrice: { type: Number, required: true, min: 0 }, // paise per interval (plan fee, added as its own line)
    taxes: [{ type: Schema.Types.ObjectId, ref: "Tax" }], // taxes applied to the plan fee line
    minQuantity: { type: Number, default: 1, min: 1 },
    availableFrom: { type: Date },
    availableUntil: { type: Date },
    termLength: { type: Number, default: 12, min: 1 }, // number of billing intervals in one term
    autoClose: { type: Boolean, default: true },
    allowEarlyClose: { type: Boolean, default: true },
    allowPause: { type: Boolean, default: true },
    allowRenewal: { type: Boolean, default: true },
    status: { type: String, enum: ["DRAFT", "PUBLISHED", "ARCHIVED"], default: "PUBLISHED" },
  },
  ts
);
SubscriptionPlanSchema.index({ status: 1 });
SubscriptionPlanSchema.index({ name: 1 }, { unique: true });
export const SubscriptionPlan = getModel("SubscriptionPlan", SubscriptionPlanSchema);

/* ------------------------------------------------------------- Discount */
const DiscountSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, trim: true, uppercase: true },
    type: { type: String, enum: DISCOUNT_TYPES, required: true },
    value: { type: Number, required: true, min: 0 }, // bps for PERCENTAGE, paise for FIXED
    minPurchase: { type: Number, default: 0, min: 0 }, // paise
    minQuantity: { type: Number, default: 0, min: 0 },
    applicableProducts: [{ type: Schema.Types.ObjectId, ref: "Product" }], // empty = all products
    applicableSubscriptions: [{ type: Schema.Types.ObjectId, ref: "Subscription" }], // empty = all
    startDate: { type: Date },
    endDate: { type: Date },
    usageLimit: { type: Number, min: 0 }, // undefined = unlimited
    usageCount: { type: Number, default: 0, min: 0 },
    autoApply: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
  },
  ts
);
DiscountSchema.index({ active: 1, endDate: 1 });
export const Discount = getModel("Discount", DiscountSchema);

/* ---------------------------------------------------- QuotationTemplate */
const QuotationTemplateSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: String,
    plan: { type: Schema.Types.ObjectId, ref: "SubscriptionPlan" },
    validityDays: { type: Number, default: 30, min: 1 },
    lines: [
      {
        _id: false,
        product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
        variant: { type: Schema.Types.ObjectId, ref: "ProductVariant" },
        quantity: { type: Number, default: 1, min: 1 },
      },
    ],
    notes: String,
    active: { type: Boolean, default: true },
  },
  ts
);
export const QuotationTemplate = getModel("QuotationTemplate", QuotationTemplateSchema);

/* ------------------------------------------------------------ Quotation */
const QuotationSchema = new Schema(
  {
    number: { type: String, required: true },
    customer: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    customerSnapshot: { name: String, email: String, companyName: String },
    plan: { type: Schema.Types.ObjectId, ref: "SubscriptionPlan" },
    planSnapshot: { name: String, billingInterval: String, basePrice: Number, termLength: Number },
    template: { type: Schema.Types.ObjectId, ref: "QuotationTemplate" },
    quotationDate: { type: Date, required: true },
    validityDays: { type: Number, default: 30 },
    expiryDate: { type: Date, required: true },
    lines: { type: [LineSnapshotSchema], default: [] },
    discounts: { type: [DiscountSnapshotSchema], default: [] },
    subtotal: { type: Number, default: 0 },
    discountTotal: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    notes: String,
    status: { type: String, enum: QUOTATION_STATUSES, default: "DRAFT" },
    subscription: { type: Schema.Types.ObjectId, ref: "Subscription" },
    history: { type: [HistoryEntrySchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  ts
);
QuotationSchema.index({ number: 1 }, { unique: true });
QuotationSchema.index({ customer: 1, createdAt: -1 });
QuotationSchema.index({ status: 1, expiryDate: 1 });
export const Quotation = getModel("Quotation", QuotationSchema);

/* --------------------------------------------------------- Subscription */
const SubscriptionSchema = new Schema(
  {
    number: { type: String, required: true },
    customer: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    customerSnapshot: { name: String, email: String, companyName: String },
    plan: { type: Schema.Types.ObjectId, ref: "SubscriptionPlan", required: true },
    planSnapshot: {
      name: String,
      basePrice: Number,
      termLength: Number,
      autoClose: Boolean,
      allowEarlyClose: Boolean,
      allowPause: Boolean,
      allowRenewal: Boolean,
    },
    quotation: { type: Schema.Types.ObjectId, ref: "Quotation" },
    billingInterval: { type: String, enum: BILLING_INTERVALS, required: true },
    startDate: { type: Date, required: true },
    expiryDate: { type: Date },
    nextBillingDate: { type: Date },
    billingAnchorDay: { type: Number, min: 1, max: 31 },
    paymentTermsDays: { type: Number, default: 15, min: 0 },
    lines: { type: [LineSnapshotSchema], default: [] },
    manualDiscount: { type: DiscountSnapshotSchema },
    subtotal: { type: Number, default: 0 }, // per billing period
    discountTotal: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    status: { type: String, enum: SUBSCRIPTION_STATUSES, default: "DRAFT" },
    activatedAt: Date,
    pausedAt: Date,
    pausePeriods: [{ _id: false, from: Date, to: Date }],
    closedAt: Date,
    closeReason: String,
    renewalCount: { type: Number, default: 0 },
    lastBilledAt: Date,
    notes: String,
    history: { type: [HistoryEntrySchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  ts
);
SubscriptionSchema.index({ number: 1 }, { unique: true });
SubscriptionSchema.index({ status: 1, nextBillingDate: 1 });
SubscriptionSchema.index({ customer: 1, status: 1 });
SubscriptionSchema.index({ status: 1, expiryDate: 1 });
SubscriptionSchema.index({ plan: 1 });
export const Subscription = getModel("Subscription", SubscriptionSchema);

const SubscriptionRequestSchema = new Schema(
  {
    subscription: { type: Schema.Types.ObjectId, ref: "Subscription", required: true },
    customer: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    type: { type: String, enum: REQUEST_TYPES, required: true },
    targetPlan: { type: Schema.Types.ObjectId, ref: "SubscriptionPlan" },
    message: String,
    status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED"], default: "PENDING" },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    resolvedAt: Date,
    resolutionNote: String,
  },
  ts
);
SubscriptionRequestSchema.index({ status: 1, createdAt: -1 });
SubscriptionRequestSchema.index({ customer: 1 });
export const SubscriptionRequest = getModel("SubscriptionRequest", SubscriptionRequestSchema);

/* -------------------------------------------------------------- Invoice */
const InvoiceSchema = new Schema(
  {
    number: { type: String, required: true },
    customer: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    customerSnapshot: { name: String, email: String, companyName: String, taxId: String, address: String },
    subscription: { type: Schema.Types.ObjectId, ref: "Subscription" },
    subscriptionNumber: String,
    source: { type: String, enum: ["BILLING_ENGINE", "MANUAL"], default: "MANUAL" },
    // Unique per subscription billing period: prevents duplicate recurring invoices.
    idempotencyKey: { type: String },
    invoiceDate: { type: Date, required: true },
    dueDate: { type: Date, required: true },
    periodStart: Date,
    periodEnd: Date,
    paymentTermsDays: { type: Number, default: 15 },
    discounts: { type: [DiscountSnapshotSchema], default: [] },
    subtotal: { type: Number, required: true, default: 0 },
    discountTotal: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    taxBreakdown: [{ _id: false, name: String, type: { type: String }, rateBps: Number, amount: Number }],
    total: { type: Number, required: true, default: 0 },
    amountPaid: { type: Number, default: 0, min: 0 },
    amountDue: { type: Number, default: 0 },
    status: { type: String, enum: INVOICE_STATUSES, default: "DRAFT" },
    confirmedAt: Date,
    paidAt: Date,
    cancelledAt: Date,
    cancelReason: String,
    emailedAt: Date,
    billingExecution: { type: Schema.Types.ObjectId, ref: "BillingExecution" },
    notes: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  ts
);
InvoiceSchema.index({ number: 1 }, { unique: true });
InvoiceSchema.index({ idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } });
InvoiceSchema.index({ customer: 1, invoiceDate: -1 });
InvoiceSchema.index({ subscription: 1, periodStart: 1 });
InvoiceSchema.index({ status: 1, dueDate: 1 });
InvoiceSchema.index({ invoiceDate: -1 });
export const Invoice = getModel("Invoice", InvoiceSchema);

const InvoiceLineSchema = new Schema(
  {
    invoice: { type: Schema.Types.ObjectId, ref: "Invoice", required: true },
    position: { type: Number, default: 0 },
    product: { type: Schema.Types.ObjectId, ref: "Product" },
    productName: { type: String, required: true },
    variant: { type: Schema.Types.ObjectId, ref: "ProductVariant" },
    variantName: String,
    description: String,
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    taxes: [{ _id: false, tax: { type: Schema.Types.ObjectId, ref: "Tax" }, name: String, type: { type: String }, rateBps: Number, amount: Number }],
    subtotal: { type: Number, required: true },
    discountAmount: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    total: { type: Number, required: true },
  },
  ts
);
InvoiceLineSchema.index({ invoice: 1, position: 1 });
InvoiceLineSchema.index({ product: 1 });
export const InvoiceLine = getModel("InvoiceLine", InvoiceLineSchema);

/* -------------------------------------------------------------- Payment */
const PaymentSchema = new Schema(
  {
    number: { type: String, required: true },
    customer: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    invoice: { type: Schema.Types.ObjectId, ref: "Invoice", required: true },
    invoiceNumber: String,
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    amount: { type: Number, required: true, min: 1 },
    paymentDate: { type: Date, required: true },
    transactionRef: String,
    notes: String,
    status: { type: String, enum: PAYMENT_STATUSES, default: "COMPLETED" },
    simulated: { type: Boolean, default: false }, // true when recorded through the demo "pay online" flow
    recordedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  ts
);
PaymentSchema.index({ number: 1 }, { unique: true });
PaymentSchema.index({ invoice: 1 });
PaymentSchema.index({ customer: 1, paymentDate: -1 });
PaymentSchema.index({ paymentDate: -1, status: 1 });
export const Payment = getModel("Payment", PaymentSchema);

/* ---------------------------------------------------------- ActivityLog */
const ActivityLogSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: "User" },
    actorName: { type: String, default: "System" },
    action: { type: String, required: true }, // e.g. invoice.created
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId },
    entityLabel: String,
    customer: { type: Schema.Types.ObjectId, ref: "Customer" },
    message: { type: String, required: true },
    meta: Schema.Types.Mixed,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
ActivityLogSchema.index({ createdAt: -1 });
ActivityLogSchema.index({ entityType: 1, entityId: 1 });
ActivityLogSchema.index({ customer: 1, createdAt: -1 });
export const ActivityLog = getModel("ActivityLog", ActivityLogSchema);

/* ----------------------------------------------------- BillingExecution */
const BillingExecutionSchema = new Schema(
  {
    trigger: { type: String, enum: ["CRON", "MANUAL", "SEED"], required: true },
    triggeredBy: { type: Schema.Types.ObjectId, ref: "User" },
    triggeredByName: String,
    asOf: { type: Date, required: true },
    status: { type: String, enum: ["RUNNING", "COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED"], default: "RUNNING" },
    startedAt: { type: Date, default: Date.now },
    finishedAt: Date,
    processed: { type: Number, default: 0 },
    generated: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    autoClosed: { type: Number, default: 0 },
    totalValue: { type: Number, default: 0 },
    invoices: [{ type: Schema.Types.ObjectId, ref: "Invoice" }],
    entries: [
      {
        _id: false,
        subscription: { type: Schema.Types.ObjectId, ref: "Subscription" },
        subscriptionNumber: String,
        outcome: { type: String, enum: ["GENERATED", "SKIPPED", "FAILED", "CLOSED"] },
        invoice: { type: Schema.Types.ObjectId, ref: "Invoice" },
        invoiceNumber: String,
        periodStart: Date,
        amount: Number,
        message: String,
      },
    ],
  },
  ts
);
BillingExecutionSchema.index({ startedAt: -1 });
export const BillingExecution = getModel("BillingExecution", BillingExecutionSchema);

/* ------------------------------------------------------- RevenueInsight */
const RevenueInsightSchema = new Schema(
  {
    generatedAt: { type: Date, default: Date.now },
    generatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    scope: { type: String, default: "ALL" },
    aiProvider: { type: String, default: "rules" },
    summary: String,
    recommendations: [String],
    metrics: Schema.Types.Mixed,
    findings: [
      {
        _id: false,
        code: String,
        severity: { type: String, enum: ["CRITICAL", "WARNING", "INFO"] },
        title: String,
        detail: String,
        amount: Number,
        records: [{ _id: false, type: { type: String }, id: String, label: String, href: String }],
      },
    ],
  },
  ts
);
RevenueInsightSchema.index({ generatedAt: -1 });
export const RevenueInsight = getModel("RevenueInsight", RevenueInsightSchema);

/* ------------------------------------------------------ Counter / Setting */
const CounterSchema = new Schema({ _id: { type: String, required: true }, seq: { type: Number, default: 0 } });
export const Counter = getModel("Counter", CounterSchema);

const SettingSchema = new Schema(
  {
    _id: { type: String, default: "global" },
    companyName: { type: String, default: "Brightloop Software Pvt Ltd" },
    companyEmail: { type: String, default: "billing@brightloop.example" },
    companyPhone: String,
    companyAddress: { type: String, default: "Infopark, Kochi, Kerala 682042, India" },
    companyTaxId: String,
    defaultPaymentTermsDays: { type: Number, default: 15 },
    autoConfirmInvoices: { type: Boolean, default: true },
    allowPartialPayments: { type: Boolean, default: true },
    chargeDuringPause: { type: Boolean, default: false },
    invoiceFooter: { type: String, default: "Thank you for your business." },
  },
  ts
);
export const Setting = getModel("Setting", SettingSchema);

export type UserDoc = InferSchemaType<typeof UserSchema> & { _id: Types.ObjectId };
export type CustomerDoc = InferSchemaType<typeof CustomerSchema> & { _id: Types.ObjectId };
export type ProductDoc = InferSchemaType<typeof ProductSchema> & { _id: Types.ObjectId };
export type VariantDoc = InferSchemaType<typeof ProductVariantSchema> & { _id: Types.ObjectId };
export type TaxDoc = InferSchemaType<typeof TaxSchema> & { _id: Types.ObjectId };
export type PlanDoc = InferSchemaType<typeof SubscriptionPlanSchema> & { _id: Types.ObjectId };
export type DiscountDoc = InferSchemaType<typeof DiscountSchema> & { _id: Types.ObjectId };
export type QuotationDoc = InferSchemaType<typeof QuotationSchema> & { _id: Types.ObjectId };
export type SubscriptionDoc = InferSchemaType<typeof SubscriptionSchema> & { _id: Types.ObjectId };
export type InvoiceDoc = InferSchemaType<typeof InvoiceSchema> & { _id: Types.ObjectId };
export type InvoiceLineDoc = InferSchemaType<typeof InvoiceLineSchema> & { _id: Types.ObjectId };
export type PaymentDoc = InferSchemaType<typeof PaymentSchema> & { _id: Types.ObjectId };

export { mongoose };
