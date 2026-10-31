"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/app/form-bits";
import { computeTotals, type LineInput, type ManualDiscount } from "@/lib/billing/calc";
import { formatBps, formatMoney, toPaise, toRupeeString } from "@/lib/money";
import { businessToday } from "@/lib/dates";
import type { Catalog } from "@/services/catalog";

export type EditorLine = { product: string; variant?: string; quantity: number; unitPrice?: string };

type Props = {
  catalog: Catalog;
  lines: EditorLine[];
  onChange: (lines: EditorLine[]) => void;
  planId?: string;
  /** Show and allow editing a negotiated unit price (quotations / manual invoices). */
  allowPriceOverride?: boolean;
  manualDiscount?: { type: "PERCENTAGE" | "FIXED"; value?: string | number; name?: string } | null;
  /** Preview auto-applied discount rules (quotations). */
  previewAutoDiscounts?: boolean;
  /** Include the plan fee line in the preview (quotations / subscriptions). */
  includePlanFee?: boolean;
  error?: string;
};

function parseManual(md: Props["manualDiscount"]): ManualDiscount | null {
  if (!md || md.value === undefined || md.value === "") return null;
  try {
    if (md.type === "FIXED") return { name: md.name || "Manual discount", type: "FIXED", value: toPaise(md.value) };
    const s = String(md.value);
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
    const [w, f = ""] = s.split(".");
    return { name: md.name || "Manual discount", type: "PERCENTAGE", value: Math.min(10000, Number(w) * 100 + Number((f + "00").slice(0, 2))) };
  } catch {
    return null;
  }
}

/** Build the same LineInput shape the server builds, for an instant client-side preview. */
export function editorToLineInputs(catalog: Catalog, lines: EditorLine[], allowPriceOverride: boolean): LineInput[] {
  return lines
    .map((l) => {
      const p = catalog.products.find((x) => x._id === l.product);
      if (!p) return null;
      const v = p.variants.find((x) => x._id === l.variant);
      let unitPrice = p.salesPrice + (v?.extraPrice ?? 0);
      if (allowPriceOverride && l.unitPrice !== undefined && l.unitPrice !== "") {
        try {
          unitPrice = toPaise(l.unitPrice);
        } catch {
          /* keep list price while typing */
        }
      }
      return { product: p._id, productName: p.name, variant: v?._id, variantName: v?.name, quantity: Math.max(1, Number(l.quantity) || 1), unitPrice, costPrice: p.costPrice, taxes: p.taxes } as LineInput;
    })
    .filter(Boolean) as LineInput[];
}

