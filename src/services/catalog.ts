import { Discount, Product, ProductVariant, SubscriptionPlan, Tax } from "@/models";
import { planAvailability } from "./subscriptions";
import { toDiscountRule } from "./pricing";
import type { DiscountRule } from "@/lib/billing/calc";

export type CatalogTax = { tax: string; name: string; type: string; rateBps: number };
export type CatalogProduct = {
  _id: string;
  name: string;
  type: string;
  salesPrice: number;
  costPrice: number;
  taxes: CatalogTax[];
  variants: { _id: string; name: string; extraPrice: number }[];
};
export type CatalogPlan = {
  _id: string;
  name: string;
  billingInterval: string;
  basePrice: number;
  minQuantity: number;
  termLength: number;
  products: string[];
  feeTaxes: CatalogTax[];
  available: boolean;
  unavailableReason: string | null;
};
export type Catalog = { products: CatalogProduct[]; plans: CatalogPlan[]; discountRules: DiscountRule[] };

/** Serializable catalogue for line editors (client-side price previews). The server always recomputes. */
export async function getCatalog(): Promise<Catalog> {
  const [products, variants, taxes, plans, discounts] = await Promise.all([
    Product.find({ status: "ACTIVE" }).sort({ name: 1 }).lean(),
    ProductVariant.find({ active: true }).sort({ extraPrice: 1 }).lean(),
    Tax.find({ active: true }).lean(),
    SubscriptionPlan.find({ status: { $ne: "ARCHIVED" } }).sort({ name: 1 }).lean(),
    Discount.find({ active: true, autoApply: true }).sort({ createdAt: 1 }).lean(),
  ]);
  const taxSnap = (ids: unknown[] = []): CatalogTax[] =>
    ids
      .map((id) => taxes.find((t) => String(t._id) === String(id)))
      .filter((t): t is (typeof taxes)[number] => !!t)
      .map((t) => ({ tax: String(t._id), name: t.name, type: t.type, rateBps: t.rateBps }));

  return {
    products: products.map((p) => ({
      _id: String(p._id),
      name: p.name,
      type: p.type,
      salesPrice: p.salesPrice,
      costPrice: p.costPrice ?? 0,
      taxes: taxSnap(p.taxes),
      variants: variants.filter((v) => String(v.product) === String(p._id)).map((v) => ({ _id: String(v._id), name: v.name, extraPrice: v.extraPrice ?? 0 })),
    })),
    plans: plans.map((pl) => {
      const reason = planAvailability(pl);
      return {
        _id: String(pl._id),
        name: pl.name,
        billingInterval: pl.billingInterval,
        basePrice: pl.basePrice,
        minQuantity: pl.minQuantity ?? 1,
        termLength: pl.termLength ?? 12,
        products: (pl.products ?? []).map(String),
        feeTaxes: taxSnap(pl.taxes),
        available: !reason,
        unavailableReason: reason,
      };
    }),
    discountRules: JSON.parse(JSON.stringify(discounts.map(toDiscountRule))),
  };
}
