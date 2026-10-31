import Link from "next/link";
import { CalendarClock, PlayCircle } from "lucide-react";
import { connectDB } from "@/lib/db";
import { BillingExecution, Subscription } from "@/models";
import { requirePage } from "@/lib/auth/guard";
import { businessToday, formatDate, formatDateTime, intervalLabel, toDateInput, type BillingInterval } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { humanize } from "@/lib/constants";
import { EmptyState, KpiCard, PageHeader, Panel, StatusBadge, tableCls } from "@/components/app/ui-bits";
import { BillingRunForm } from "@/components/billing/misc";
import { ExecutionStats } from "@/components/billing/execution-stats";

export const metadata = { title: "Billing runs" };

export default async function BillingPage() {
  await requirePage("billing.run");
  await connectDB();
  const today = businessToday();
  const dueFilter = { status: "ACTIVE", nextBillingDate: { $ne: null, $lte: today } };
  const [dueCount, upcoming, runs, last] = await Promise.all([
    Subscription.countDocuments(dueFilter),
    Subscription.find({ status: "ACTIVE", nextBillingDate: { $ne: null } }).sort({ nextBillingDate: 1 }).limit(10).select("number customerSnapshot planSnapshot billingInterval nextBillingDate total").lean(),
    BillingExecution.find().sort({ startedAt: -1 }).limit(25).select("-entries").lean(),
    BillingExecution.findOne({ trigger: { $ne: "SEED" } }).sort({ startedAt: -1 }).lean(),
  ]);

  return (
    <>
      <PageHeader title="Billing runs" description="The recurring billing engine generates one invoice per subscription billing period. It runs daily via cron and can be triggered here." />

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Run billing now" className="lg:col-span-2">
          <BillingRunForm today={toDateInput(today)} />
          <ul className="mt-5 space-y-1.5 border-t pt-4 text-xs text-muted-foreground">
            <li>• Bills every active subscription whose next billing date is on or before the chosen date, catching up any missed periods.</li>
            <li>• Idempotent: each subscription period has a unique key, so re-running never creates duplicate invoices — already-billed periods are reported as skipped.</li>
            <li>• Paused subscriptions are not charged; subscriptions past their term with auto-close enabled are closed after their final period is billed.</li>
            <li>• Automatic schedule: daily at 06:00 IST through <code className="rounded bg-muted px-1">/api/cron/billing</code>.</li>
          </ul>
        </Panel>
        <div className="space-y-3">
          <KpiCard label="Subscriptions due now" value={String(dueCount)} hint={`Next billing date ≤ ${formatDate(today)}`} icon={CalendarClock} tone={dueCount ? "amber" : "green"} />
          {last ? (
            <KpiCard label="Last manual / scheduled run" value={`${last.generated} invoice(s)`} hint={`${formatMoney(last.totalValue)} · ${formatDateTime(last.startedAt)}`} icon={PlayCircle} tone={last.failed ? "red" : "indigo"} />
          ) : (
            <KpiCard label="Last manual / scheduled run" value="Never" hint="Run billing to generate invoices" icon={PlayCircle} tone="gray" />
          )}
        </div>
      </div>

      {last && (
        <Panel title="Latest execution summary" className="mt-6" actions={<Link href={`/billing/${last._id}`} className="text-sm text-primary hover:underline">Details →</Link>}>
          <ExecutionStats run={last} />
        </Panel>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Next billing dates" description="Active subscriptions ordered by next billing date" bodyClassName="p-0">
          {upcoming.length === 0 ? (
            <EmptyState title="No active subscriptions" />
          ) : (
            <table className={tableCls.table}>
              <thead className={tableCls.thead}>
                <tr>
                  <th className={tableCls.th}>Subscription</th>
                  <th className={tableCls.th}>Next billing</th>
                  <th className={`${tableCls.th} text-right`}>Per period</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((s) => (
                  <tr key={String(s._id)} className={tableCls.tr}>
                    <td className={tableCls.td}>
                      <Link href={`/subscriptions/${s._id}`} className="font-medium text-primary hover:underline">
                        {s.number}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {s.customerSnapshot?.companyName || s.customerSnapshot?.name} · {s.planSnapshot?.name} · {intervalLabel(s.billingInterval as BillingInterval)}
                      </div>
                    </td>
                    <td className={`${tableCls.td} ${s.nextBillingDate && new Date(s.nextBillingDate) <= today ? "font-medium text-amber-700" : ""}`}>{formatDate(s.nextBillingDate)}</td>
                    <td className={tableCls.num}>{formatMoney(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="Execution history" bodyClassName="p-0">
          {runs.length === 0 ? (
            <EmptyState title="No billing runs yet" />
          ) : (
            <div className={tableCls.wrap}>
              <table className={tableCls.table}>
                <thead className={tableCls.thead}>
                  <tr>
                    <th className={tableCls.th}>Started</th>
                    <th className={tableCls.th}>Trigger</th>
                    <th className={tableCls.th}>As of</th>
                    <th className={tableCls.th}>Status</th>
                    <th className={`${tableCls.th} text-right`}>Invoices</th>
                    <th className={`${tableCls.th} text-right`}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={String(r._id)} className={tableCls.tr}>
                      <td className={tableCls.td}>
                        <Link href={`/billing/${r._id}`} className="text-primary hover:underline">
                          {formatDateTime(r.startedAt)}
                        </Link>
                        <div className="text-xs text-muted-foreground">{r.triggeredByName}</div>
                      </td>
                      <td className={tableCls.td}>{humanize(r.trigger)}</td>
                      <td className={tableCls.td}>{formatDate(r.asOf)}</td>
                      <td className={tableCls.td}>
                        <StatusBadge status={r.status} />
                      </td>
                      <td className={tableCls.num}>
                        {r.generated}
                        {r.skipped ? <span className="text-xs text-muted-foreground"> (+{r.skipped} skipped)</span> : null}
                      </td>
                      <td className={tableCls.num}>{formatMoney(r.totalValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
