import { requirePage } from "@/lib/auth/guard";
import { connectDB } from "@/lib/db";
import { formatDate, formatDateTime, intervalLabel, perIntervalSuffix, type BillingInterval } from "@/lib/dates";
import { humanize } from "@/lib/constants";
import { formatMoney } from "@/lib/money";
import { Subscription, SubscriptionPlan, SubscriptionRequest } from "@/models";
import { planAvailability } from "@/services/subscriptions";
import { ActionButton } from "@/components/app/action-button";
import { DetailList, EmptyState, PageHeader, Panel, StatusBadge, tableCls } from "@/components/app/ui-bits";
import { RequestButton } from "@/components/portal/portal-forms";
import { renewMySubscriptionAction, withdrawRequestAction } from "@/actions/portal";

export const metadata = { title: "My subscriptions" };

type Line = { productName: string; variantName?: string | null; quantity: number; unitPrice: number; subtotal: number };

export default async function PortalSubscriptions() {
  const user = await requirePage("portal.access");
  await connectDB();
  const customer = user.customerId;
  const [subs, requests, plans] = await Promise.all([
    Subscription.find({ customer, status: { $ne: "DRAFT" } }).sort({ status: 1, startDate: -1 }).lean(),
    SubscriptionRequest.find({ customer }).populate("subscription", "number").populate("targetPlan", "name").sort({ createdAt: -1 }).limit(20).lean(),
    SubscriptionPlan.find({ status: "PUBLISHED" }).select("name billingInterval basePrice status availableFrom availableUntil").sort({ name: 1 }).lean(),
  ]);
  const pendingFor = new Set(requests.filter((r) => r.status === "PENDING").map((r) => String((r.subscription as { _id?: unknown })?._id ?? r.subscription)));
  const sellable = plans.filter((p) => !planAvailability(p));
  const order = ["ACTIVE", "PAUSED", "CONFIRMED", "QUOTATION", "CLOSED"];
  subs.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));

  return (
    <div className="space-y-6">
      <PageHeader title="My subscriptions" description="View your plans and request changes. Requests are reviewed by our billing team." />

      {subs.length === 0 ? (
        <Panel>
          <EmptyState title="No subscriptions yet" description="Once a subscription is set up for your account it will appear here." />
        </Panel>
      ) : (
        subs.map((s) => {
          const rules = s.planSnapshot ?? {};
          const pending = pendingFor.has(String(s._id));
          const interval = s.billingInterval as BillingInterval;
          return (
            <Panel
              key={String(s._id)}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {rules.name} <span className="font-normal text-muted-foreground">· {s.number}</span> <StatusBadge status={s.status} />
                </span>
              }
              actions={
                <span className="text-right text-lg font-semibold tabular-nums">
                  {formatMoney(s.total)}
                  <span className="text-xs font-normal text-muted-foreground">{perIntervalSuffix(interval)} incl. tax</span>
                </span>
              }
            >
              <DetailList
                items={[
                  { label: "Billing interval", value: intervalLabel(interval) },
                  { label: "Next billing date", value: s.status === "ACTIVE" ? formatDate(s.nextBillingDate) : s.status === "PAUSED" ? "Paused — not billing" : "—" },
                  { label: "Started", value: formatDate(s.startDate) },
                  { label: s.status === "CLOSED" ? "Closed" : "Term ends", value: s.status === "CLOSED" ? formatDate(s.closedAt) : formatDate(s.expiryDate) },
                ]}
              />
              <div className="mt-4 overflow-x-auto rounded-lg border">
                <table className={tableCls.table}>
                  <thead className={tableCls.thead}>
                    <tr>
                      <th className={tableCls.th}>Product</th>
                      <th className={`${tableCls.th} text-right`}>Qty</th>
                      <th className={`${tableCls.th} text-right`}>Unit price</th>
                      <th className={`${tableCls.th} text-right`}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(s.lines as Line[]).map((l, i) => (
                      <tr key={i} className={tableCls.tr}>
                        <td className={tableCls.td}>
                          {l.productName}
                          {l.variantName && <span className="text-muted-foreground"> · {l.variantName}</span>}
                        </td>
                        <td className={tableCls.num}>{l.quantity}</td>
                        <td className={tableCls.num}>{formatMoney(l.unitPrice)}</td>
                        <td className={tableCls.num}>{formatMoney(l.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {(s.status === "ACTIVE" || s.status === "PAUSED") && (
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
                  {pending ? (
                    <p className="text-sm text-amber-700">A request for this subscription is awaiting review.</p>
                  ) : (
                    <>
                      {s.status === "ACTIVE" && rules.allowPause !== false && <RequestButton subscriptionId={String(s._id)} type="PAUSE" />}
                      {s.status === "PAUSED" && <RequestButton subscriptionId={String(s._id)} type="RESUME" />}
                      {s.status === "ACTIVE" && (
                        <RequestButton
                          subscriptionId={String(s._id)}
                          type="PLAN_CHANGE"
                          plans={sellable.filter((p) => String(p._id) !== String(s.plan)).map((p) => ({ value: String(p._id), label: `${p.name} (${intervalLabel(p.billingInterval as BillingInterval)})` }))}
                        />
                      )}
                      {rules.allowEarlyClose !== false && <RequestButton subscriptionId={String(s._id)} type="CANCEL" variant="ghost" />}
                    </>
                  )}
                  {s.status === "ACTIVE" && rules.allowRenewal !== false && (
                    <ActionButton
                      action={renewMySubscriptionAction.bind(null, String(s._id))}
                      variant="default"
                      className="ml-auto"
                      confirm={{ title: "Renew this subscription?", description: `Extends your term by another ${rules.termLength ?? 12} billing period(s) from ${formatDate(s.expiryDate)} at the same price.`, confirmLabel: "Renew" }}
                    >
                      Renew
                    </ActionButton>
                  )}
                  {(rules.allowPause === false || rules.allowEarlyClose === false) && (
                    <p className="w-full text-xs text-muted-foreground">
                      This plan {[rules.allowPause === false && "cannot be paused", rules.allowEarlyClose === false && "cannot be cancelled before its term ends"].filter(Boolean).join(" and ")}.
                    </p>
                  )}
                </div>
              )}
            </Panel>
          );
        })
      )}

      <Panel title="My requests" bodyClassName="p-0">
        {requests.length === 0 ? (
          <EmptyState title="No requests" description="Pause, cancellation and plan change requests will appear here." />
        ) : (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead className={tableCls.thead}>
                <tr>
                  <th className={tableCls.th}>Submitted</th>
                  <th className={tableCls.th}>Subscription</th>
                  <th className={tableCls.th}>Request</th>
                  <th className={tableCls.th}>Status</th>
                  <th className={tableCls.th}>Note</th>
                  <th className={tableCls.th} />
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={String(r._id)} className={tableCls.tr}>
                    <td className={tableCls.td}>{formatDateTime(r.createdAt)}</td>
                    <td className={tableCls.td}>{(r.subscription as { number?: string })?.number}</td>
                    <td className={tableCls.td}>
                      {humanize(r.type)}
                      {r.targetPlan ? ` → ${(r.targetPlan as { name?: string }).name}` : ""}
                    </td>
                    <td className={tableCls.td}>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-muted-foreground">{r.resolutionNote || r.message || "—"}</td>
                    <td className={`${tableCls.td} text-right`}>
                      {r.status === "PENDING" && (
                        <ActionButton action={withdrawRequestAction.bind(null, String(r._id))} size="xs" variant="ghost" confirm={{ title: "Withdraw this request?", description: "Your request will be cancelled.", confirmLabel: "Withdraw" }}>
                          Withdraw
                        </ActionButton>
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
