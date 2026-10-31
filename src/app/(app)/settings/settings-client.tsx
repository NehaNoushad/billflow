"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CheckboxField, Field } from "@/components/app/form-bits";
import { Panel } from "@/components/app/ui-bits";
import { ActionButton } from "@/components/app/action-button";
import { resetDemoAction, updateSettingsAction, type SettingsInput } from "@/actions/admin";

type Settings = SettingsInput & { _id: string };

export function SettingsForm({ settings }: { settings: Settings }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const form = useForm<SettingsInput>({
    defaultValues: {
      companyName: settings.companyName ?? "",
      companyEmail: settings.companyEmail ?? "",
      companyPhone: settings.companyPhone ?? "",
      companyAddress: settings.companyAddress ?? "",
      companyTaxId: settings.companyTaxId ?? "",
      defaultPaymentTermsDays: settings.defaultPaymentTermsDays ?? 15,
      autoConfirmInvoices: settings.autoConfirmInvoices ?? true,
      allowPartialPayments: settings.allowPartialPayments ?? true,
      chargeDuringPause: settings.chargeDuringPause ?? false,
      invoiceFooter: settings.invoiceFooter ?? "",
    },
  });

  const onSubmit = form.handleSubmit((values) =>
    start(async () => {
      const res = await updateSettingsAction(values);
      if (!res.ok) {
        for (const [k, msg] of Object.entries(res.fieldErrors ?? {})) form.setError(k as keyof SettingsInput, { message: msg });
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.refresh();
    })
  );
  const e = form.formState.errors;

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Panel title="Company" description="Shown on invoices, quotations and receipts.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name" htmlFor="companyName" error={e.companyName?.message} required>
            <Input id="companyName" {...form.register("companyName")} />
          </Field>
          <Field label="Billing email" htmlFor="companyEmail" error={e.companyEmail?.message} required>
            <Input id="companyEmail" type="email" {...form.register("companyEmail")} />
          </Field>
          <Field label="Phone" htmlFor="companyPhone">
            <Input id="companyPhone" {...form.register("companyPhone")} />
          </Field>
          <Field label="GSTIN" htmlFor="companyTaxId" error={e.companyTaxId?.message}>
            <Input id="companyTaxId" {...form.register("companyTaxId")} />
          </Field>
          <Field label="Address" htmlFor="companyAddress" className="sm:col-span-2">
            <Textarea id="companyAddress" rows={2} {...form.register("companyAddress")} />
          </Field>
          <Field label="Invoice footer" htmlFor="invoiceFooter" className="sm:col-span-2">
            <Input id="invoiceFooter" {...form.register("invoiceFooter")} />
          </Field>
        </div>
      </Panel>
      <Panel title="Billing rules" description="Applied by the recurring billing engine and payment recording.">
        <div className="space-y-3">
          <Field label="Default payment terms (days)" htmlFor="terms" error={e.defaultPaymentTermsDays?.message} className="max-w-xs">
            <Input id="terms" type="number" min={0} {...form.register("defaultPaymentTermsDays", { valueAsNumber: true })} />
          </Field>
          <CheckboxField label="Auto-confirm generated invoices" description="Invoices from the billing engine are confirmed (and payable) immediately. Off = they are created as drafts for review." {...form.register("autoConfirmInvoices")} />
          <CheckboxField label="Allow partial payments" description="Multiple payments can be recorded against one invoice. An invoice is marked Paid only when its balance reaches zero." {...form.register("allowPartialPayments")} />
          <CheckboxField label="Charge during pause" description="Off (recommended): paused subscriptions are skipped and their billing date shifts forward on resume." {...form.register("chargeDuringPause")} />
        </div>
      </Panel>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />} Save settings
        </Button>
      </div>
    </form>
  );
}

export function DemoReset() {
  return (
    <Panel title="Demo mode" description="For hackathon presentations.">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">Wipe the database and reload the realistic demo dataset (customers, subscriptions, invoices, payments and planted revenue issues). You will be signed out.</p>
        <ActionButton
          action={resetDemoAction}
          variant="destructive"
          redirectTo="/login"
          confirm={{ title: "Reset all data?", description: "Every record in the database will be deleted and replaced with demo data. This cannot be undone.", confirmLabel: "Reset demo data", destructive: true }}
        >
          <RotateCcw className="size-4" /> Reset demo data
        </ActionButton>
      </div>
    </Panel>
  );
}
