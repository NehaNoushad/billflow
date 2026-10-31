"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, NativeSelect } from "@/components/app/form-bits";
import { Panel } from "@/components/app/ui-bits";
import { LineItemsEditor, type EditorLine } from "@/components/app/line-items-editor";
import { subscriptionSchema, type SubscriptionInput } from "@/validators/sales";
import { saveSubscriptionAction } from "@/actions/subscriptions";
import { intervalLabel, type BillingInterval } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { Catalog } from "@/services/catalog";

type Props = {
  subscriptionId?: string;
  catalog: Catalog;
  customers: { _id: string; name: string; companyName?: string }[];
  defaultValues: Partial<SubscriptionInput> & { lines: EditorLine[] };
};

export function SubscriptionForm({ subscriptionId, catalog, customers, defaultValues }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const form = useForm({
    resolver: zodResolver(subscriptionSchema),
    defaultValues: { customer: "", plan: "", paymentTermsDays: 15, notes: "", status: "DRAFT", manualDiscount: { type: "PERCENTAGE", value: "", name: "" }, ...defaultValues } as SubscriptionInput,
  });
  const e = form.formState.errors;
  const lines = (form.watch("lines") ?? []) as EditorLine[];
  const planId = form.watch("plan");
  const md = form.watch("manualDiscount");
  const plan = catalog.plans.find((p) => p._id === planId);
  const plans = catalog.plans.filter((p) => p.available || p._id === defaultValues.plan);

  const submit = (status: "DRAFT" | "CONFIRMED") =>
    form.handleSubmit((values) =>
      start(async () => {
        const fixed = subscriptionId ? { customer: defaultValues.customer, plan: defaultValues.plan } : {};
        const res = await saveSubscriptionAction(subscriptionId ?? null, { ...values, ...fixed, status });
        if (!res.ok) return void toast.error(res.error);
        toast.success(res.message);
        router.push(`/subscriptions/${res.data!.id}`);
        router.refresh();
      })
    )();

  return (
    <form onSubmit={(ev) => ev.preventDefault()} className="space-y-6" noValidate>
      <Panel title="Subscription">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Customer" htmlFor="customer" error={e.customer?.message} required className="lg:col-span-2">
            <NativeSelect id="customer" {...form.register("customer")} aria-readonly={!!subscriptionId} className={subscriptionId ? "pointer-events-none bg-muted" : ""}>
              <option value="">Select customer…</option>
              {customers.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                  {c.companyName ? ` — ${c.companyName}` : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Plan" htmlFor="plan" error={e.plan?.message} required className="lg:col-span-2">
            <NativeSelect id="plan" {...form.register("plan")} aria-readonly={!!subscriptionId} className={subscriptionId ? "pointer-events-none bg-muted" : ""}>
              <option value="">Select plan…</option>
              {plans.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name} · {intervalLabel(p.billingInterval as BillingInterval)}
                  {p.basePrice > 0 ? ` · fee ${formatMoney(p.basePrice)}` : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Start date" htmlFor="startDate" error={e.startDate?.message} required hint="First invoice is generated on this date">
            <Input id="startDate" type="date" {...form.register("startDate")} />
          </Field>
          <Field label="Payment terms (days)" htmlFor="paymentTermsDays" error={e.paymentTermsDays?.message}>
            <Input id="paymentTermsDays" type="number" min={0} {...form.register("paymentTermsDays")} />
          </Field>
          {plan && (
            <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground sm:col-span-2">
              Billed <b className="text-foreground">{intervalLabel(plan.billingInterval as BillingInterval).toLowerCase()}</b> for a term of {plan.termLength} period(s). Minimum quantity {plan.minQuantity}. Automatic discounts are evaluated each billing run.
            </div>
          )}
        </div>
      </Panel>
      <Panel title="Products" description="Prices come from the current catalogue and are locked in (snapshotted) on the subscription.">
        <LineItemsEditor
          catalog={catalog}
          lines={lines}
          onChange={(l) => form.setValue("lines", l as SubscriptionInput["lines"], { shouldValidate: form.formState.isSubmitted })}
          planId={planId}
          includePlanFee
          manualDiscount={md ?? null}
          error={e.lines?.message ?? (Array.isArray(e.lines) ? "Every line needs a product" : undefined)}
        />
      </Panel>
      <Panel title="Discount & notes">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Manual discount type" htmlFor="mdType">
            <NativeSelect id="mdType" {...form.register("manualDiscount.type")}>
              <option value="PERCENTAGE">Percentage (%)</option>
              <option value="FIXED">Fixed amount (₹)</option>
            </NativeSelect>
          </Field>
          <Field label="Value" htmlFor="mdValue" hint="Optional, applied every billing period">
            <Input id="mdValue" inputMode="decimal" placeholder="0" {...form.register("manualDiscount.value")} />
          </Field>
          <Field label="Label" htmlFor="mdName">
            <Input id="mdName" {...form.register("manualDiscount.name")} />
          </Field>
          <Field label="Notes" htmlFor="notes" className="sm:col-span-3">
            <Textarea id="notes" rows={3} {...form.register("notes")} />
          </Field>
        </div>
      </Panel>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        {subscriptionId ? (
          <Button type="button" disabled={pending} onClick={() => submit("DRAFT")}>
            {pending && <Loader2 className="size-4 animate-spin" />} Save changes
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" disabled={pending} onClick={() => submit("DRAFT")}>
              Save as draft
            </Button>
            <Button type="button" disabled={pending} onClick={() => submit("CONFIRMED")}>
              {pending && <Loader2 className="size-4 animate-spin" />} Create & confirm
            </Button>
          </>
        )}
      </div>
    </form>
  );
}
