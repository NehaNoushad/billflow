import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Copy, Download, Pencil, Repeat, Send, XCircle } from "lucide-react";
import { connectDB } from "@/lib/db";
import { Customer, Quotation, Subscription, SubscriptionPlan } from "@/models";
import { canAccessCustomer, requirePage } from "@/lib/auth/guard";
import { getSettings, isObjectId } from "@/lib/utils-server";
import { formatDate, intervalLabel, perIntervalSuffix, type BillingInterval } from "@/lib/dates";
import { formatBps, formatMoney } from "@/lib/money";
import { expireQuotations } from "@/services/quotations";
import { formatAddress } from "@/services/invoices";
import { planAvailability } from "@/services/subscriptions";
import { acceptQuotationAction, convertQuotationAction, duplicateQuotationAction, rejectQuotationAction, sendQuotationAction } from "@/actions/quotations";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/app/action-button";
import { PageHeader, Panel, StatusBadge } from "@/components/app/ui-bits";
import { HistoryTimeline } from "@/components/sales/history-timeline";
import { PrintButton } from "@/components/sales/print-button";

type Line = { productName: string; variantName?: string; quantity: number; unitPrice: number; subtotal: number; discountAmount: number; taxAmount: number; total: number; taxes: { name: string }[] };

export default async function QuotationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("quotations.manage");
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  await connectDB();
  await expireQuotations({ _id: id });
  const q = await Quotation.findById(id).lean();
  if (!q || !(await canAccessCustomer(user, q.customer))) notFound();
  const [settings, customer, sub, plan] = await Promise.all([
    getSettings(),
    Customer.findById(q.customer).lean(),
    q.subscription ? Subscription.findById(q.subscription).select("number status").lean() : null,
    q.plan ? SubscriptionPlan.findById(q.plan).lean() : null,
  ]);
  const lines = q.lines as unknown as Line[];
  const planIssue = plan ? planAvailability(plan) : "Plan no longer exists";
  const s = q.status;

  return (
    <>
      <PageHeader
        title={`Quotation ${q.number}`}
        description={`${q.customerSnapshot?.name} · ${formatMoney(q.total)}`}
        back={{ href: "/quotations", label: "Quotations" }}
        actions={
          <>
            <PrintButton />
            <Button variant="outline" size="sm" nativeButton={false} render={<a href={`/api/quotations/${id}/pdf`} />}>
              <Download className="size-4" /> Download PDF
            </Button>
            <ActionButton action={duplicateQuotationAction.bind(null, id)}>
              <Copy className="size-4" /> Duplicate
            </ActionButton>
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="print-area rounded-xl border bg-white p-6 shadow-xs sm:p-10">
          <div className="flex flex-col justify-between gap-6 sm:flex-row">
            <div>
              <p className="text-lg font-bold tracking-wide text-primary">{settings.companyName}</p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">{settings.companyAddress}</p>
              {settings.companyTaxId && <p className="text-sm text-muted-foreground">GSTIN {settings.companyTaxId}</p>}
              <p className="text-sm text-muted-foreground">{settings.companyEmail}</p>
            </div>
            <div className="sm:text-right">
              <p className="text-2xl font-semibold">QUOTATION</p>
              <p className="text-sm text-muted-foreground">{q.number}</p>
              <div className="mt-2">
                <StatusBadge status={s} />
              </div>
            </div>
          </div>
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase">Prepared for</p>
              <p className="mt-1 font-medium">{q.customerSnapshot?.name}</p>
              {q.customerSnapshot?.companyName && <p className="text-sm">{q.customerSnapshot.companyName}</p>}
              <p className="text-sm text-muted-foreground">{q.customerSnapshot?.email}</p>
              <p className="text-sm text-muted-foreground">{formatAddress(customer?.billingAddress)}</p>
              {customer?.taxId && <p className="text-sm text-muted-foreground">GSTIN {customer.taxId}</p>}
            </div>
            <dl className="grid grid-cols-2 gap-2 text-sm sm:text-right">
              <dt className="text-muted-foreground">Quotation date</dt>
              <dd>{formatDate(q.quotationDate)}</dd>
              <dt className="text-muted-foreground">Valid until</dt>
              <dd>{formatDate(q.expiryDate)}</dd>
              <dt className="text-muted-foreground">Plan</dt>
              <dd>{q.planSnapshot?.name ?? "—"}</dd>
              <dt className="text-muted-foreground">Billing</dt>
              <dd>{q.planSnapshot?.billingInterval ? intervalLabel(q.planSnapshot.billingInterval as BillingInterval) : "—"}</dd>
            </dl>
          </div>
          <div className="mt-8 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="py-2 font-medium">Item</th>
                  <th className="py-2 text-right font-medium">Qty</th>
                  <th className="py-2 text-right font-medium">Unit price</th>
                  <th className="py-2 text-right font-medium">Discount</th>
                  <th className="py-2 text-right font-medium">Tax</th>
                  <th className="py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-2.5">
                      <p className="font-medium">{l.productName}</p>
                      <p className="text-xs text-muted-foreground">
                        {[l.variantName, l.taxes?.map((t) => t.name).join(" + ")].filter(Boolean).join(" · ")}
                      </p>
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{l.quantity}</td>
                    <td className="py-2.5 text-right tabular-nums">{formatMoney(l.unitPrice)}</td>
                    <td className="py-2.5 text-right tabular-nums">{l.discountAmount ? `−${formatMoney(l.discountAmount)}` : "—"}</td>
                    <td className="py-2.5 text-right tabular-nums">{formatMoney(l.taxAmount)}</td>
                    <td className="py-2.5 text-right font-medium tabular-nums">{formatMoney(l.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-6 flex justify-end">
            <dl className="w-full max-w-xs space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="tabular-nums">{formatMoney(q.subtotal)}</dd>
              </div>
              {(q.discounts as unknown as { name: string; type: string; value: number; amount: number }[]).map((d, i) => (
                <div key={i} className="flex justify-between text-emerald-700">
                  <dt>
                    {d.name} {d.type === "PERCENTAGE" ? `(${formatBps(d.value)})` : ""}
                  </dt>
                  <dd className="tabular-nums">−{formatMoney(d.amount)}</dd>
                </div>
              ))}
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Tax</dt>
                <dd className="tabular-nums">{formatMoney(q.taxTotal)}</dd>
              </div>
              <div className="flex justify-between border-t pt-2 text-base font-semibold">
                <dt>Total{q.planSnapshot?.billingInterval ? ` ${perIntervalSuffix(q.planSnapshot.billingInterval as BillingInterval)}` : ""}</dt>
                <dd className="tabular-nums">{formatMoney(q.total)}</dd>
              </div>
            </dl>
          </div>
          {q.notes && (
            <div className="mt-8 rounded-lg bg-muted/40 p-4 text-sm">
              <p className="mb-1 text-xs font-medium text-muted-foreground uppercase">Notes</p>
              <p className="whitespace-pre-wrap">{q.notes}</p>
            </div>
          )}
          <p className="mt-8 text-center text-xs text-muted-foreground">{settings.invoiceFooter}</p>
        </div>

        <div className="no-print space-y-6">
          <Panel title="Actions">
            <div className="flex flex-col gap-2">
              {s === "DRAFT" && (
                <>
                  <Button variant="outline" nativeButton={false} render={<Link href={`/quotations/${id}/edit`} />}>
                    <Pencil className="size-4" /> Edit draft
                  </Button>
                  <ActionButton action={sendQuotationAction.bind(null, id)} variant="default" size="default" confirm={{ title: "Send quotation?", description: `Mark ${q.number} as sent to ${q.customerSnapshot?.email}. It will be emailed if email is configured. Sent quotations can no longer be edited.`, confirmLabel: "Send" }}>
                    <Send className="size-4" /> Send to customer
                  </ActionButton>
                </>
              )}
              {s === "SENT" && (
                <ActionButton action={acceptQuotationAction.bind(null, id)} variant="default" size="default" confirm={{ title: "Mark as accepted?", description: "Record that the customer accepted this quotation. You can then convert it to a subscription." }}>
                  <CheckCircle2 className="size-4" /> Mark accepted
                </ActionButton>
              )}
              {(s === "DRAFT" || s === "SENT") && (
                <ActionButton action={rejectQuotationAction.bind(null, id)} size="default" confirm={{ title: "Reject quotation?", description: "Rejected quotations cannot be converted.", destructive: true, confirmLabel: "Reject", reasonLabel: "Reason (optional)" }}>
                  <XCircle className="size-4" /> Mark rejected
                </ActionButton>
              )}
              {s === "ACCEPTED" && !q.subscription && (
                <>
                  <ActionButton
                    action={convertQuotationAction.bind(null, id)}
                    variant="default"
                    size="default"
                    disabled={!!planIssue}
                    confirm={{ title: "Convert to subscription?", description: "Creates a confirmed subscription starting today with the quoted prices, taxes and discounts. You can activate it from the subscription page." }}
                  >
                    <Repeat className="size-4" /> Convert to subscription
                  </ActionButton>
                  {planIssue && <p className="text-xs text-destructive">Cannot convert: {planIssue}</p>}
                </>
              )}
              {sub && (
                <div className="rounded-lg border bg-emerald-50/60 p-3 text-sm">
                  Converted to{" "}
                  <Link href={`/subscriptions/${sub._id}`} className="font-medium text-primary hover:underline">
                    {sub.number}
                  </Link>{" "}
                  <StatusBadge status={sub.status} className="ml-1" />
                </div>
              )}
              {(s === "EXPIRED" || s === "REJECTED") && <p className="text-sm text-muted-foreground">This quotation is {s.toLowerCase()} and cannot be converted. Duplicate it to create a fresh draft.</p>}
            </div>
          </Panel>
          <Panel title="History">
            <HistoryTimeline entries={q.history as never} />
          </Panel>
        </div>
      </div>
    </>
  );
}
