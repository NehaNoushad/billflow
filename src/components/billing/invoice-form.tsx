"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, NativeSelect } from "@/components/app/form-bits";
import { Panel } from "@/components/app/ui-bits";
import { LineItemsEditor, type EditorLine } from "@/components/app/line-items-editor";
import { createManualInvoiceAction, updateManualInvoiceAction } from "@/actions/invoices";
import type { Catalog } from "@/services/catalog";

type Values = {
  customer: string;
  invoiceDate: string;
  paymentTermsDays: number;
  lines: EditorLine[];
  discountType: "PERCENTAGE" | "FIXED";
  discountValue: string;
  notes: string;
};

type Props = {
  catalog: Catalog;
  customers: { _id: string; name: string; companyName?: string; email: string }[];
  defaults: Values;
  invoiceId?: string;
};

export function InvoiceForm({ catalog, customers, defaults, invoiceId }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const form = useForm<Values>({ defaultValues: defaults });
  const e = form.formState.errors;
  const discountType = useWatch({ control: form.control, name: "discountType" });
  const discountValue = useWatch({ control: form.control, name: "discountValue" });

  const save = (confirm: boolean) =>
    form.handleSubmit((v) =>
      start(async () => {
        setError(undefined);
        const lines = v.lines.filter((l) => l.product);
        if (lines.length === 0) return setError("Add at least one product line.");
        const payload = {
          customer: v.customer,
          invoiceDate: v.invoiceDate,
          paymentTermsDays: Number(v.paymentTermsDays),
          lines: lines.map((l) => ({ product: l.product, variant: l.variant ?? "", quantity: l.quantity, unitPrice: l.unitPrice ?? "" })),
          manualDiscount: v.discountValue ? { type: v.discountType, value: v.discountValue, name: "Discount" } : null,
          notes: v.notes || undefined,
          confirm,
        };
        const res = invoiceId ? await updateManualInvoiceAction(invoiceId, payload) : await createManualInvoiceAction(payload);
        if (!res.ok) return setError(res.error);
        toast.success(confirm ? "Invoice confirmed" : "Draft saved");
        router.push(`/invoices/${res.data!.id}`);
        router.refresh();
      })
    )();

  return (
    <form onSubmit={(ev) => ev.preventDefault()} className="space-y-6">
      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}
      <Panel title="Invoice details">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Customer" htmlFor="customer" required error={e.customer?.message} className="sm:col-span-3">
            <NativeSelect id="customer" disabled={!!invoiceId} {...form.register("customer", { required: "Choose a customer" })}>
              <option value="">Select customer…</option>
              {customers.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                  {c.companyName ? ` — ${c.companyName}` : ""} ({c.email})
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Invoice date" htmlFor="invoiceDate" required error={e.invoiceDate?.message}>
            <Input id="invoiceDate" type="date" {...form.register("invoiceDate", { required: "Choose a date" })} />
          </Field>
          <Field label="Payment terms (days)" htmlFor="paymentTermsDays" required error={e.paymentTermsDays?.message}>
            <Input id="paymentTermsDays" type="number" min={0} max={365} {...form.register("paymentTermsDays", { required: true, min: { value: 0, message: "Must be 0 or more" }, max: { value: 365, message: "Max 365" } })} />
          </Field>
        </div>
      </Panel>

      <Panel title="Line items" description="Prices default to the catalogue; type a different unit price to negotiate. Totals are recalculated on the server.">
        <Controller
          control={form.control}
          name="lines"
          render={({ field }) => (
            <LineItemsEditor
              catalog={catalog}
              lines={field.value}
              onChange={field.onChange}
              allowPriceOverride
              manualDiscount={discountValue ? { type: discountType, value: discountValue, name: "Discount" } : null}
            />
          )}
        />
        <div className="mt-5 grid gap-4 border-t pt-5 sm:grid-cols-3">
          <Field label="Discount type" htmlFor="discountType">
            <NativeSelect id="discountType" {...form.register("discountType")}>
              <option value="PERCENTAGE">Percentage (%)</option>
              <option value="FIXED">Fixed amount (₹)</option>
            </NativeSelect>
          </Field>
          <Field label="Discount value" htmlFor="discountValue" hint="Optional. Never exceeds the invoice subtotal.">
            <Input id="discountValue" inputMode="decimal" placeholder="0" {...form.register("discountValue")} />
          </Field>
        </div>
      </Panel>

      <Panel title="Notes">
        <Textarea rows={3} placeholder="Shown on the invoice PDF" {...form.register("notes")} />
      </Panel>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
        <Button type="button" variant="secondary" onClick={() => save(false)} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />} Save draft
        </Button>
        <Button type="button" onClick={() => save(true)} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />} Save &amp; confirm
        </Button>
      </div>
    </form>
  );
}
