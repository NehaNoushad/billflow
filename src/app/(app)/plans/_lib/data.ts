import { Product, Tax } from "@/models";
import { planAvailability } from "@/services/subscriptions";

export async function planFormOptions(extraTaxIds: unknown[] = [], extraProductIds: unknown[] = []) {
  const [products, taxes] = await Promise.all([
    Product.find({ $or: [{ status: "ACTIVE" }, { _id: { $in: extraProductIds } }] }).sort({ name: 1 }).select("name salesPrice taxes").lean(),
    Tax.find({ $or: [{ active: true }, { _id: { $in: extraTaxIds } }] }).sort({ name: 1 }).select("name type rateBps").lean(),
  ]);
  return {
    products: products.map((p) => ({ _id: String(p._id), name: p.name, salesPrice: p.salesPrice, taxes: (p.taxes ?? []).map(String) })),
    taxes: taxes.map((t) => ({ _id: String(t._id), name: t.name, type: t.type, rateBps: t.rateBps })),
  };
}

/** Human availability state for badges. */
export function availabilityState(plan: { status: string; availableFrom?: Date | null; availableUntil?: Date | null }): { label: string; tone: "green" | "amber" | "gray" | "red" } {
  const reason = planAvailability(plan);
  if (!reason) return { label: "Available", tone: "green" };
  if (plan.status === "ARCHIVED") return { label: "Archived", tone: "gray" };
  if (plan.status === "DRAFT") return { label: "Draft", tone: "gray" };
  if (reason.includes("not available yet")) return { label: "Not yet available", tone: "amber" };
  return { label: "Ended", tone: "red" };
}
