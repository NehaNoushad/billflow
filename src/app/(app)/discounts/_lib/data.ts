import { Product, Subscription } from "@/models";
import { businessToday, utcDay } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export type DiscountState = "ACTIVE" | "SCHEDULED" | "EXPIRED" | "EXHAUSTED" | "INACTIVE";

export function discountState(d: { active?: boolean | null; startDate?: Date | null; endDate?: Date | null; usageLimit?: number | null; usageCount?: number | null }, today = businessToday()): DiscountState {
  if (d.active === false) return "INACTIVE";
  if (d.endDate && utcDay(d.endDate) < today) return "EXPIRED";
  if (d.usageLimit && (d.usageCount ?? 0) >= d.usageLimit) return "EXHAUSTED";
  if (d.startDate && utcDay(d.startDate) > today) return "SCHEDULED";
  return "ACTIVE";
}

export const STATE_TONE: Record<DiscountState, "green" | "blue" | "amber" | "red" | "gray"> = {
  ACTIVE: "green",
  SCHEDULED: "blue",
  EXPIRED: "amber",
  EXHAUSTED: "red",
  INACTIVE: "gray",
};

export async function discountFormOptions() {
  const [products, subs] = await Promise.all([
    Product.find({ status: "ACTIVE" }).sort({ name: 1 }).select("name salesPrice").lean(),
    Subscription.find({ status: { $in: ["DRAFT", "QUOTATION", "CONFIRMED", "ACTIVE", "PAUSED"] } }).sort({ createdAt: -1 }).limit(500).select("number customerSnapshot status").lean(),
  ]);
  return {
    products: products.map((p) => ({ _id: String(p._id), label: p.name, hint: formatMoney(p.salesPrice) })),
    subscriptions: subs.map((s) => ({ _id: String(s._id), label: s.number, hint: s.customerSnapshot?.companyName || s.customerSnapshot?.name || "" })),
  };
}
