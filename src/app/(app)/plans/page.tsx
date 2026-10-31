import Link from "next/link";
import { Layers, Plus } from "lucide-react";
import { connectDB } from "@/lib/db";
import { requirePage } from "@/lib/auth/guard";
import { can } from "@/lib/auth/permissions";
import { PAGE_SIZE } from "@/lib/constants";
import { BILLING_INTERVALS, intervalLabel, perIntervalSuffix, type BillingInterval } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { escapeRegex, pageParam, sp } from "@/lib/utils-server";
import { Subscription, SubscriptionPlan } from "@/models";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/app/filters";
import { EmptyState, PageHeader, Pagination, Panel, Tone, tableCls } from "@/components/app/ui-bits";
import { availabilityState } from "./_lib/data";

export const metadata = { title: "Plans" };

export default async function PlansPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("catalog.view");
  const params = await searchParams;
  await connectDB();
  const page = pageParam(params);
  const q = sp(params, "q");
  const status = sp(params, "status");
  const interval = sp(params, "interval");

  const filter: Record<string, unknown> = {};
  if (q) filter.name = { $regex: escapeRegex(q), $options: "i" };
  if (status && ["DRAFT", "PUBLISHED", "ARCHIVED"].includes(status)) filter.status = status;
  if (interval && (BILLING_INTERVALS as string[]).includes(interval)) filter.billingInterval = interval;

  const [plans, total] = await Promise.all([
    SubscriptionPlan.find(filter).sort({ status: 1, createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    SubscriptionPlan.countDocuments(filter),
  ]);
  const subCounts = await Subscription.aggregate<{ _id: unknown; n: number }>([
    { $match: { plan: { $in: plans.map((p) => p._id) }, status: { $in: ["ACTIVE", "PAUSED"] } } },
    { $group: { _id: "$plan", n: { $sum: 1 } } },
  ]);
  const manage = can(user.role, "catalog.manage");

  return (
    <>
      <PageHeader
        title="Subscription plans"
        description="Billing interval, pricing and lifecycle rules for what you sell."
        actions={
          manage && (
            <Button nativeButton={false} render={<Link href="/plans/new" />}>
              <Plus className="size-4" /> New plan
            </Button>
          )
        }
      />
      <Panel bodyClassName="p-0">
        <FilterBar
          searchPlaceholder="Search plans…"
          filters={[
            { name: "status", label: "Statuses", options: [{ value: "PUBLISHED", label: "Published" }, { value: "DRAFT", label: "Draft" }, { value: "ARCHIVED", label: "Archived" }] },
            { name: "interval", label: "Intervals", options: BILLING_INTERVALS.map((i) => ({ value: i, label: intervalLabel(i) })) },
          ]}
        />
        {plans.length === 0 ? (
          <EmptyState icon={Layers} title={q || status || interval ? "No plans match your filters" : "No plans yet"} description="Plans define how often customers are billed and the rules for their subscription." />
        ) : (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead className={tableCls.thead}>
                <tr>
                  <th className={tableCls.th}>Plan</th>
                  <th className={tableCls.th}>Interval</th>
                  <th className={`${tableCls.th} text-right`}>Plan fee</th>
                  <th className={tableCls.th}>Products</th>
                  <th className={tableCls.th}>Term</th>
                  <th className={tableCls.th}>Rules</th>
                  <th className={`${tableCls.th} text-right`}>Active subs</th>
                  <th className={tableCls.th}>Availability</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => {
                  const a = availabilityState(p);
                  const iv = p.billingInterval as BillingInterval;
                  const rules = [p.autoClose && "Auto-close", p.allowPause && "Pause", p.allowEarlyClose && "Early close", p.allowRenewal && "Renew"].filter(Boolean);
                  return (
                    <tr key={String(p._id)} className={tableCls.tr}>
                      <td className={tableCls.td}>
                        <Link href={`/plans/${p._id}`} className="font-medium hover:text-primary">
                          {p.name}
                        </Link>
                      </td>
                      <td className={tableCls.td}>{intervalLabel(iv)}</td>
                      <td className={tableCls.num}>
                        {formatMoney(p.basePrice)}
                        <span className="text-xs text-muted-foreground">{perIntervalSuffix(iv)}</span>
                      </td>
                      <td className={tableCls.td}>{p.products?.length ?? 0}</td>
                      <td className={tableCls.td}>
                        {p.termLength} × {intervalLabel(iv).toLowerCase()}
                      </td>
                      <td className={`${tableCls.td} text-xs text-muted-foreground`}>{rules.join(" · ") || "—"}</td>
                      <td className={tableCls.num}>{subCounts.find((s) => String(s._id) === String(p._id))?.n ?? 0}</td>
                      <td className={tableCls.td}>
                        <Tone tone={a.tone}>{a.label}</Tone>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} basePath="/plans" params={params} />
      </Panel>
    </>
  );
}
