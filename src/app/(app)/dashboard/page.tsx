import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarClock, IndianRupee, Receipt, Repeat, TrendingUp, Users, Wallet, Clock } from "lucide-react";
import { requirePage, scopeFilter } from "@/lib/auth/guard";
import { connectDB } from "@/lib/db";
import { formatDate, formatDateTime, intervalLabel, monthLabel, resolvePeriod, type BillingInterval } from "@/lib/dates";
import { formatMoney, formatMoneyCompact } from "@/lib/money";
import { sp } from "@/lib/utils-server";
import { SubscriptionRequest } from "@/models";
import { buildMatches, clampPeriod, getKpis, monthlyRevenue, recentActivity, recentInvoices, revenueByProduct, statusDistribution, subscriptionTrends, upcomingRenewals } from "@/services/analytics";
import { isOverdue } from "@/services/invoices";
import { EmptyState, KpiCard, PageHeader, Panel, StatusBadge, tableCls } from "@/components/app/ui-bits";
import { PeriodSelect } from "@/components/insights/period-select";
import { RankedBars, RevenueChart, StatusDonut, SubscriptionGrowthChart, TrendLine } from "@/components/charts/charts";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("dashboard.view");
  await connectDB();
  const params = await searchParams;
  const resolved = resolvePeriod(sp(params, "period"), sp(params, "from"), sp(params, "to"));
  const scope = await scopeFilter(user);
  const m = await buildMatches(scope);
  const period = await clampPeriod(resolved, m);

  const [kpis, revenue, trends, distribution, byProduct, renewals, invoices, activity, pendingRequests] = await Promise.all([
    getKpis(m, period),
    monthlyRevenue(m, period),
    subscriptionTrends(m, period),
    statusDistribution(m, period),
    revenueByProduct(m, period),
    upcomingRenewals(m),
    recentInvoices(m),
    recentActivity(m),
    SubscriptionRequest.countDocuments({ ...scope, status: "PENDING" }),
  ]);

  const growth = kpis.growth;
  const label = (k: string) => monthLabel(k);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`${user.role === "STAFF" ? "Your assigned customers" : "All customers"} · ${resolved.label}`}
        actions={<PeriodSelect current={resolved.preset} />}
      />

      {pendingRequests > 0 && (
        <Link href="/subscriptions?requests=pending" className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100">
          <AlertTriangle className="size-4 shrink-0" />
          <span>
            <strong>{pendingRequests}</strong> customer request{pendingRequests === 1 ? "" : "s"} (pause, cancellation or plan change) awaiting review
          </span>
          <ArrowRight className="ml-auto size-4" />
        </Link>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total revenue (collected)" value={formatMoney(kpis.collected)} icon={Wallet} tone="green" hint={`${kpis.paymentsCount} payments · invoiced ${formatMoneyCompact(kpis.invoiced)}`} />
        <KpiCard label="Monthly recurring revenue" value={formatMoney(kpis.mrr)} icon={Repeat} hint="Active subscriptions, excl. tax" />
        <KpiCard label="Annual recurring revenue" value={formatMoney(kpis.arr)} icon={TrendingUp} hint="MRR × 12" />
        <KpiCard label="Active subscriptions" value={String(kpis.activeSubscriptions)} icon={CalendarClock} tone="blue" hint="Currently billing" />
        <KpiCard label="Total customers" value={String(kpis.customers)} icon={Users} tone="gray" hint="Active customer accounts" />
        <KpiCard label="Outstanding payments" value={formatMoney(kpis.outstanding)} icon={IndianRupee} tone="amber" hint={`${kpis.outstandingCount} unpaid confirmed invoices`} />
        <KpiCard label="Overdue invoices" value={String(kpis.overdueCount)} icon={Clock} tone="red" hint={`${formatMoney(kpis.overdue)} past due date`} />
        <KpiCard
          label="Revenue growth"
          value={growth === null ? "—" : `${growth >= 0 ? "+" : ""}${growth.toFixed(1)}%`}
          icon={TrendingUp}
          tone={growth === null ? "gray" : growth >= 0 ? "green" : "red"}
          hint={growth === null ? "No collections in previous period" : `Collected vs previous ${resolved.preset === "all" ? "period" : "equal period"} (${formatMoneyCompact(kpis.previousCollected)})`}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel title="Monthly revenue" description="Invoiced (confirmed + paid invoices) vs collected (completed payments)" className="xl:col-span-2">
          <RevenueChart data={revenue.map((r) => ({ label: label(r.month), invoiced: r.invoiced, collected: r.collected }))} />
        </Panel>
        <Panel title="Invoice status" description="Invoices dated in this period">
          <StatusDonut data={distribution} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel title="MRR trend" description="Recurring revenue at each month end, excl. tax">
          <TrendLine data={trends.map((t) => ({ label: label(t.month), mrr: t.mrr }))} dataKey="mrr" name="MRR" />
        </Panel>
        <Panel title="Subscription growth" description="New and closed subscriptions per month">
          <SubscriptionGrowthChart data={trends.map((t) => ({ label: label(t.month), added: t.added, closed: t.closed }))} />
        </Panel>
        <Panel title="Revenue by product" description="Net of discounts, excl. tax">
          <RankedBars data={byProduct.slice(0, 8)} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel title="Recent invoices" className="xl:col-span-2" bodyClassName="p-0" actions={<Link href="/invoices" className="text-xs font-medium text-primary hover:underline">View all</Link>}>
          {invoices.length === 0 ? (
            <EmptyState title="No invoices yet" description="Run billing or create an invoice to see it here." icon={Receipt} />
          ) : (
            <div className={tableCls.wrap}>
              <table className={tableCls.table}>
                <thead className={tableCls.thead}>
                  <tr>
                    <th className={tableCls.th}>Invoice</th>
                    <th className={tableCls.th}>Customer</th>
                    <th className={tableCls.th}>Date</th>
                    <th className={`${tableCls.th} hidden 2xl:table-cell`}>Due</th>
                    <th className={`${tableCls.th} text-right`}>Total</th>
                    <th className={tableCls.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={String(inv._id)} className={tableCls.tr}>
                      <td className={tableCls.td}>
                        <Link href={`/invoices/${inv._id}`} className="font-medium text-primary hover:underline">
                          {inv.number}
                        </Link>
                      </td>
                      <td className={tableCls.td}>{inv.customerSnapshot?.companyName || inv.customerSnapshot?.name}</td>
                      <td className={tableCls.td}>{formatDate(inv.invoiceDate)}</td>
                      <td className={`${tableCls.td} hidden 2xl:table-cell`}>{formatDate(inv.dueDate)}</td>
                      <td className={tableCls.num}>{formatMoney(inv.total)}</td>
                      <td className={tableCls.td}>
                        <StatusBadge status={isOverdue(inv) ? "OVERDUE" : inv.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Upcoming renewals" bodyClassName="p-0" actions={<Link href="/subscriptions?expiring=30" className="text-xs font-medium text-primary hover:underline">View all</Link>}>
          {renewals.expiring.length === 0 && renewals.billing.length === 0 ? (
            <EmptyState title="Nothing due soon" description="No subscriptions expire in 30 days or bill in the next 7 days." icon={CalendarClock} />
          ) : (
            <ul className="divide-y text-sm">
              {renewals.expiring.map((s) => (
                <li key={`e-${s._id}`} className="flex items-center gap-3 px-5 py-3">
                  <span className="min-w-0 flex-1">
                    <Link href={`/subscriptions/${s._id}`} className="block truncate font-medium hover:underline">
                      {s.customerSnapshot?.companyName || s.customerSnapshot?.name}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {s.number} · {s.planSnapshot?.name}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-xs font-medium text-amber-700">Expires {formatDate(s.expiryDate)}</span>
                    <span className="block text-xs text-muted-foreground tabular-nums">{formatMoney(s.total)}</span>
                  </span>
                </li>
              ))}
              {renewals.billing.map((s) => (
                <li key={`b-${s._id}`} className="flex items-center gap-3 px-5 py-3">
                  <span className="min-w-0 flex-1">
                    <Link href={`/subscriptions/${s._id}`} className="block truncate font-medium hover:underline">
                      {s.customerSnapshot?.companyName || s.customerSnapshot?.name}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {s.number} · {intervalLabel(s.billingInterval as BillingInterval)}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-xs font-medium text-indigo-700">Bills {formatDate(s.nextBillingDate)}</span>
                    <span className="block text-xs text-muted-foreground tabular-nums">{formatMoney(s.total)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Recent activity" bodyClassName="p-0">
        {activity.length === 0 ? (
          <EmptyState title="No activity yet" />
        ) : (
          <ul className="divide-y text-sm">
            {activity.map((a) => (
              <li key={String(a._id)} className="flex flex-col gap-0.5 px-5 py-3 sm:flex-row sm:items-center sm:gap-4">
                <span className="flex-1">{a.message}</span>
                <span className="text-xs text-muted-foreground">
                  {a.actorName} · {formatDateTime(a.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
