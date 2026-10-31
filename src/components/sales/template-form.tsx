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
import { templateSchema, type TemplateInput } from "@/validators/sales";
import { saveTemplateAction } from "@/actions/quotations";
import type { Catalog } from "@/services/catalog";

export function TemplateForm({ templateId, catalog, defaultValues }: { templateId?: string; catalog: Catalog; defaultValues: Partial<TemplateInput> & { lines: EditorLine[] } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const form = useForm({ resolver: zodResolver(templateSchema), defaultValues: { name: "", description: "", plan: "", validityDays: 30, notes: "", ...defaultValues } as TemplateInput });
  const e = form.formState.errors;
  const lines = (form.watch("lines") ?? []) as EditorLine[];
  const planId = form.watch("plan") ?? undefined;

  const onSubmit = form.handleSubmit((values) =>
    start(async () => {
      const res = await saveTemplateAction(templateId ?? null, values);
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message);
      router.push("/quotations/templates");
      router.refresh();
    })
  );

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <Panel title="Template">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Template name" htmlFor="name" error={e.name?.message} required>
            <Input id="name" {...form.register("name")} />
          </Field>
          <Field label="Default plan" htmlFor="plan">
            <NativeSelect id="plan" {...form.register("plan")}>
              <option value="">No default plan</option>
              {catalog.plans.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name}
                  {!p.available ? " (unavailable)" : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Description" htmlFor="description">
            <Input id="description" {...form.register("description")} />
          </Field>
          <Field label="Validity (days)" htmlFor="validityDays" error={e.validityDays?.message}>
            <Input id="validityDays" type="number" min={1} {...form.register("validityDays")} />
          </Field>
        </div>
      </Panel>
      <Panel title="Products">
        <LineItemsEditor
          catalog={catalog}
          lines={lines}
          planId={planId}
          includePlanFee
          onChange={(l) => form.setValue("lines", l.map(({ product, variant, quantity }) => ({ product, variant, quantity })), { shouldValidate: form.formState.isSubmitted })}
          error={e.lines?.message ?? (Array.isArray(e.lines) ? "Every line needs a product" : undefined)}
        />
      </Panel>
      <Panel title="Default notes">
        <Textarea rows={3} {...form.register("notes")} aria-label="Default notes" />
      </Panel>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />} {templateId ? "Save template" : "Create template"}
        </Button>
      </div>
    </form>
  );
}
