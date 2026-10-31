import Link from "next/link";
import { Download } from "lucide-react";
import { requirePage } from "@/lib/auth/guard";
import { connectDB } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { PAGE_SIZE } from "@/lib/constants";
import { formatMoney } from "@/lib/money";
import { pageParam, sp } from "@/lib/utils-server";
import { Invoice } from "@/models";
import { isOverdue, overdueFilter } from "@/services/invoices";
import { EmptyState, PageHeader, Pagination, Panel, StatusBadge, tableCls } from "@/components/app/ui-bits";
import { cn } from "@/lib/utils";

export const metadata = { title: "My invoices" };

const TABS = [
  { key: "", label: "All" },
  { key: "unpaid", label: "Unpaid" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
];

export default async function PortalInvoices({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("portal.access");
  await connectDB();
  const params = await searchParams;
  const page = pageParam(params);
  const tab = sp(params, "status") ?? "";
  // Drafts are internal and never shown to customers.
  const filter: Record<string, unknown> = { customer: user.customerId, status: { $ne: "DRAFT" } };
  if (tab === "unpaid") Object.assign(filter, { status: "CONFIRMED", amountDue: { $gt: 0 } });
  if (tab === "overdue") Object.assign(filter, overdueFilter());
  if (tab === "paid") filter.status = "PAID";

  const [invoices, total] = await Promise.all([
    Invoice.find(filter).select("number invoiceDate dueDate periodStart periodEnd total amountPaid amountDue status subscriptionNumber").sort({ invoiceDate: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    Invoice.countDocuments(filter),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="My invoices" description="View, download and pay your invoices." />
      <Panel bodyClassName="p-0">
        <div className="flex gap-1 border-b p-2">
          {TABS.map((t) => (
            <Link key={t.key} href={t.key ? `/portal/invoices?status=${t.key}` : "/portal/invoices"} className={cn("rounded-md px-3 py-1.5 text-sm", tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
              {t.label}
            </Link>
          ))}
        </div>
        {invoices.length === 0 ? (
          <EmptyState title="No invoices" description="Nothing matches this filter." />
        ) : (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead className={tableCls.thead}>
                <tr>
                  <th className={tableCls.th}>Invoice</th>
                  <th className={tableCls.th}>Date</th>
                  <th className={tableCls.th}>Billing period</th>
                  <th className={tableCls.th}>Due date</th>
                  <th className={`${tableCls.th} text-right`}>Total</th>
                  <th className={`${tableCls.th} text-right`}>Balance</th>
                  <th className={tableCls.th}>Status</th>
                  <th className={tableCls.th} />
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={String(inv._id)} className={tableCls.tr}>
                    <td className={tableCls.td}>
                      <Link href={`/portal/invoices/${inv._id}`} className="font-medium text-primary hover:underline">
                        {inv.number}
                      </Link>
                    </td>
                    <td className={tableCls.td}>{formatDate(inv.invoiceDate)}</td>
                    <td className={tableCls.td}>{inv.periodStart ? `${formatDate(inv.periodStart)} – ${formatDate(inv.periodEnd)}` : "—"}</td>
                    <td className={tableCls.td}>{formatDate(inv.dueDate)}</td>
                    <td className={tableCls.num}>{formatMoney(inv.total)}</td>
                    <td className={tableCls.num}>{formatMoney(inv.amountDue)}</td>
                    <td className={tableCls.td}>
                      <StatusBadge status={isOverdue(inv) ? "OVERDUE" : inv.status} />
                    </td>
                    <td className={`${tableCls.td} text-right`}>
                      <a href={`/api/invoices/${inv._id}/pdf`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                        <Download className="size-3.5" /> PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} basePath="/portal/invoices" params={params} />
      </Panel>
    </div>
  );
}
