"use client";

import { useRouter } from "next/navigation";
import { methodLabel } from "@/components/billing/labels";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Loader2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, NativeSelect } from "@/components/app/form-bits";
import { PAYMENT_METHODS } from "@/lib/constants";
import { formatMoney, toRupeeString } from "@/lib/money";
import { recordPaymentAction } from "@/actions/payments";

type Values = { amount: string; method: string; paymentDate: string; transactionRef: string; notes: string };

export function PaymentFields({ form, outstanding, allowPartial }: { form: ReturnType<typeof useForm<Values>>; outstanding: number; allowPartial: boolean }) {
  const e = form.formState.errors;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Amount (₹)" htmlFor="amount" required error={e.amount?.message} hint={allowPartial ? `Outstanding ${formatMoney(outstanding)} · partial payments allowed` : `Full amount required: ${formatMoney(outstanding)}`}>
        <Input id="amount" inputMode="decimal" readOnly={!allowPartial} {...form.register("amount", { required: "Enter an amount" })} />
      </Field>
      <Field label="Method" htmlFor="method" required>
        <NativeSelect id="method" {...form.register("method")}>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {methodLabel(m)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Payment date" htmlFor="paymentDate" required error={e.paymentDate?.message}>
        <Input id="paymentDate" type="date" {...form.register("paymentDate", { required: "Choose a date" })} />
      </Field>
      <Field label="Transaction reference" htmlFor="transactionRef" hint="UTR, UPI ref, cheque no., etc.">
        <Input id="transactionRef" {...form.register("transactionRef")} />
      </Field>
      <Field label="Notes" htmlFor="notes" className="sm:col-span-2">
        <Textarea id="notes" rows={2} {...form.register("notes")} />
      </Field>
    </div>
  );
}

export function usePaymentForm(outstanding: number, today: string) {
  return useForm<Values>({ defaultValues: { amount: toRupeeString(outstanding), method: "BANK_TRANSFER", paymentDate: today, transactionRef: "", notes: "" } });
}

export function RecordPaymentDialog({ invoiceId, invoiceNumber, outstanding, allowPartial, today }: { invoiceId: string; invoiceNumber: string; outstanding: number; allowPartial: boolean; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const form = usePaymentForm(outstanding, today);

  const submit = form.handleSubmit((v) =>
    start(async () => {
      setError(undefined);
      const res = await recordPaymentAction({ invoiceId, ...v });
      if (!res.ok) return setError(res.error);
      toast.success(res.data?.invoiceStatus === "PAID" ? `Payment recorded — ${invoiceNumber} is fully paid` : "Partial payment recorded");
      setOpen(false);
      router.refresh();
    })
  );

  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          form.reset({ amount: toRupeeString(outstanding), method: "BANK_TRANSFER", paymentDate: today, transactionRef: "", notes: "" });
          setError(undefined);
          setOpen(true);
        }}
      >
        <Wallet className="size-4" /> Record payment
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record payment for {invoiceNumber}</DialogTitle>
            <DialogDescription>Record money already received (bank transfer, UPI, cash…). No payment gateway is charged.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            {error && <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}
            <PaymentFields form={form} outstanding={outstanding} allowPartial={allowPartial} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" />} Save payment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
