import Link from "next/link";
import { Plus, Repeat } from "lucide-react";
import { connectDB } from "@/lib/db";
import { Subscription, SubscriptionPlan, SubscriptionRequest } from "@/models";
import { requirePage, scopeFilter } from "@/lib/auth/guard";
import { escapeRegex, pageParam, sp } from "@/lib/utils-server";
import { PAGE_SIZE, SUBSCRIPTION_STATUSES, humanize } from "@/lib/constants";
import { addDaysUTC, businessToday, formatDate, intervalLabel, perIntervalSuffix, type BillingInterval } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/app/filters";
import { EmptyState, PageHeader, Pagination, StatusBadge, tableCls } from "@/components/app/ui-bits";
import { RequestsPanel, type RequestRow } from "@/components/sales/requests-panel";

export const metadata = { title: "Subscriptions" };

export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("subscriptions.manage");
  const params = await searchParams;
  await connectDB();
  const page = pageParam(params);
  const q = sp(params, "q");
  const status = sp(params, "status");
  const plan = sp(params, "plan");
  const expiring = Number(sp(params, "expiring") ?? 0);
  const scope = await scopeFilter(user);
  const today = businessToday();

  const filter: Record<string, unknown> = { ...scope };
  if (status) filter.status = status;
  if (plan) filter.plan = plan;
  if (expiring > 0) {
    filter.status = { $in: ["ACTIVE", "PAUSED"] };
    filter.expiryDate = { $gte: today, $lte: addDaysUTC(today, Math.min(expiring, 365)) };
  }
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ number: rx }, { "customerSnapshot.name": rx }, { "customerSnapshot.companyName": rx }];
  }

  const [total, subs, plans, pending] = await Promise.all([
    Subscription.countDocuments(filter),
    Subscription.find(filter).sort(expiring ? { expiryDate: 1 } : { createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    SubscriptionPlan.find().select("name").sort({ name: 1 }).lean(),
    SubscriptionRequest.find({ ...scope, status: "PENDING" }).sort({ createdAt: 1 }).populate("subscription", "number customerSnapshot").populate("targetPlan", "name").lean(),
  ]);
  const requests: RequestRow[] = pending.map((r) => {
    const s = r.subscription as unknown as { _id: unknown; number: string; customerSnapshot?: { name?: string } } | null;
    return {
      _id: String(r._id),
      type: r.type,
      message: r.message ?? undefined,
      createdAt: r.createdAt,
      subscriptionId: String(s?._id ?? r.subscription),
      subscriptionNumber: s?.number,
      customerName: s?.customerSnapshot?.name,
      targetPlanName: (r.targetPlan as unknown as { name?: string } | null)?.name,
    };
  });

  return (
    <>
      <PageHeader
        title="Subscriptions"
        description={expiring ? `Active subscriptions expiring within ${expiring} days` : "Recurring agreements and their lifecycle"}
        actions={
          <Button nativeButton={false} render={<Link href="/subscriptions/new" />}>
            <Plus className="size-4" /> New subscription
          </Button>
        }
      />
      {requests.length > 0 && (
        <div className="mb-6">
          <RequestsPanel requests={requests} />
        </div>
      )}
      <div className="rounded-xl border bg-card shadow-xs">
        <FilterBar
          searchPlaceholder="Search number or customer…"
          filters={[
            { name: "status", label: "Statuses", options: SUBSCRIPTION_STATUSES.map((s) => ({ value: s, label: humanize(s) })) },
            { name: "plan", label: "Plans", options: plans.map((p) => ({ value: String(p._id), label: p.name })) },
            { name: "expiring", label: "Expiry windows", options: [{ value: "7", label: "Expiring in 7 days" }, { value: "30", label: "Expiring in 30 days" }] },
          ]}
        />
        {subs.length === 0 ? (
          <EmptyState icon={Repeat} title="No subscriptions found" description={q || status || plan || expiring ? "Try a different filter." : "Create a subscription or convert an accepted quotation."} />
        ) : (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead className={tableCls.thead}>
                <tr>
                  <th className={tableCls.th}>Number</th>
                  <th className={tableCls.th}>Customer</th>
                  <th className={tableCls.th}>Plan</th>
                  <th className={tableCls.th}>Start</th>
                  <th className={tableCls.th}>Next billing</th>
                  <th className={tableCls.th}>Expiry</th>
                  <th className={`${tableCls.th} text-right`}>Amount</th>
                  <th className={tableCls.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {subs.map((s) => {
                  const soon = s.expiryDate && ["ACTIVE", "PAUSED"].includes(s.status) && new Date(s.expiryDate) <= addDaysUTC(today, 7);
                  return (
                    <tr key={String(s._id)} className={tableCls.tr}>
                      <td className={tableCls.td}>
                        <Link href={`/subscriptions/${s._id}`} className="font-medium text-primary hover:underline">
                          {s.number}
                        </Link>
                      </td>
                      <td className={tableCls.td}>
                        {s.customerSnapshot?.name}
                        <div className="text-xs text-muted-foreground">{s.customerSnapshot?.companyName}</div>
                      </td>
                      <td className={tableCls.td}>
                        {s.planSnapshot?.name}
                        <div className="text-xs text-muted-foreground">{intervalLabel(s.billingInterval as BillingInterval)}</div>
                      </td>
                      <td className={tableCls.td}>{formatDate(s.startDate)}</td>
                      <td className={tableCls.td}>{["ACTIVE", "CONFIRMED"].includes(s.status) ? formatDate(s.nextBillingDate) : "—"}</td>
                      <td className={`${tableCls.td} ${soon ? "font-medium text-amber-700" : ""}`}>{formatDate(s.expiryDate)}</td>
                      <td className={tableCls.num}>
                        {formatMoney(s.total)}
                        <span className="text-xs text-muted-foreground">{perIntervalSuffix(s.billingInterval as BillingInterval)}</span>
                      </td>
                      <td className={tableCls.td}>
                        <StatusBadge status={s.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} basePath="/subscriptions" params={params} />
      </div>
    </>
  );
}
