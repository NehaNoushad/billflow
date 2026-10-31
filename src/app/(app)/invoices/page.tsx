import Link from "next/link";
import { Plus, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { connectDB } from "@/lib/db";
import { Invoice } from "@/models";
import { requirePage, scopeFilter } from "@/lib/auth/guard";
import { escapeRegex, pageParam, sp } from "@/lib/utils-server";
import { PAGE_SIZE } from "@/lib/constants";
import { addDaysUTC, businessToday, formatDate, parseDateInput } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { overdueFilter, isOverdue } from "@/services/invoices";
import { EmptyState, PageHeader, Pagination, StatusBadge, tableCls } from "@/components/app/ui-bits";
import { FilterBar } from "@/components/app/filters";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("invoices.manage");
  const params = await searchParams;
  await connectDB();
  const today = businessToday();
  const page = pageParam(params);

  const filter: Record<string, unknown> = { ...(await scopeFilter(user)) };
  const q = sp(params, "q");
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ number: rx }, { "customerSnapshot.name": rx }, { "customerSnapshot.companyName": rx }, { subscriptionNumber: rx }];
  }
  const status = sp(params, "status");
  if (status === "OVERDUE") Object.assign(filter, overdueFilter(today));
  else if (status) filter.status = status;
  const source = sp(params, "source");
  if (source) filter.source = source;
  const range: Record<string, Date> = {};
  try {
    const from = sp(params, "from");
    const to = sp(params, "to");
    if (from) range.$gte = parseDateInput(from);
    if (to) range.$lt = addDaysUTC(parseDateInput(to), 1);
  } catch {
    /* ignore malformed dates */
  }
  if (Object.keys(range).length) filter.invoiceDate = range;

  const [rows, total, summary] = await Promise.all([
    Invoice.find(filter).sort({ invoiceDate: -1, number: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    Invoice.countDocuments(filter),
    Invoice.aggregate([
      { $match: { ...filter, status: filter.status ?? { $nin: ["CANCELLED", "DRAFT"] } } },
      { $group: { _id: null, invoiced: { $sum: "$total" }, collected: { $sum: "$amountPaid" }, outstanding: { $sum: "$amountDue" } } },
    ]),
  ]);
  const s = summary[0] ?? { invoiced: 0, collected: 0, outstanding: 0 };

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Recurring invoices from the billing engine and manual invoices."
        actions={
          <Button nativeButton={false} render={<Link href="/invoices/new" />}>
            <Plus className="size-4" /> New invoice
          </Button>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {[
          { label: "Invoiced (confirmed + paid)", value: s.invoiced, hint: "Total billed for the current filter", cls: "text-foreground" },
          { label: "Collected", value: s.collected, hint: "Payments applied to these invoices", cls: "text-emerald-700" },
          { label: "Outstanding", value: s.outstanding, hint: "Still owed by customers", cls: "text-amber-700" },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border bg-card px-4 py-3 shadow-xs">
            <p className="text-xs font-medium text-muted-foreground">{k.label}</p>
            <p className={`mt-0.5 text-xl font-semibold tabular-nums ${k.cls}`}>{formatMoney(k.value)}</p>
            <p className="text-[11px] text-muted-foreground">{k.hint}</p>
          </div>
        ))}
      </div>
      <div className="rounded-xl border bg-card shadow-xs">
        <FilterBar
          searchPlaceholder="Search number, customer, subscription…"
          dateRange
          filters={[
            { name: "status", label: "Statuses", options: ["DRAFT", "CONFIRMED", "OVERDUE", "PAID", "CANCELLED"].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() })) },
            { name: "source", label: "Sources", options: [{ value: "BILLING_ENGINE", label: "Billing engine" }, { value: "MANUAL", label: "Manual" }] },
          ]}
        />
        {rows.length === 0 ? (
          <EmptyState icon={Receipt} title="No invoices found" description="Try a different filter, or run billing to generate recurring invoices." />
        ) : (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead className={tableCls.thead}>
                <tr>
                  <th className={tableCls.th}>Invoice</th>
                  <th className={tableCls.th}>Customer</th>
                  <th className={tableCls.th}>Invoice date</th>
                  <th className={tableCls.th}>Due date</th>
                  <th className={tableCls.th}>Status</th>
                  <th className={`${tableCls.th} text-right`}>Total</th>
                  <th className={`${tableCls.th} text-right`}>Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((inv) => {
                  const overdue = isOverdue(inv, today);
                  return (
                    <tr key={String(inv._id)} className={tableCls.tr}>
                      <td className={tableCls.td}>
                        <Link href={`/invoices/${inv._id}`} className="font-medium text-primary hover:underline">
                          {inv.number}
                        </Link>
                        <div className="text-xs text-muted-foreground">{inv.source === "BILLING_ENGINE" ? `Auto · ${inv.subscriptionNumber ?? ""}` : "Manual"}</div>
                      </td>
                      <td className={tableCls.td}>
                        <div className="font-medium">{inv.customerSnapshot?.name}</div>
                        <div className="text-xs text-muted-foreground">{inv.customerSnapshot?.companyName}</div>
                      </td>
                      <td className={tableCls.td}>{formatDate(inv.invoiceDate)}</td>
                      <td className={`${tableCls.td} ${overdue ? "font-medium text-red-600" : ""}`}>{formatDate(inv.dueDate)}</td>
                      <td className={tableCls.td}>
                        <StatusBadge status={overdue ? "OVERDUE" : inv.status} />
                      </td>
                      <td className={tableCls.num}>{formatMoney(inv.total)}</td>
                      <td className={tableCls.num}>{inv.status === "CANCELLED" ? "—" : formatMoney(inv.amountDue)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} basePath="/invoices" params={params} />
      </div>
    </>
  );
}
