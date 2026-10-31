"use client";

import { useRouter } from "next/navigation";
import { useMemo, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CheckboxField, Field, NativeSelect } from "@/components/app/form-bits";
import { Panel } from "@/components/app/ui-bits";
import { computeTotals, type LineInput } from "@/lib/billing/calc";
import { BILLING_INTERVALS, intervalLabel, perIntervalSuffix, type BillingInterval } from "@/lib/dates";
import { formatBps, formatMoney, toPaise } from "@/lib/money";
import { planSchema, type PlanFormValues } from "@/validators/catalog";
import { savePlan } from "@/actions/plans";

type TaxOption = { _id: string; name: string; type: string; rateBps: number };
type ProductOption = { _id: string; name: string; salesPrice: number; taxes: string[] };

function safePaise(v: unknown) {
  try {
    return toPaise(String(v ?? ""));
  } catch {
    return 0;
  }
}

export function PlanForm({ id, defaults, products, taxes }: { id?: string; defaults?: PlanFormValues; products: ProductOption[]; taxes: TaxOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const form = useForm<PlanFormValues>({
    resolver: zodResolver(planSchema, undefined, { raw: true }),
    defaultValues: defaults ?? {
      name: "",
      description: "",
      products: [],
      billingInterval: "MONTHLY",
      basePrice: "0",
      taxes: [],
      minQuantity: 1,
      termLength: 12,
      availableFrom: "",
      availableUntil: "",
      autoClose: true,
      allowEarlyClose: true,
      allowPause: true,
      allowRenewal: true,
      status: "PUBLISHED",
    },
  });
  const e = form.formState.errors;
  const w = form.watch();
  const interval = (w.billingInterval ?? "MONTHLY") as BillingInterval;
  const minQty = Math.max(1, Number(w.minQuantity) || 1);
  const term = Math.max(1, Number(w.termLength) || 1);

  // Client-side preview with the same calculation engine the server uses.
  const preview = useMemo(() => {
    const taxSnap = (ids: string[]) =>
      ids
        .map((tid) => taxes.find((t) => t._id === tid))
        .filter((t): t is TaxOption => !!t)
        .map((t) => ({ tax: t._id, name: t.name, type: t.type, rateBps: t.rateBps }));
    const lines: LineInput[] = [];
    const fee = safePaise(w.basePrice);
    if (fee > 0) lines.push({ productName: `${w.name || "Plan"} — plan fee`, quantity: 1, unitPrice: fee, taxes: taxSnap(w.taxes ?? []) });
    for (const pid of w.products ?? []) {
      const p = products.find((x) => x._id === pid);
      if (p) lines.push({ product: p._id, productName: p.name, quantity: minQty, unitPrice: p.salesPrice, taxes: taxSnap(p.taxes) });
    }
    return computeTotals(lines);
  }, [w.basePrice, w.taxes, w.products, w.name, minQty, products, taxes]);

  const onSubmit = form.handleSubmit((values) =>
    start(async () => {
      const res = await savePlan(id ?? null, values);
      if (!res.ok) {
        for (const [k, msg] of Object.entries(res.fieldErrors ?? {})) form.setError(k as keyof PlanFormValues, { message: msg });
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.push(`/plans/${res.data!.id}`);
      router.refresh();
    })
  );

  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[1fr_380px]" noValidate>
      <div className="space-y-6">
        <Panel title="Plan details">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Plan name" htmlFor="name" error={e.name?.message} required className="sm:col-span-2">
              <Input id="name" {...form.register("name")} aria-invalid={!!e.name} />
            </Field>
            <Field label="Description" htmlFor="description" className="sm:col-span-2">
              <Textarea id="description" rows={2} {...form.register("description")} />
            </Field>
            <Field label="Billing interval" htmlFor="billingInterval" required>
              <NativeSelect id="billingInterval" {...form.register("billingInterval")}>
                {BILLING_INTERVALS.map((i) => (
                  <option key={i} value={i}>
                    {intervalLabel(i)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Plan fee (₹ per interval)" htmlFor="basePrice" error={e.basePrice?.message} hint="Added as its own line; 0 for none">
              <Input id="basePrice" inputMode="decimal" {...form.register("basePrice")} aria-invalid={!!e.basePrice} />
            </Field>
            <Field label="Minimum quantity" htmlFor="minQuantity" error={e.minQuantity?.message} hint="Per product line">
              <Input id="minQuantity" type="number" min={1} {...form.register("minQuantity")} aria-invalid={!!e.minQuantity} />
            </Field>
            <Field label="Term length (intervals)" htmlFor="termLength" error={e.termLength?.message} hint={`One term = ${term} × ${intervalLabel(interval).toLowerCase()}`}>
              <Input id="termLength" type="number" min={1} {...form.register("termLength")} aria-invalid={!!e.termLength} />
            </Field>
            <Field label="Available from" htmlFor="availableFrom" error={e.availableFrom?.message}>
              <Input id="availableFrom" type="date" {...form.register("availableFrom")} />
            </Field>
            <Field label="Available until" htmlFor="availableUntil" error={e.availableUntil?.message} hint="Leave blank for no end date">
              <Input id="availableUntil" type="date" {...form.register("availableUntil")} aria-invalid={!!e.availableUntil} />
            </Field>
            <Field label="Status" htmlFor="status">
              <NativeSelect id="status" {...form.register("status")}>
                <option value="PUBLISHED">Published — can be sold</option>
                <option value="DRAFT">Draft — hidden from sales</option>
              </NativeSelect>
            </Field>
          </div>
        </Panel>

        <Panel title="Products in this plan" description="Suggested on quotations and subscriptions using this plan.">
          {products.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active products. Create products first.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {products.map((p) => (
                <label key={p._id} className="flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-sm hover:bg-muted/40">
                  <input type="checkbox" value={p._id} className="size-4 accent-[var(--primary)]" {...form.register("products")} />
                  <span className="flex-1">{p.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{formatMoney(p.salesPrice)}</span>
                </label>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Taxes on plan fee">
          <div className="grid gap-2 sm:grid-cols-2">
            {taxes.map((t) => (
              <label key={t._id} className="flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-sm hover:bg-muted/40">
                <input type="checkbox" value={t._id} className="size-4 accent-[var(--primary)]" {...form.register("taxes")} />
                <span className="flex-1">{t.name}</span>
                <span className="text-xs text-muted-foreground">{formatBps(t.rateBps)}</span>
              </label>
            ))}
          </div>
        </Panel>

        <Panel title="Lifecycle rules">
          <div className="grid gap-2 sm:grid-cols-2">
            <CheckboxField label="Auto-close at end of term" description="Billing engine closes the subscription when its term ends" {...form.register("autoClose")} />
            <CheckboxField label="Allow early closure" description="Subscriptions may be closed before expiry" {...form.register("allowEarlyClose")} />
            <CheckboxField label="Allow pause" description="Paused periods are not billed" {...form.register("allowPause")} />
            <CheckboxField label="Allow renewal" description="Extend by another term" {...form.register("allowRenewal")} />
          </div>
        </Panel>
      </div>

      <div className="space-y-6 lg:sticky lg:top-20 lg:self-start">
        <Panel title="Pricing preview" description={`List prices × minimum quantity (${minQty}). Discounts apply at billing time.`}>
          {preview.lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">Add a plan fee or products to see pricing.</p>
          ) : (
            <div className="space-y-3 text-sm">
              <ul className="space-y-1.5">
                {preview.lines.map((l, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="text-muted-foreground">
                      {l.productName}
                      {l.quantity > 1 && ` × ${l.quantity}`}
                    </span>
                    <span className="tabular-nums">{formatMoney(l.subtotal)}</span>
                  </li>
                ))}
              </ul>
              <dl className="space-y-1.5 border-t pt-3">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="tabular-nums">{formatMoney(preview.subtotal)}</dd>
                </div>
                {preview.taxBreakdown.map((t) => (
                  <div key={t.name} className="flex justify-between">
                    <dt className="text-muted-foreground">{t.name}</dt>
                    <dd className="tabular-nums">{formatMoney(t.amount)}</dd>
                  </div>
                ))}
                <div className="flex justify-between border-t pt-2 font-semibold">
                  <dt>Total {perIntervalSuffix(interval)}</dt>
                  <dd className="tabular-nums">{formatMoney(preview.total)}</dd>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <dt>Full term ({term} intervals)</dt>
                  <dd className="tabular-nums">{formatMoney(preview.total * term)}</dd>
                </div>
              </dl>
            </div>
          )}
          <Button type="submit" className="mt-4 h-9 w-full" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {id ? "Save plan" : w.status === "DRAFT" ? "Save as draft" : "Publish plan"}
          </Button>
          {id && <p className="mt-2 text-xs text-muted-foreground">Existing subscriptions keep the terms they were created with.</p>}
        </Panel>
      </div>
    </form>
  );
}
