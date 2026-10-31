"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, NativeSelect } from "@/components/app/form-bits";
import { Panel } from "@/components/app/ui-bits";
import { PRODUCT_TYPES, humanize } from "@/lib/constants";
import { formatBps, formatMoney, toPaise } from "@/lib/money";
import { productSchema, type ProductFormValues } from "@/validators/catalog";
import { saveProduct } from "@/actions/products";

type TaxOption = { _id: string; name: string; rateBps: number; type: string };

function safePaise(v: unknown) {
  try {
    return toPaise(String(v ?? ""));
  } catch {
    return 0;
  }
}

export function ProductForm({ id, defaults, taxes }: { id?: string; defaults?: ProductFormValues; taxes: TaxOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema, undefined, { raw: true }),
    defaultValues: defaults ?? { name: "", type: "SOFTWARE", description: "", salesPrice: "", costPrice: "0", imageUrl: "", taxes: [], status: "ACTIVE", variants: [] },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "variants" });
  const e = form.formState.errors;
  const base = safePaise(form.watch("salesPrice"));
  const cost = safePaise(form.watch("costPrice"));
  const variants = form.watch("variants") ?? [];
  const selectedTaxes = form.watch("taxes") ?? [];

  const onSubmit = form.handleSubmit((values) =>
    start(async () => {
      const res = await saveProduct(id ?? null, values);
      if (!res.ok) {
        for (const [k, msg] of Object.entries(res.fieldErrors ?? {})) form.setError(k as keyof ProductFormValues, { message: msg });
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.push(`/products/${res.data!.id}`);
      router.refresh();
    })
  );

  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[1fr_340px]" noValidate>
      <div className="space-y-6">
        <Panel title="Product details">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Product name" htmlFor="name" error={e.name?.message} required className="sm:col-span-2">
              <Input id="name" {...form.register("name")} aria-invalid={!!e.name} />
            </Field>
            <Field label="Product type" htmlFor="type" error={e.type?.message} required>
              <NativeSelect id="type" {...form.register("type")}>
                {PRODUCT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {humanize(t)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Status" htmlFor="status">
              <NativeSelect id="status" {...form.register("status")}>
                <option value="ACTIVE">Active</option>
                <option value="ARCHIVED">Archived</option>
              </NativeSelect>
            </Field>
            <Field label="Sales price (₹)" htmlFor="salesPrice" error={e.salesPrice?.message} required hint="Base price per unit, per billing period">
              <Input id="salesPrice" inputMode="decimal" {...form.register("salesPrice")} aria-invalid={!!e.salesPrice} />
            </Field>
            <Field label="Cost price (₹)" htmlFor="costPrice" error={e.costPrice?.message} hint={base > 0 ? `Margin ${Math.round(((base - cost) / base) * 100)}%` : undefined}>
              <Input id="costPrice" inputMode="decimal" {...form.register("costPrice")} aria-invalid={!!e.costPrice} />
            </Field>
            <Field label="Image URL (optional)" htmlFor="imageUrl" error={e.imageUrl?.message} className="sm:col-span-2">
              <Input id="imageUrl" placeholder="https://…" {...form.register("imageUrl")} />
            </Field>
            <Field label="Description / notes" htmlFor="description" error={e.description?.message} className="sm:col-span-2">
              <Textarea id="description" rows={3} {...form.register("description")} />
            </Field>
          </div>
        </Panel>

        <Panel
          title="Variants"
          description="Each variant adds an extra amount to the base price."
          actions={
            <Button type="button" variant="outline" size="sm" onClick={() => append({ _id: undefined, name: "", extraPrice: "0" })}>
              <Plus className="size-4" /> Add variant
            </Button>
          }
        >
          {fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">No variants — the product is sold at its base price.</p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_140px_140px_36px] gap-2 text-xs font-medium text-muted-foreground">
                <span>Name</span>
                <span>Extra price (₹)</span>
                <span className="text-right">Final price</span>
                <span />
              </div>
              {fields.map((f, i) => (
                <div key={f.id} className="grid grid-cols-[1fr_140px_140px_36px] items-start gap-2">
                  <div>
                    <Input aria-label="Variant name" placeholder="e.g. Enterprise" {...form.register(`variants.${i}.name`)} aria-invalid={!!e.variants?.[i]?.name} />
                    {e.variants?.[i]?.name && <p className="mt-1 text-xs text-destructive">{e.variants[i]?.name?.message}</p>}
                  </div>
                  <div>
                    <Input aria-label="Extra price" inputMode="decimal" {...form.register(`variants.${i}.extraPrice`)} aria-invalid={!!e.variants?.[i]?.extraPrice} />
                    {e.variants?.[i]?.extraPrice && <p className="mt-1 text-xs text-destructive">{e.variants[i]?.extraPrice?.message}</p>}
                  </div>
                  <span className="pt-1.5 text-right text-sm font-medium tabular-nums">{formatMoney(base + safePaise(variants[i]?.extraPrice))}</span>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove variant" onClick={() => remove(i)}>
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
              {e.variants?.message && <p className="text-xs text-destructive">{e.variants.message}</p>}
              <p className="pt-1 text-xs text-muted-foreground">Removing a variant that is already used on subscriptions or invoices deactivates it instead of deleting it.</p>
            </div>
          )}
        </Panel>
      </div>

      <div className="space-y-6">
        <Panel title="Taxes" description="Applied to new quotations, subscriptions and invoices.">
          {taxes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active taxes configured.</p>
          ) : (
            <div className="space-y-2">
              {taxes.map((t) => (
                <label key={t._id} className="flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-sm hover:bg-muted/40">
                  <input type="checkbox" value={t._id} className="size-4 accent-[var(--primary)]" {...form.register("taxes")} />
                  <span className="flex-1">{t.name}</span>
                  <span className="text-xs text-muted-foreground">{formatBps(t.rateBps)}</span>
                </label>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Price summary">
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Base price</dt>
              <dd className="tabular-nums">{formatMoney(base)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Tax rate</dt>
              <dd className="tabular-nums">{formatBps(taxes.filter((t) => selectedTaxes.includes(t._id)).reduce((s, t) => s + t.rateBps, 0))}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Variants</dt>
              <dd>{fields.length}</dd>
            </div>
          </dl>
          <Button type="submit" className="mt-4 h-9 w-full" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {id ? "Save changes" : "Create product"}
          </Button>
          {id && <p className="mt-2 text-xs text-muted-foreground">Existing subscriptions and invoices keep the prices they were created with.</p>}
        </Panel>
      </div>
    </form>
  );
}
