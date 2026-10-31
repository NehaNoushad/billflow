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
import { quotationSchema, type QuotationInput } from "@/validators/sales";
import { saveQuotationAction } from "@/actions/quotations";
import { addDaysUTC, formatDate, parseDateInput } from "@/lib/dates";
import { intervalLabel, type BillingInterval } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { Catalog } from "@/services/catalog";

export type TemplateOption = { _id: string; name: string; plan?: string; validityDays: number; notes?: string; lines: EditorLine[] };

type Props = {
  quotationId?: string;
  catalog: Catalog;
  customers: { _id: string; name: string; companyName?: string }[];
  templates: TemplateOption[];
  defaultValues: Partial<QuotationInput> & { lines: EditorLine[] };
};

export function QuotationForm({ quotationId, catalog, customers, templates, defaultValues }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const form = useForm({
    resolver: zodResolver(quotationSchema),
    defaultValues: { customer: "", plan: "", template: "", validityDays: 30, notes: "", manualDiscount: { type: "PERCENTAGE", value: "", name: "" }, ...defaultValues } as QuotationInput,
  });
  const e = form.formState.errors;
  const lines = (form.watch("lines") ?? []) as EditorLine[];
  const planId = form.watch("plan");
  const md = form.watch("manualDiscount");
  const qDate = form.watch("quotationDate");
  const validity = Number(form.watch("validityDays")) || 0;
  let expiry = "—";
  try {
    if (qDate && validity > 0) expiry = formatDate(addDaysUTC(parseDateInput(qDate), validity));
  } catch {
    /* typing */
  }
  const availablePlans = catalog.plans.filter((p) => p.available || p._id === defaultValues.plan);

  const applyTemplate = (id: string) => {
    form.setValue("template", id);
    const t = templates.find((x) => x._id === id);
    if (!t) return;
    if (t.plan && availablePlans.some((p) => p._id === t.plan)) form.setValue("plan", t.plan);
    form.setValue("validityDays", t.validityDays);
    form.setValue("lines", t.lines as QuotationInput["lines"], { shouldValidate: true });
    if (t.notes) form.setValue("notes", t.notes);
    toast.info(`Template "${t.name}" applied`);
  };

  const onSubmit = form.handleSubmit((values) =>
    start(async () => {
      const res = await saveQuotationAction(quotationId ?? null, values);
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message);
      router.push(`/quotations/${res.data!.id}`);
      router.refresh();
    })
  );

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <Panel title="Details">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {!quotationId && templates.length > 0 && (
            <Field label="Start from template" htmlFor="template" className="lg:col-span-3" hint="Prefills plan, products, validity and notes.">
              <NativeSelect id="template" value={form.watch("template") ?? ""} onChange={(ev) => applyTemplate(ev.target.value)}>
                <option value="">Blank quotation</option>
                {templates.map((t) => (
                  <option key={t._id} value={t._id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field label="Customer" htmlFor="customer" error={e.customer?.message} required>
            <NativeSelect id="customer" {...form.register("customer")} aria-invalid={!!e.customer}>
              <option value="">Select customer…</option>
              {customers.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                  {c.companyName ? ` — ${c.companyName}` : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Subscription plan" htmlFor="plan" error={e.plan?.message} required>
            <NativeSelect id="plan" {...form.register("plan")} aria-invalid={!!e.plan}>
              <option value="">Select plan…</option>
              {availablePlans.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name} · {intervalLabel(p.billingInterval as BillingInterval)}
                  {p.basePrice > 0 ? ` · fee ${formatMoney(p.basePrice)}` : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quotation date" htmlFor="quotationDate" error={e.quotationDate?.message} required>
              <Input id="quotationDate" type="date" {...form.register("quotationDate")} />
            </Field>
            <Field label="Valid for (days)" htmlFor="validityDays" error={e.validityDays?.message} hint={`Expires ${expiry}`}>
              <Input id="validityDays" type="number" min={1} {...form.register("validityDays")} />
            </Field>
          </div>
        </div>
      </Panel>

      <Panel title="Products" description="Negotiated unit prices are allowed; leave blank to use the list price. Eligible automatic discounts are applied.">
        <LineItemsEditor
          catalog={catalog}
          lines={lines}
          onChange={(l) => form.setValue("lines", l as QuotationInput["lines"], { shouldValidate: form.formState.isSubmitted })}
          planId={planId}
          allowPriceOverride
          includePlanFee
          previewAutoDiscounts
          manualDiscount={md ?? null}
          error={e.lines?.message ?? (Array.isArray(e.lines) ? "Check product lines — every line needs a product" : undefined)}
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
          <Field label="Value" htmlFor="mdValue" hint="Optional, applied after automatic discounts">
            <Input id="mdValue" inputMode="decimal" placeholder="0" {...form.register("manualDiscount.value")} />
          </Field>
          <Field label="Label" htmlFor="mdName">
            <Input id="mdName" placeholder="e.g. Negotiated discount" {...form.register("manualDiscount.name")} />
          </Field>
          <Field label="Notes for the customer" htmlFor="notes" className="sm:col-span-3">
            <Textarea id="notes" rows={3} {...form.register("notes")} />
          </Field>
        </div>
      </Panel>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />} {quotationId ? "Save changes" : "Create quotation"}
        </Button>
      </div>
    </form>
  );
}