export function LineItemsEditor({ catalog, lines, onChange, planId, allowPriceOverride = false, manualDiscount, previewAutoDiscounts = false, includePlanFee = false, error }: Props) {
  const plan = catalog.plans.find((p) => p._id === planId);
  const suggested = plan?.products.length ? catalog.products.filter((p) => plan.products.includes(p._id)) : [];
  const others = catalog.products.filter((p) => !suggested.includes(p));

  const inputs = editorToLineInputs(catalog, lines, allowPriceOverride);
  if (includePlanFee && plan && plan.basePrice > 0) inputs.unshift({ productName: `${plan.name} — plan fee`, quantity: 1, unitPrice: plan.basePrice, taxes: plan.feeTaxes });
  const totals = computeTotals(inputs, previewAutoDiscounts ? catalog.discountRules : [], previewAutoDiscounts ? { on: businessToday() } : undefined, parseManual(manualDiscount));

  const update = (i: number, patch: Partial<EditorLine>) => onChange(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const listPrice = (l: EditorLine) => {
    const p = catalog.products.find((x) => x._id === l.product);
    if (!p) return 0;
    return p.salesPrice + (p.variants.find((v) => v._id === l.variant)?.extraPrice ?? 0);
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Product</th>
              <th className="px-3 py-2 font-medium">Variant</th>
              <th className="w-20 px-3 py-2 font-medium">Qty</th>
              <th className="w-32 px-3 py-2 text-right font-medium">Unit price</th>
              <th className="w-32 px-3 py-2 text-right font-medium">Amount</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {includePlanFee && plan && plan.basePrice > 0 && (
              <tr className="border-t bg-muted/20">
                <td className="px-3 py-2" colSpan={2}>
                  <span className="font-medium">{plan.name}</span> <span className="text-muted-foreground">— plan fee</span>
                </td>
                <td className="px-3 py-2">1</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(plan.basePrice)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(plan.basePrice)}</td>
                <td />
              </tr>
            )}
            {lines.map((l, i) => {
              const product = catalog.products.find((p) => p._id === l.product);
              const belowMin = plan && l.quantity < plan.minQuantity;
              return (
                <tr key={i} className="border-t align-top">
                  <td className="px-3 py-2">
                    <NativeSelect aria-label="Product" value={l.product} onChange={(e) => update(i, { product: e.target.value, variant: undefined, unitPrice: undefined })}>
                      <option value="">Select product…</option>
                      {suggested.length > 0 && (
                        <optgroup label="Included in plan">
                          {suggested.map((p) => (
                            <option key={p._id} value={p._id}>
                              {p.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label={suggested.length ? "Other products" : "Products"}>
                        {others.map((p) => (
                          <option key={p._id} value={p._id}>
                            {p.name}
                          </option>
                        ))}
                      </optgroup>
                    </NativeSelect>
                    {product && product.taxes.length > 0 && <p className="mt-1 text-[11px] text-muted-foreground">Tax: {product.taxes.map((t) => `${t.name}`).join(" + ")}</p>}
                  </td>
                  <td className="px-3 py-2">
                    <NativeSelect aria-label="Variant" value={l.variant ?? ""} disabled={!product?.variants.length} onChange={(e) => update(i, { variant: e.target.value || undefined, unitPrice: undefined })}>
                      <option value="">{product?.variants.length ? "Base" : "—"}</option>
                      {product?.variants.map((v) => (
                        <option key={v._id} value={v._id}>
                          {v.name} {v.extraPrice > 0 ? `(+${formatMoney(v.extraPrice)})` : ""}
                        </option>
                      ))}
                    </NativeSelect>
                  </td>
                  <td className="px-3 py-2">
                    <Input type="number" min={1} aria-label="Quantity" value={l.quantity} onChange={(e) => update(i, { quantity: Math.max(1, Number(e.target.value) || 1) })} aria-invalid={!!belowMin} />
                    {belowMin && <p className="mt-1 text-[11px] text-destructive">Min {plan!.minQuantity}</p>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {allowPriceOverride ? (
                      <Input inputMode="decimal" aria-label="Unit price" className="text-right" placeholder={toRupeeString(listPrice(l))} value={l.unitPrice ?? ""} onChange={(e) => update(i, { unitPrice: e.target.value })} />
                    ) : (
                      <span className="inline-block pt-1.5 tabular-nums">{formatMoney(listPrice(l))}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 pt-3.5 text-right font-medium tabular-nums">{formatMoney(totals.lines[i + (includePlanFee && plan && plan.basePrice > 0 ? 1 : 0)]?.subtotal ?? 0)}</td>
                  <td className="px-1 py-2">
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove line" onClick={() => onChange(lines.filter((_, idx) => idx !== i))}>
                      <Trash2 className="size-4 text-muted-foreground" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => onChange([...lines, { product: suggested[0]?._id ?? "", quantity: plan?.minQuantity ?? 1 }])}>
            <Plus className="size-4" /> Add product line
          </Button>
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>
        <TotalsSummary totals={totals} />
      </div>
    </div>
  );
}

export function TotalsSummary({ totals }: { totals: ReturnType<typeof computeTotals> }) {
  return (
    <dl className="w-full space-y-1.5 rounded-lg border bg-muted/20 p-4 text-sm sm:w-80">
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Subtotal</dt>
        <dd className="tabular-nums">{formatMoney(totals.subtotal)}</dd>
      </div>
      {totals.discounts.map((d, i) => (
        <div key={i} className="flex justify-between text-emerald-700">
          <dt>
            {d.name} {d.type === "PERCENTAGE" ? `(${formatBps(d.value)})` : ""}
          </dt>
          <dd className="tabular-nums">−{formatMoney(d.amount)}</dd>
        </div>
      ))}
      {totals.taxBreakdown.map((t) => (
        <div key={t.name} className="flex justify-between">
          <dt className="text-muted-foreground">{t.name}</dt>
          <dd className="tabular-nums">{formatMoney(t.amount)}</dd>
        </div>
      ))}
      <div className="flex justify-between border-t pt-2 text-base font-semibold">
        <dt>Total</dt>
        <dd className="tabular-nums">{formatMoney(totals.total)}</dd>
      </div>
    </dl>
  );
}
