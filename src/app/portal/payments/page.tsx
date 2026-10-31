import Link from "next/link";
import { Download } from "lucide-react";
import { requirePage } from "@/lib/auth/guard";
import { connectDB } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { humanize, PAGE_SIZE } from "@/lib/constants";
import { formatMoney } from "@/lib/money";
import { pageParam } from "@/lib/utils-server";
import { Payment } from "@/models";
import { EmptyState, PageHeader, Pagination, Panel, StatusBadge, tableCls } from "@/components/app/ui-bits";

export const metadata = { title: "Payment history" };

export default async function PortalPayments({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("portal.access");
  await connectDB();
  const params = await searchParams;
  const page = pageParam(params);
  const filter = { customer: user.customerId };
  const [payments, total] = await Promise.all([
    Payment.find(filter).sort({ paymentDate: -1, createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    Payment.countDocuments(filter),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Payment history" description="Every payment recorded against your invoices." />
      <Panel bodyClassName="p-0">
        {payments.length === 0 ? (
          <EmptyState title="No payments yet" />
        ) : (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead className={tableCls.thead}>
                <tr>
                  <th className={tableCls.th}>Payment</th>
                  <th className={tableCls.th}>Date</th>
                  <th className={tableCls.th}>Invoice</th>
                  <th className={tableCls.th}>Method</th>
                  <th className={tableCls.th}>Reference</th>
                  <th className={`${tableCls.th} text-right`}>Amount</th>
                  <th className={tableCls.th}>Status</th>
                  <th className={tableCls.th} />
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={String(p._id)} className={tableCls.tr}>
                    <td className={tableCls.td}>
                      <span className="font-medium">{p.number}</span>
                      {p.simulated && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600" title="Demo payment — no real money collected">DEMO</span>}
                    </td>
                    <td className={tableCls.td}>{formatDate(p.paymentDate)}</td>
                    <td className={tableCls.td}>
                      <Link href={`/portal/invoices/${p.invoice}`} className="text-primary hover:underline">
                        {p.invoiceNumber}
                      </Link>
                    </td>
                    <td className={tableCls.td}>{humanize(p.method)}</td>
                    <td className={`${tableCls.td} text-muted-foreground`}>{p.transactionRef || "—"}</td>
                    <td className={tableCls.num}>{formatMoney(p.amount)}</td>
                    <td className={tableCls.td}>
                      <StatusBadge status={p.status} />
                    </td>
                    <td className={`${tableCls.td} text-right`}>
                      {p.status === "COMPLETED" && (
                        <a href={`/api/payments/${p._id}/receipt`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                          <Download className="size-3.5" /> Receipt
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} basePath="/portal/payments" params={params} />
      </Panel>
    </div>
  );
}
