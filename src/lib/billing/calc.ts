// Pure, deterministic pricing math. Every value is integer paise; rates are basis points.
// Order of operations per line: subtotal = qty × unitPrice → minus allocated discount → taxes on the remainder.
import { allocate, applyBps } from "@/lib/money";

export type TaxInput = { tax?: string; name: string; type: string; rateBps: number };

export type LineInput = {
  product?: string;
  productName: string;
  variant?: string;
  variantName?: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  costPrice?: number;
  taxes: TaxInput[];
};

export type DiscountRule = {
  _id: string;
  name: string;
  type: "PERCENTAGE" | "FIXED";
  value: number;
  minPurchase?: number;
  minQuantity?: number;
  applicableProducts?: string[];
  applicableSubscriptions?: string[];
  startDate?: Date | null;
  endDate?: Date | null;
  usageLimit?: number | null;
  usageCount?: number;
  active?: boolean;
};

export type ManualDiscount = { name: string; type: "PERCENTAGE" | "FIXED"; value: number };

export type AppliedDiscount = {
  discount?: string;
  name: string;
  type: "PERCENTAGE" | "FIXED" | "MANUAL";
  value: number;
  amount: number;
};

export type ComputedLine = LineInput & {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  taxes: (TaxInput & { amount: number })[];
};

export type Totals = {
  lines: ComputedLine[];
  discounts: AppliedDiscount[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  taxBreakdown: { name: string; type: string; rateBps: number; amount: number }[];
};

export type DiscountContext = { on: Date; subscriptionId?: string };

/** Why a discount rule does or does not apply. Returns null if eligible. */
export function discountIneligibility(rule: DiscountRule, lines: LineInput[], ctx: DiscountContext): string | null {
  if (rule.active === false) return "Discount is inactive";
  const on = ctx.on.getTime();
  if (rule.startDate && new Date(rule.startDate).getTime() > on) return "Discount has not started";
  if (rule.endDate && new Date(rule.endDate).getTime() < on) return "Discount has expired";
  if (rule.usageLimit != null && rule.usageLimit > 0 && (rule.usageCount ?? 0) >= rule.usageLimit) return "Usage limit reached";
  if (rule.applicableSubscriptions?.length) {
    if (!ctx.subscriptionId || !rule.applicableSubscriptions.includes(ctx.subscriptionId)) return "Not applicable to this subscription";
  }
  const eligible = eligibleLineIndexes(rule, lines);
  if (eligible.length === 0) return "No eligible products";
  const eligibleSubtotal = eligible.reduce((s, i) => s + lines[i].quantity * lines[i].unitPrice, 0);
  const eligibleQty = eligible.reduce((s, i) => s + lines[i].quantity, 0);
  if (rule.minPurchase && eligibleSubtotal < rule.minPurchase) return "Minimum purchase not met";
  if (rule.minQuantity && eligibleQty < rule.minQuantity) return "Minimum quantity not met";
  return null;
}

function eligibleLineIndexes(rule: { applicableProducts?: string[] }, lines: LineInput[]): number[] {
  return lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => !rule.applicableProducts?.length || (l.product && rule.applicableProducts.includes(l.product)))
    .map(({ i }) => i);
}

/**
 * Compute line and document totals.
 * Discounts are applied in order; each is capped at the eligible amount still remaining,
 * so the total discount can never exceed what the lines are worth.
 */
export function computeTotals(inputLines: LineInput[], rules: DiscountRule[] = [], ctx?: DiscountContext, manual?: ManualDiscount | null): Totals {
  const lines = inputLines.map((l) => ({
    ...l,
    quantity: Math.max(1, Math.trunc(l.quantity)),
    unitPrice: Math.max(0, Math.trunc(l.unitPrice)),
  }));
  const subtotals = lines.map((l) => l.quantity * l.unitPrice);
  const remaining = [...subtotals];
  const discounts: AppliedDiscount[] = [];

  const applyDiscount = (indexes: number[], type: "PERCENTAGE" | "FIXED", value: number): number => {
    const pool = indexes.reduce((s, i) => s + remaining[i], 0);
    if (pool <= 0) return 0;
    const wanted = type === "PERCENTAGE" ? applyBps(pool, Math.min(value, 10000)) : value;
    const amount = Math.min(pool, Math.max(0, wanted));
    const parts = allocate(amount, indexes.map((i) => remaining[i]));
    indexes.forEach((lineIdx, k) => (remaining[lineIdx] -= parts[k]));
    return amount;
  };

  if (ctx) {
    for (const rule of rules) {
      if (discountIneligibility(rule, lines, ctx)) continue;
      const amount = applyDiscount(eligibleLineIndexes(rule, lines), rule.type, rule.value);
      if (amount > 0) discounts.push({ discount: rule._id, name: rule.name, type: rule.type, value: rule.value, amount });
    }
  }
  if (manual && manual.value > 0) {
    const amount = applyDiscount(lines.map((_, i) => i), manual.type, manual.value);
    if (amount > 0) discounts.push({ name: manual.name || "Manual discount", type: "MANUAL", value: manual.type === "FIXED" ? manual.value : manual.value, amount });
  }

  const breakdown = new Map<string, { name: string; type: string; rateBps: number; amount: number }>();
  const computed: ComputedLine[] = lines.map((l, i) => {
    const taxable = remaining[i];
    const taxes = l.taxes.map((t) => {
      const amount = applyBps(taxable, t.rateBps);
      const key = `${t.name}|${t.rateBps}`;
      const prev = breakdown.get(key) ?? { name: t.name, type: t.type, rateBps: t.rateBps, amount: 0 };
      prev.amount += amount;
      breakdown.set(key, prev);
      return { ...t, amount };
    });
    const taxAmount = taxes.reduce((s, t) => s + t.amount, 0);
    return { ...l, taxes, subtotal: subtotals[i], discountAmount: subtotals[i] - taxable, taxAmount, total: taxable + taxAmount };
  });

  const subtotal = computed.reduce((s, l) => s + l.subtotal, 0);
  const discountTotal = computed.reduce((s, l) => s + l.discountAmount, 0);
  const taxTotal = computed.reduce((s, l) => s + l.taxAmount, 0);
  return {
    lines: computed,
    discounts,
    subtotal,
    discountTotal,
    taxTotal,
    total: subtotal - discountTotal + taxTotal,
    taxBreakdown: [...breakdown.values()],
  };
}
