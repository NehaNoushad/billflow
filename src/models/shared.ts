import { Schema } from "mongoose";

// Immutable tax snapshot copied onto a line at the moment it is quoted/subscribed/invoiced.
export const TaxSnapshotSchema = new Schema(
  {
    tax: { type: Schema.Types.ObjectId, ref: "Tax" },
    name: { type: String, required: true },
    type: { type: String, required: true },
    rateBps: { type: Number, required: true, min: 0 },
    amount: { type: Number, default: 0 }, // paise, filled when totals are computed
  },
  { _id: false }
);

export const DiscountSnapshotSchema = new Schema(
  {
    discount: { type: Schema.Types.ObjectId, ref: "Discount" },
    name: { type: String, required: true },
    type: { type: String, enum: ["PERCENTAGE", "FIXED", "MANUAL"], required: true },
    value: { type: Number, required: true }, // bps for PERCENTAGE, paise for FIXED/MANUAL
    amount: { type: Number, required: true }, // paise actually applied
  },
  { _id: false }
);

// Pricing snapshot for one product line. Never re-read from Product after creation.
export const LineSnapshotSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product" },
    productName: { type: String, required: true },
    variant: { type: Schema.Types.ObjectId, ref: "ProductVariant" },
    variantName: { type: String },
    description: { type: String },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 }, // paise, base + variant extra at snapshot time
    costPrice: { type: Number, default: 0 },
    taxes: { type: [TaxSnapshotSchema], default: [] },
    subtotal: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
  },
  { _id: false }
);

export const HistoryEntrySchema = new Schema(
  {
    from: { type: String },
    to: { type: String, required: true },
    at: { type: Date, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: "User" },
    byName: { type: String },
    note: { type: String },
  },
  { _id: false }
);
