import Link from "next/link";
import { Download } from "lucide-react";
import { requirePage, scopeFilter } from "@/lib/auth/guard";
import { connectDB } from "@/lib/db";
import { addDaysUTC, monthLabel, resolvePeriod, toDateInput } from "@/lib/dates";
import { humanize, INVOICE_STATUSES, SUBSCRIPTION_STATUSES } from "@/lib/constants";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { sp } from "@/lib/utils-server";
import { Customer, Product, SubscriptionPlan } from "@/models";
import { buildMatches, monthlyRevenue, subscriptionTrends, customerGrowth, revenueByPlan, revenueByProduct, annualRevenue } from "@/services/analytics";
import { buildReport, isReportKey, REPORTS, type Column, type Row } from "@/services/reports";
import { EmptyState, PageHeader, Panel, tableCls } from "@/components/app/ui-bits";
import { ReportFilters } from "@/components/insights/report-filters";
import { RankedBars, RevenueChart, SubscriptionGrowthChart, TrendLine } from "@/components/charts/charts";
import { reportFiltersFrom } from "./filters";

export const metadata = { title: "Reports" };

function Cell({ column, row }: { column: Column; row: Row }) {
  const v = row[column.key];
  if (column.type === "money") return <td className={tableCls.num}>{v === undefined || v === null || v === "" ? "" : formatMoney(Number(v))}</td>;
  if (column.type === "number") return <td className={tableCls.num}>{v ?? ""}</td>;
  if (column.type === "link" && row.href) {
    return (
      <td className={tableCls.td}>
        <Link href={String(row.href)} className="font-medium text-primary hover:underline">
          {v}
        </Link>
      </td>
    );
  }
  return <td className={tableCls.td}>{v ?? ""}</td>;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("reports.view");
  await connectDB();
  const params = await searchParams;
  const tabParam = sp(params, "tab");
  const tab = isReportKey(tabParam) ? tabParam : "monthly";
  const from = sp(params, "from");
  const to = sp(params, "to");
  const period = resolvePeriod(from && to ? "custom" : "12m", from, to);
  const filters = reportFiltersFrom(params);
  const scope = await scopeFilter(user);
  const m = await buildMatches(scope, filters);

  const [report, products, plans, customers] = await Promise.all([
    buildReport(tab, m, period, filters),
    Product.find().select("name").sort({ name: 1 }).lean(),
    SubscriptionPlan.find().select("name").sort({ name: 1 }).lean(),
    Customer.find(scope.customer ? { _id: scope.customer } : {}).select("name companyName").sort({ companyName: 1 }).lean(),
  ]);

  // Chart data per report (same aggregations as the table).
  let chart: React.ReactNode = null;
  if (tab === "monthly") chart = <RevenueChart data={(await monthlyRevenue(m, period)).map((r) => ({ label: monthLabel(r.month), invoiced: r.invoiced, collected: r.collected }))} />;
  if (tab === "annual") chart = <RevenueChart data={(await annualRevenue(m)).map((r) => ({ label: String(r.year), invoiced: r.invoiced, collected: r.collected }))} />;
  if (tab === "mrr") chart = <TrendLine data={(await subscriptionTrends(m, period)).map((t) => ({ label: monthLabel(t.month), mrr: t.mrr }))} dataKey="mrr" name="MRR" />;
  if (tab === "new" || tab === "closed") chart = <SubscriptionGrowthChart data={(await subscriptionTrends(m, period)).map((t) => ({ label: monthLabel(t.month), added: t.added, closed: t.closed }))} />;
  if (tab === "product") chart = <RankedBars data={await revenueByProduct(m, period, filters.product)} />;
  if (tab === "plan") chart = <RankedBars data={(await revenueByPlan(m, period)).map((p) => ({ name: p.name, amount: p.net }))} />;
  if (tab === "customers") chart = <TrendLine data={(await customerGrowth(m, period)).map((c) => ({ label: monthLabel(c.month), total: c.total }))} dataKey="total" name="Total customers" kind="count" />;

  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (typeof v === "string" && v && k !== "tab") query.set(k, v);
  const exportHref = `/api/reports/export?report=${tab}${query.size ? `&${query}` : ""}`;
  const tabHref = (key: string) => `/reports?${new URLSearchParams({ ...Object.fromEntries(query), tab: key })}`;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        description={`Financial and subscription reporting${user.role === "STAFF" ? " for your assigned customers" : ""}. Invoiced and collected amounts are always reported separately.`}
        actions={
          <a href={exportHref} className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-white px-2.5 text-sm font-medium hover:bg-muted" download>
            <Download className="size-4" /> Export CSV
          </a>
        }
      />
      <ReportFilters
        defaultFrom={toDateInput(period.from)}
        defaultTo={toDateInput(addDaysUTC(period.to, -1))}
        products={products.map((p) => ({ value: String(p._id), label: p.name }))}
        plans={plans.map((p) => ({ value: String(p._id), label: p.name }))}
        customers={customers.map((c) => ({ value: String(c._id), label: c.companyName || c.name }))}
        subscriptionStatuses={SUBSCRIPTION_STATUSES.map((s) => ({ value: s, label: humanize(s) }))}
        invoiceStatuses={[...INVOICE_STATUSES, "OVERDUE"].map((s) => ({ value: s, label: humanize(s) }))}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[200px_1fr]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Reports">
          {REPORTS.map((r) => (
            <Link key={r.key} href={tabHref(r.key)} className={cn("rounded-md px-3 py-2 text-sm whitespace-nowrap", r.key === tab ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
              {r.label}
            </Link>
          ))}
        </nav>

        <div className="min-w-0 space-y-5">
          {chart && (
            <Panel title={report.title} description={report.description}>
              {chart}
            </Panel>
          )}
          <Panel title={chart ? "Data" : report.title} description={chart ? `${report.rows.length} rows` : report.description} bodyClassName="p-0">
            {report.rows.length === 0 ? (
              <EmptyState title="No data" description="Nothing matches these filters for the selected period." />
            ) : (
              <div className={tableCls.wrap}>
                <table className={tableCls.table}>
                  <thead className={tableCls.thead}>
                    <tr>
                      {report.columns.map((c) => (
                        <th key={c.key} className={cn(tableCls.th, (c.type === "money" || c.type === "number") && "text-right")}>
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((r, i) => (
                      <tr key={i} className={tableCls.tr}>
                        {report.columns.map((c) => (
                          <Cell key={c.key} column={c} row={r} />
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  {report.totals && (
                    <tfoot className="border-t-2 bg-muted/30 font-semibold">
                      <tr>
                        {report.columns.map((c) => (
                          <Cell key={c.key} column={{ ...c, type: c.type === "link" ? "text" : c.type }} row={report.totals!} />
                        ))}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
