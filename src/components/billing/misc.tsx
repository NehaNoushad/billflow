"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Mail, Play, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/app/form-bits";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { runBillingAction } from "@/actions/billing";
import { emailInvoiceAction } from "@/actions/invoices";
import { recordPaymentAction } from "@/actions/payments";
import { PaymentFields, usePaymentForm } from "./record-payment-dialog";

export function PrintButton() {
  return (
    <Button variant="outline" size="sm" onClick={() => window.print()}>
      <Printer className="size-4" /> Print
    </Button>
  );
}

export function EmailInvoiceButton({ invoiceId, enabled, emailedAt }: { invoiceId: string; enabled: boolean; emailedAt?: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!enabled) {
    return (
      <span title="Configure SMTP to enable email" className="inline-flex">
        <Button variant="outline" size="sm" disabled>
          <Mail className="size-4" /> Email
        </Button>
      </span>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      title={emailedAt ? `Last emailed ${formatDate(emailedAt)}` : undefined}
      onClick={() =>
        start(async () => {
          const res = await emailInvoiceAction(invoiceId);
          if (res.ok) {
            toast.success(res.message ?? "Invoice emailed");
            router.refresh();
          } else toast.error(res.error);
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />} {emailedAt ? "Resend" : "Email"}
    </Button>
  );
}

type Summary = { executionId: string; generated: number; skipped: number; failed: number };

export function BillingRunForm({ today }: { today: string }) {
  const router = useRouter();
  const [asOf, setAsOf] = useState(today);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Summary | null>(null);

  const run = () =>
    start(async () => {
      const res = await runBillingAction({ asOf });
      if (!res.ok) return void toast.error(res.error);
      setResult(res.data!);
      const d = res.data!;
      toast[d.failed ? "warning" : "success"](`Billing run complete: ${d.generated} invoice(s) generated, ${d.skipped} skipped, ${d.failed} failed`);
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Bill everything due on or before" htmlFor="asOf" hint="Pick a future date to simulate upcoming billing cycles in a demo.">
          <Input id="asOf" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="sm:w-48" />
        </Field>
        <Button onClick={run} disabled={pending || !asOf} className="h-9 sm:mb-5">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Run billing now
        </Button>
      </div>
      {result && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 text-sm">
          Run finished: <b>{result.generated}</b> generated · <b>{result.skipped}</b> skipped · <b>{result.failed}</b> failed.{" "}
          <Link href={`/billing/${result.executionId}`} className="font-medium text-primary hover:underline">
            View execution summary →
          </Link>
        </div>
      )}
    </div>
  );
}

type OpenInvoice = { _id: string; number: string; customerName: string; amountDue: number; dueDate: string };

export function NewPaymentForm({ invoices, initialInvoice, allowPartial, today }: { invoices: OpenInvoice[]; initialInvoice?: string; allowPartial: boolean; today: string }) {
  const router = useRouter();
  const [invoiceId, setInvoiceId] = useState(initialInvoice && invoices.some((i) => i._id === initialInvoice) ? initialInvoice : "");
  const selected = invoices.find((i) => i._id === invoiceId);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const form = usePaymentForm(selected?.amountDue ?? 0, today);

  const choose = (id: string) => {
    setInvoiceId(id);
    const inv = invoices.find((i) => i._id === id);
    form.setValue("amount", inv ? (inv.amountDue / 100).toFixed(2) : "");
  };

  const submit = form.handleSubmit((v) =>
    start(async () => {
      setError(undefined);
      if (!invoiceId) return setError("Choose an invoice.");
      const res = await recordPaymentAction({ invoiceId, ...v });
      if (!res.ok) return setError(res.error);
      toast.success(res.data?.invoiceStatus === "PAID" ? "Payment recorded — invoice fully paid" : "Payment recorded");
      router.push(`/invoices/${invoiceId}`);
      router.refresh();
    })
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}
      <Field label="Invoice" htmlFor="invoice" required hint={invoices.length === 0 ? "No confirmed invoices with an outstanding balance." : undefined}>
        <NativeSelect id="invoice" value={invoiceId} onChange={(e) => choose(e.target.value)}>
          <option value="">Select an outstanding invoice…</option>
          {invoices.map((i) => (
            <option key={i._id} value={i._id}>
              {i.number} · {i.customerName} · {formatMoney(i.amountDue)} due {formatDate(i.dueDate)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {selected && <PaymentFields form={form} outstanding={selected.amountDue} allowPartial={allowPartial} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !selected}>
          {pending && <Loader2 className="size-4 animate-spin" />} Record payment
        </Button>
      </div>
    </form>
  );
}
