import { Types } from "mongoose";
import { Discount, Product, ProductVariant, SubscriptionPlan, Tax } from "@/models";
import type { DiscountRule, LineInput } from "@/lib/billing/calc";
import { BusinessError } from "@/lib/errors";

export type LineRequest = { product: string; variant?: string | null; quantity: number; unitPrice?: number | null };

/**
 * Build immutable line snapshots from product/variant ids using *current* catalogue prices and taxes.
 * Callers persist the result; later edits to products never change the snapshot.
 * `allowPriceOverride` lets staff negotiate a unit price on quotations.
 */
export async function buildLineSnapshots(requests: LineRequest[], { allowPriceOverride = false } = {}): Promise<LineInput[]> {
  if (requests.length === 0) return [];
  const productIds = requests.map((r) => r.product);
  const products = await Product.find({ _id: { $in: productIds } }).lean();
  const variantIds = requests.map((r) => r.variant).filter(Boolean) as string[];
  const variants = variantIds.length ? await ProductVariant.find({ _id: { $in: variantIds } }).lean() : [];
  const taxIds = products.flatMap((p) => (p.taxes ?? []).map(String));
  const taxes = taxIds.length ? await Tax.find({ _id: { $in: taxIds }, active: true }).lean() : [];

  return requests.map((r) => {
    const product = products.find((p) => String(p._id) === r.product);
    if (!product) throw new BusinessError("A selected product no longer exists.");
    if (product.status !== "ACTIVE") throw new BusinessError(`${product.name} is archived and cannot be sold.`);
    const variant = r.variant ? variants.find((v) => String(v._id) === r.variant) : undefined;
    if (r.variant && (!variant || String(variant.product) !== String(product._id))) throw new BusinessError(`Invalid variant for ${product.name}.`);
    const listPrice = product.salesPrice + (variant?.extraPrice ?? 0);
    const unitPrice = allowPriceOverride && r.unitPrice != null && r.unitPrice >= 0 ? r.unitPrice : listPrice;
    return {
      product: String(product._id),
      productName: product.name,
      variant: variant ? String(variant._id) : undefined,
      variantName: variant?.name,
      description: product.description ?? undefined,
      quantity: Math.max(1, Math.trunc(r.quantity)),
      unitPrice,
      costPrice: product.costPrice ?? 0,
      taxes: (product.taxes ?? [])
        .map((id: unknown) => taxes.find((t) => String(t._id) === String(id)))
        .filter(Boolean)
        .map((t: (typeof taxes)[number] | undefined) => ({ tax: String(t!._id), name: t!.name, type: t!.type, rateBps: t!.rateBps })),
    };
  });
}

/** The plan's recurring fee, represented as its own line so it is taxed and discounted like any other. */
export async function planFeeLine(planId: string): Promise<LineInput | null> {
  const plan = await SubscriptionPlan.findById(planId).lean();
  if (!plan || plan.basePrice <= 0) return null;
  const taxes = plan.taxes?.length ? await Tax.find({ _id: { $in: plan.taxes }, active: true }).lean() : [];
  return {
    productName: `${plan.name} — plan fee`,
    quantity: 1,
    unitPrice: plan.basePrice,
    taxes: taxes.map((t) => ({ tax: String(t._id), name: t.name, type: t.type, rateBps: t.rateBps })),
  };
}

/** Discount rules that may auto-apply. Eligibility (dates, limits, minimums) is checked in computeTotals. */
export async function loadAutoDiscountRules(): Promise<DiscountRule[]> {
  const docs = await Discount.find({ active: true, autoApply: true }).sort({ createdAt: 1 }).lean();
  return docs.map(toDiscountRule);
}

export function toDiscountRule(d: {
  _id: Types.ObjectId;
  name: string;
  type: string;
  value: number;
  minPurchase?: number | null;
  minQuantity?: number | null;
  applicableProducts?: Types.ObjectId[];
  applicableSubscriptions?: Types.ObjectId[];
  startDate?: Date | null;
  endDate?: Date | null;
  usageLimit?: number | null;
  usageCount?: number | null;
  active?: boolean | null;
}): DiscountRule {
  return {
    _id: String(d._id),
    name: d.name,
    type: d.type as "PERCENTAGE" | "FIXED",
    value: d.value,
    minPurchase: d.minPurchase ?? 0,
    minQuantity: d.minQuantity ?? 0,
    applicableProducts: (d.applicableProducts ?? []).map(String),
    applicableSubscriptions: (d.applicableSubscriptions ?? []).map(String),
    startDate: d.startDate,
    endDate: d.endDate,
    usageLimit: d.usageLimit,
    usageCount: d.usageCount ?? 0,
    active: d.active ?? true,
  };
}

/**
 * Atomically consume one use of each applied discount. If a limit was hit concurrently,
 * returns the ids that could not be consumed so the caller can recompute without them.
 */
export async function consumeDiscountUsage(discountIds: string[]): Promise<string[]> {
  const exhausted: string[] = [];
  for (const id of discountIds) {
    const res = await Discount.updateOne(
      { _id: id, $or: [{ usageLimit: null }, { usageLimit: { $exists: false } }, { usageLimit: 0 }, { $expr: { $lt: ["$usageCount", "$usageLimit"] } }] },
      { $inc: { usageCount: 1 } }
    );
    if (res.modifiedCount === 0) exhausted.push(id);
  }
  return exhausted;
}

export async function releaseDiscountUsage(discountIds: string[]) {
  if (discountIds.length) await Discount.updateMany({ _id: { $in: discountIds }, usageCount: { $gt: 0 } }, { $inc: { usageCount: -1 } });
}
