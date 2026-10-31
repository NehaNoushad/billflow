"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckboxField, Field, NativeSelect } from "@/components/app/form-bits";
import { Panel } from "@/components/app/ui-bits";
import { formatMoney } from "@/lib/money";
import { discountSchema, type DiscountFormValues } from "@/validators/catalog";
import { saveDiscount } from "@/actions/discounts";

type Option = { _id: string; label: string; hint?: string };

export function DiscountForm({ id, defaults, products, subscriptions, usageCount = 0 }: { id?: string; defaults?: DiscountFormValues; products: Option[]; subscriptions: Option[]; usageCount?: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [subQuery, setSubQuery] = useState("");
  const form = useForm<DiscountFormValues>({
    resolver: zodResolver(discountSchema, undefined, { raw: true }),
    defaultValues: defaults ?? {
      name: "",
      code: "",
      type: "PERCENTAGE",
      value: "",
      minPurchase: "0",
      minQuantity: 0,
      applicableProducts: [],
      applicableSubscriptions: [],
      startDate: "",
      endDate: "",
      usageLimit: "",
      autoApply: true,
      active: true,
    },
  });
  const e = form.formState.errors as Record<string, { message?: string } | undefined>;
  const type = form.watch("type");
  const selectedSubs = form.watch("applicableSubscriptions") ?? [];
  const filteredSubs = subscriptions.filter((s) => selectedSubs.includes(s._id) || !subQuery || `${s.label} ${s.hint}`.toLowerCase().includes(subQuery.toLowerCase())).slice(0, 60);

  const onSubmit = form.handleSubmit((values) =>
    start(async () => {
      const res = await saveDiscount(id ?? null, values);
      if (!res.ok) {
        for (const [k, msg] of Object.entries(res.fieldErrors ?? {})) form.setError(k as keyof DiscountFormValues, { message: msg });
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.push("/discounts");
      router.refresh();
    })
  );

  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[1fr_340px]" noValidate>
      <div className="space-y-6">
        <Panel title="Discount rule">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="name" error={e.name?.message} required>
              <Input id="name" {...form.register("name")} aria-invalid={!!e.name} />
            </Field>
            <Field label="Code (optional)" htmlFor="code" error={e.code?.message}>
              <Input id="code" className="uppercase" placeholder="DIWALI500" {...form.register("code")} />
            </Field>
            <Field label="Discount type" htmlFor="type">
              <NativeSelect id="type" {...form.register("type")}>
                <option value="PERCENTAGE">Percentage</option>
                <option value="FIXED">Fixed amount</option>
              </NativeSelect>
            </Field>
            <Field label={type === "PERCENTAGE" ? "Percentage (%)" : "Amount (₹)"} htmlFor="value" error={e.value?.message} required hint={type === "FIXED" ? "Capped at the eligible amount — never exceeds it" : "Up to 100%"}>
              <Input id="value" inputMode="decimal" {...form.register("value")} aria-invalid={!!e.value} />
            </Field>
            <Field label="Minimum purchase (₹)" htmlFor="minPurchase" error={e.minPurchase?.message} hint="Of eligible products, before tax">
              <Input id="minPurchase" inputMode="decimal" {...form.register("minPurchase")} />
            </Field>
            <Field label="Minimum quantity" htmlFor="minQuantity" error={e.minQuantity?.message}>
              <Input id="minQuantity" type="number" min={0} {...form.register("minQuantity")} />
            </Field>
            <Field label="Start date" htmlFor="startDate" error={e.startDate?.message}>
              <Input id="startDate" type="date" {...form.register("startDate")} />
            </Field>
            <Field label="End date" htmlFor="endDate" error={e.endDate?.message} hint="Stops applying after this date">
              <Input id="endDate" type="date" {...form.register("endDate")} aria-invalid={!!e.endDate} />
            </Field>
            <Field label="Usage limit" htmlFor="usageLimit" error={e.usageLimit?.message} hint={id ? `Used ${usageCount} time(s) so far. Blank = unlimited` : "Blank = unlimited"}>
              <Input id="usageLimit" type="number" min={1} {...form.register("usageLimit")} />
            </Field>
          </div>
        </Panel>

        <Panel title="Applicable products" description="Leave all unchecked to apply to every product.">
          <div className="grid gap-2 sm:grid-cols-2">
            {products.map((p) => (
              <label key={p._id} className="flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-sm hover:bg-muted/40">
                <input type="checkbox" value={p._id} className="size-4 accent-[var(--primary)]" {...form.register("applicableProducts")} />
                <span className="flex-1">{p.label}</span>
                {p.hint && <span className="text-xs text-muted-foreground">{p.hint}</span>}
              </label>
            ))}
          </div>
        </Panel>

        <Panel title="Applicable subscriptions" description={`Optional. Leave empty to apply to all subscriptions. ${selectedSubs.length ? `${selectedSubs.length} selected.` : ""}`}>
          <Input placeholder="Filter by subscription number or customer…" value={subQuery} onChange={(ev) => setSubQuery(ev.target.value)} className="mb-3" />
          <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
            {filteredSubs.map((s) => (
              <label key={s._id} className="flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-sm hover:bg-muted/40">
                <input type="checkbox" value={s._id} className="size-4 accent-[var(--primary)]" {...form.register("applicableSubscriptions")} />
                <span className="flex-1 font-medium">{s.label}</span>
                <span className="truncate text-xs text-muted-foreground">{s.hint}</span>
              </label>
            ))}
            {filteredSubs.length === 0 && <p className="text-sm text-muted-foreground">No subscriptions match.</p>}
          </div>
        </Panel>
      </div>

      <div className="space-y-6">
        <Panel title="Behaviour">
          <div className="space-y-2">
            <CheckboxField label="Apply automatically" description="Billing engine applies it to eligible invoices" {...form.register("autoApply")} />
            <CheckboxField label="Active" description="Inactive discounts are never applied" {...form.register("active")} />
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Eligibility is re-checked on every invoice: dates, usage limit, minimum purchase and quantity. Example: a {formatMoney(50000)} fixed discount on a {formatMoney(30000)} invoice is capped at {formatMoney(30000)}.
          </p>
          <Button type="submit" className="mt-4 h-9 w-full" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />} {id ? "Save discount" : "Create discount"}
          </Button>
        </Panel>
      </div>
    </form>
  );
}
