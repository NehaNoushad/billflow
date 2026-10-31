import { notFound } from "next/navigation";
import { CreditCard, Download, Info } from "lucide-react";
import { requirePage } from "@/lib/auth/guard";
import { connectDB } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/constants";
import { formatBps, formatMoney } from "@/lib/money";
import { isObjectId } from "@/lib/utils-server";
import { Invoice, InvoiceLine, Payment } from "@/models";
import { isOverdue } from "@/services/invoices";
import { ActionButton } from "@/components/app/action-button";
import { DetailList, PageHeader, Panel, StatusBadge, tableCls } from "@/components/app/ui-bits";
import { paySimulatedAction } from "@/actions/portal";

export const metadata = { title: "Invoice" };

export default async function PortalInvoiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("portal.access");
  await connectDB();
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  // Ownership enforced in the query itself.
  const invoice = await Invoice.findOne({ _id: id, customer: user.customerId, status: { $ne: "DRAFT" } }).lean();
  if (!invoice) notFound();
  const [lines, payments] = await Promise.all([
    InvoiceLine.find({ invoice: invoice._id }).sort({ position: 1 }).lean(),
    Payment.find({ invoice: invoice._id, customer: user.customerId }).sort({ paymentDate: -1 }).lean(),
  ]);
  const overdue = isOverdue(invoice);
  const payable = invoice.status === "CONFIRMED" && invoice.amountDue > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={invoice.number}
        back={{ href: "/portal/invoices", label: "My invoices" }}
        description={invoice.subscriptionNumber ? `Subscription ${invoice.subscriptionNumber}` : "Invoice"}
        actions={
          <>
            <a href={`/api/invoices/${invoice._id}/pdf`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-white px-2.5 text-sm font-medium hover:bg-muted">
              <Download className="size-4" /> Download PDF
            </a>
            {payable && (
              <ActionButton
                action={paySimulatedAction.bind(null, String(invoice._id))}
                variant="default"
                size="default"
                confirm={{ title: `Pay ${formatMoney(invoice.amountDue)}?`, description: "Demo payment — no real money is collected. A simulated card payment will be recorded against this invoice.", confirmLabel: "Pay (demo)" }}
              >
                <CreditCard className="size-4" /> Pay now (simulated)
              </ActionButton>
            )}
          </>
        }
      />

      {payable && (
        <div className="flex items-start gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
          <Info className="mt-0.5 size-4 shrink-0" />
          <span>Online payment here is a demonstration: no payment gateway is connected and no real money is collected. Payments by bank transfer or UPI are recorded by our team.</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel title="Details" className="xl:col-span-2">
          <DetailList
            items={[
              { label: "Status", value: <StatusBadge status={overdue ? "OVERDUE" : invoice.status} /> },
              { label: "Invoice date", value: formatDate(invoice.invoiceDate) },
              { label: "Due date", value: formatDate(invoice.dueDate) },
              { label: "Payment terms", value: `Net ${invoice.paymentTermsDays} days` },
              { label: "Billing period", value: invoice.periodStart ? `${formatDate(invoice.periodStart)} – ${formatDate(invoice.periodEnd)}` : "—" },
              { label: "Billed to", value: invoice.customerSnapshot?.companyName || invoice.customerSnapshot?.name },
            ]}
          />
        </Panel>
        <Panel title="Balance">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Total</dt>
              <dd className="tabular-nums">{formatMoney(invoice.total)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Paid</dt>
              <dd className="tabular-nums">{formatMoney(invoice.amountPaid)}</dd>
            </div>
            <div className="flex justify-between border-t pt-2 text-base font-semibold">
              <dt>Outstanding</dt>
              <dd className="tabular-nums">{formatMoney(invoice.amountDue)}</dd>
            </div>
          </dl>
        </Panel>
      </div>

      <Panel title="Items" bodyClassName="p-0">
        <div className={tableCls.wrap}>
          <table className={tableCls.table}>
            <thead className={tableCls.thead}>
              <tr>
                <th className={tableCls.th}>Description</th>
                <th className={`${tableCls.th} text-right`}>Qty</th>
                <th className={`${tableCls.th} text-right`}>Unit price</th>
                <th className={`${tableCls.th} text-right`}>Discount</th>
                <th className={`${tableCls.th} text-right`}>Tax</th>
                <th className={`${tableCls.th} text-right`}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={String(l._id)} className={tableCls.tr}>
                  <td className={tableCls.td}>
                    {l.productName}
                    {l.variantName && <span className="text-muted-foreground"> · {l.variantName}</span>}
                  </td>
                  <td className={tableCls.num}>{l.quantity}</td>
                  <td className={tableCls.num}>{formatMoney(l.unitPrice)}</td>
                  <td className={tableCls.num}>{l.discountAmount ? `−${formatMoney(l.discountAmount)}` : "—"}</td>
                  <td className={tableCls.num}>{formatMoney(l.taxAmount)}</td>
                  <td className={tableCls.num}>{formatMoney(l.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end border-t p-5">
          <dl className="w-full max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="tabular-nums">{formatMoney(invoice.subtotal)}</dd>
            </div>
            {(invoice.discounts as { name: string; type: string; value: number; amount: number }[]).map((d, i) => (
              <div key={i} className="flex justify-between text-emerald-700">
                <dt>
                  {d.name}
                  {d.type === "PERCENTAGE" ? ` (${formatBps(d.value)})` : ""}
                </dt>
                <dd className="tabular-nums">−{formatMoney(d.amount)}</dd>
              </div>
            ))}
            {((invoice.taxBreakdown ?? []) as { name?: string | null; amount?: number | null }[]).map((t, i) => (
              <div key={i} className="flex justify-between">
                <dt className="text-muted-foreground">{t.name}</dt>
                <dd className="tabular-nums">{formatMoney(t.amount ?? 0)}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatMoney(invoice.total)}</dd>
            </div>
          </dl>
        </div>
      </Panel>

      <Panel title="Payments" bodyClassName="p-0">
        {payments.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">No payments recorded yet.</p>
        ) : (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead className={tableCls.thead}>
                <tr>
                  <th className={tableCls.th}>Payment</th>
                  <th className={tableCls.th}>Date</th>
                  <th className={tableCls.th}>Method</th>
                  <th className={`${tableCls.th} text-right`}>Amount</th>
                  <th className={tableCls.th}>Status</th>
                  <th className={tableCls.th} />
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={String(p._id)} className={tableCls.tr}>
                    <td className={tableCls.td}>
                      {p.number}
                      {p.simulated && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">DEMO</span>}
                    </td>
                    <td className={tableCls.td}>{formatDate(p.paymentDate)}</td>
                    <td className={tableCls.td}>{humanize(p.method)}</td>
                    <td className={tableCls.num}>{formatMoney(p.amount)}</td>
                    <td className={tableCls.td}>
                      <StatusBadge status={p.status} />
                    </td>
                    <td className={`${tableCls.td} text-right`}>
                      {p.status === "COMPLETED" && (
                        <a href={`/api/payments/${p._id}/receipt`} className="text-xs font-medium text-primary hover:underline">
                          Receipt
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
