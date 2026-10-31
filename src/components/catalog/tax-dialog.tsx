"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckboxField, Field, NativeSelect } from "@/components/app/form-bits";
import { TAX_TYPES } from "@/lib/constants";
import { taxSchema, type TaxFormValues } from "@/validators/catalog";
import { saveTax } from "@/actions/taxes";

export function TaxDialog({ id, defaults }: { id?: string; defaults?: TaxFormValues }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const empty: TaxFormValues = { name: "", rate: "", type: "GST", description: "", active: true };
  const form = useForm<TaxFormValues>({ resolver: zodResolver(taxSchema, undefined, { raw: true }), defaultValues: defaults ?? empty });
  const e = form.formState.errors;

  const onSubmit = form.handleSubmit((values) =>
    start(async () => {
      const res = await saveTax(id ?? null, values);
      if (!res.ok) {
        for (const [k, msg] of Object.entries(res.fieldErrors ?? {})) form.setError(k as keyof TaxFormValues, { message: msg });
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      setOpen(false);
      if (!id) form.reset(empty);
      router.refresh();
    })
  );

  return (
    <>
      {id ? (
        <Button variant="ghost" size="icon-sm" aria-label="Edit tax" onClick={() => setOpen(true)}>
          <Pencil className="size-4" />
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" /> New tax
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{id ? "Edit tax" : "New tax"}</DialogTitle>
            <DialogDescription>Changes apply to new quotations, subscriptions and invoices. Past documents keep their tax snapshot.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <Field label="Tax name" htmlFor="tax-name" error={e.name?.message} required>
              <Input id="tax-name" placeholder="e.g. CGST 9%" {...form.register("name")} aria-invalid={!!e.name} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Rate (%)" htmlFor="tax-rate" error={e.rate?.message} required>
                <Input id="tax-rate" inputMode="decimal" placeholder="9" {...form.register("rate")} aria-invalid={!!e.rate} />
              </Field>
              <Field label="Type" htmlFor="tax-type">
                <NativeSelect id="tax-type" {...form.register("type")}>
                  {TAX_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <Field label="Description" htmlFor="tax-desc">
              <Textarea id="tax-desc" rows={2} {...form.register("description")} />
            </Field>
            <CheckboxField label="Active" description="Inactive taxes cannot be assigned or applied" {...form.register("active")} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" />} {id ? "Save" : "Create tax"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
