import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, FileText, Info, Pause, Pencil, Play, Power, RefreshCw, Rocket, ShieldAlert, Undo2 } from "lucide-react";
import { connectDB } from "@/lib/db";
import { Invoice, Quotation, Subscription, SubscriptionRequest } from "@/models";
import { canAccessCustomer, requirePage } from "@/lib/auth/guard";
import { isObjectId } from "@/lib/utils-server";
import { businessToday, daysBetween, formatDate, intervalLabel, perIntervalSuffix, utcDay, type BillingInterval } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { canTransition, monthlyValue } from "@/services/subscriptions";
import { isOverdue } from "@/services/invoices";
import { forceCloseSubscriptionAction, renewSubscriptionAction, transitionSubscriptionAction } from "@/actions/subscriptions";
import type { SubscriptionStatus } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/app/action-button";
import { DetailList, EmptyState, KpiCard, PageHeader, Panel, StatusBadge, tableCls } from "@/components/app/ui-bits";
import { HistoryTimeline } from "@/components/sales/history-timeline";
import { RequestsPanel } from "@/components/sales/requests-panel";

type Line = { product?: unknown; productName: string; variantName?: string; quantity: number; unitPrice: number; subtotal: number; discountAmount: number; taxAmount: number; total: number; taxes: { name: string }[] };

export default async function SubscriptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("subscriptions.manage");
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  await connectDB();
  const sub = await Subscription.findById(id).lean();
  if (!sub || !(await canAccessCustomer(user, sub.customer))) notFound();
  const [invoices, quotation, requests] = await Promise.all([
    Invoice.find({ subscription: sub._id }).sort({ invoiceDate: -1 }).lean(),
    sub.quotation ? Quotation.findById(sub.quotation).select("number status").lean() : null,
    SubscriptionRequest.find({ subscription: sub._id }).sort({ createdAt: -1 }).populate("targetPlan", "name").lean(),
  ]);

  const status = sub.status as SubscriptionStatus;
  const rules = sub.planSnapshot ?? {};
  const interval = sub.billingInterval as BillingInterval;
  const today = businessToday();
  const atExpiry = !!sub.expiryDate && utcDay(sub.expiryDate) <= today;
  const live = status === "ACTIVE" || status === "PAUSED";
  const closeAllowed = !live || rules.allowEarlyClose !== false || atExpiry;
  const isAdmin = user.role === "ADMIN";
  const lines = sub.lines as unknown as Line[];
  const invoiced = invoices.filter((i) => ["CONFIRMED", "PAID"].includes(i.status)).reduce((s, i) => s + i.total, 0);
  const outstanding = invoices.filter((i) => i.status === "CONFIRMED").reduce((s, i) => s + i.amountDue, 0);
  const pending = requests.filter((r) => r.status === "PENDING");
  const resolved = requests.filter((r) => r.status !== "PENDING");
  const daysLeft = sub.expiryDate ? daysBetween(today, sub.expiryDate) : null;
  const act = (to: SubscriptionStatus) => transitionSubscriptionAction.bind(null, id, to);

  return (
    <>
      <PageHeader
        title={`Subscription ${sub.number}`}
        description={`${sub.customerSnapshot?.name}${sub.customerSnapshot?.companyName ? ` · ${sub.customerSnapshot.companyName}` : ""} · ${sub.planSnapshot?.name}`}
        back={{ href: "/subscriptions", label: "Subscriptions" }}
        actions={<StatusBadge status={status} className="px-3 py-1 text-sm" />}
      />

      {pending.length > 0 && (
        <div className="mb-6">
          <RequestsPanel
            showSubscription={false}
            requests={pending.map((r) => ({
              _id: String(r._id),
              type: r.type,
              message: r.message ?? undefined,
              createdAt: r.createdAt,
              subscriptionId: id,
              targetPlanName: (r.targetPlan as unknown as { name?: string } | null)?.name,
            }))}
          />
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label={`Amount ${perIntervalSuffix(interval)}`} value={formatMoney(sub.total)} hint="Incl. tax, before auto discounts" />
        <KpiCard label="MRR contribution" value={formatMoney(live ? monthlyValue(sub) : 0)} tone="green" hint={live ? "Net of discounts, excl. tax" : "Not recurring yet"} />
        <KpiCard label="Invoiced to date" value={formatMoney(invoiced)} tone="blue" hint={`${invoices.length} invoice(s)`} />
        <KpiCard label="Outstanding" value={formatMoney(outstanding)} tone={outstanding ? "amber" : "gray"} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          <Panel title="Summary">
            <DetailList
              items={[
                {
                  label: "Customer",
                  value: (
                    <Link href={`/customers/${sub.customer}`} className="text-primary hover:underline">
                      {sub.customerSnapshot?.name}
                    </Link>
                  ),
                },
                { label: "Plan", value: `${sub.planSnapshot?.name} (${intervalLabel(interval)})` },
                { label: "Start date", value: formatDate(sub.startDate) },
                { label: "Expiry date", value: <>{formatDate(sub.expiryDate)}{live && daysLeft !== null && daysLeft >= 0 && daysLeft <= 30 && <span className="ml-2 text-xs text-amber-700">({daysLeft} days left)</span>}</> },
                { label: "Next billing date", value: ["ACTIVE", "CONFIRMED"].includes(status) ? formatDate(sub.nextBillingDate) : status === "PAUSED" ? "On hold (paused)" : "—" },
                { label: "Payment terms", value: `Net ${sub.paymentTermsDays ?? 15} days` },
                { label: "Term", value: `${rules.termLength ?? 12} billing period(s)${sub.renewalCount ? ` · renewed ${sub.renewalCount}×` : ""}` },
                { label: "Last billed", value: sub.lastBilledAt ? formatDate(sub.lastBilledAt) : "Not billed yet" },
                {
                  label: "Source quotation",
                  value: quotation ? (
                    <Link href={`/quotations/${quotation._id}`} className="text-primary hover:underline">
                      {quotation.number}
                    </Link>
                  ) : (
                    "—"
                  ),
                },
                { label: "Plan rules", value: [rules.allowPause !== false && "Pause", rules.allowRenewal !== false && "Renewal", rules.allowEarlyClose !== false && "Early close", rules.autoClose !== false && "Auto-close at expiry"].filter(Boolean).join(" · ") || "None" },
              ]}
            />
            {sub.closeReason && <p className="mt-4 rounded-lg bg-muted/50 p-3 text-sm">Closed {formatDate(sub.closedAt)}: {sub.closeReason}</p>}
            {sub.notes && <p className="mt-4 text-sm whitespace-pre-wrap text-muted-foreground">{sub.notes}</p>}
          </Panel>

          <Panel title="Product lines" description="Prices are snapshotted — later catalogue changes do not affect this subscription." bodyClassName="p-0">
            <div className={tableCls.wrap}>
              <table className={tableCls.table}>
                <thead className={tableCls.thead}>
                  <tr>
                    <th className={tableCls.th}>Item</th>
                    <th className={`${tableCls.th} text-right`}>Qty</th>
                    <th className={`${tableCls.th} text-right`}>Unit price</th>
                    <th className={`${tableCls.th} text-right`}>Discount</th>
                    <th className={`${tableCls.th} text-right`}>Tax</th>
                    <th className={`${tableCls.th} text-right`}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} className={tableCls.tr}>
                      <td className={tableCls.td}>
                        <p className="font-medium">{l.productName}</p>
                        <p className="text-xs text-muted-foreground">{[l.variantName, l.taxes?.map((t) => t.name).join(" + ")].filter(Boolean).join(" · ")}</p>
                      </td>
                      <td className={tableCls.num}>{l.quantity}</td>
                      <td className={tableCls.num}>{formatMoney(l.unitPrice)}</td>
                      <td className={tableCls.num}>{l.discountAmount ? `−${formatMoney(l.discountAmount)}` : "—"}</td>
                      <td className={tableCls.num}>{formatMoney(l.taxAmount)}</td>
                      <td className={`${tableCls.num} font-medium`}>{formatMoney(l.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t bg-muted/20 text-sm">
                  <tr>
                    <td className="px-4 py-2 text-right text-muted-foreground" colSpan={5}>Subtotal</td>
                    <td className={tableCls.num}>{formatMoney(sub.subtotal)}</td>
                  </tr>
                  {sub.discountTotal > 0 && (
                    <tr>
                      <td className="px-4 py-2 text-right text-emerald-700" colSpan={5}>{sub.manualDiscount?.name ?? "Discount"}</td>
                      <td className={`${tableCls.num} text-emerald-700`}>−{formatMoney(sub.discountTotal)}</td>
                    </tr>
                  )}
                  <tr>
                    <td className="px-4 py-2 text-right text-muted-foreground" colSpan={5}>Tax</td>
                    <td className={tableCls.num}>{formatMoney(sub.taxTotal)}</td>
                  </tr>
                  <tr className="font-semibold">
                    <td className="px-4 py-2 text-right" colSpan={5}>Total {perIntervalSuffix(interval)}</td>
                    <td className={tableCls.num}>{formatMoney(sub.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Panel>

          <Panel title="Invoices" bodyClassName="p-0">
            {invoices.length === 0 ? (
              <EmptyState icon={FileText} title="No invoices yet" description={status === "ACTIVE" ? "The billing engine generates an invoice on each billing date." : "Invoices are generated once the subscription is active."} />
            ) : (
              <div className={tableCls.wrap}>
                <table className={tableCls.table}>
                  <thead className={tableCls.thead}>
                    <tr>
                      <th className={tableCls.th}>Invoice</th>
                      <th className={tableCls.th}>Billing period</th>
                      <th className={tableCls.th}>Due</th>
                      <th className={`${tableCls.th} text-right`}>Total</th>
                      <th className={`${tableCls.th} text-right`}>Outstanding</th>
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
                          {inv.source === "MANUAL" && <span className="ml-1.5 text-xs text-muted-foreground">manual</span>}
                        </td>
                        <td className={tableCls.td}>{inv.periodStart ? `${formatDate(inv.periodStart)} – ${formatDate(inv.periodEnd)}` : "—"}</td>
                        <td className={tableCls.td}>{formatDate(inv.dueDate)}</td>
                        <td className={tableCls.num}>{formatMoney(inv.total)}</td>
                        <td className={tableCls.num}>{formatMoney(inv.amountDue)}</td>
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
        </div>

        <div className="space-y-6">
          <Panel title="Lifecycle actions">
            <div className="flex flex-col gap-2">
              {(status === "DRAFT" || status === "QUOTATION") && (
                <Button variant="outline" nativeButton={false} render={<Link href={`/subscriptions/${id}/edit`} />}>
                  <Pencil className="size-4" /> Edit
                </Button>
              )}
              {status === "DRAFT" && (
                <ActionButton action={act("QUOTATION")} size="default">
                  <FileText className="size-4" /> Send as quotation
                </ActionButton>
              )}
              {status === "QUOTATION" && (
                <ActionButton action={act("DRAFT")} size="default">
                  <Undo2 className="size-4" /> Back to draft
                </ActionButton>
              )}
              {canTransition(status, "CONFIRMED") && (
                <ActionButton action={act("CONFIRMED")} variant="default" size="default" confirm={{ title: "Confirm subscription?", description: "Pricing is locked once confirmed. You can then activate it to start billing." }}>
                  <CheckCircle2 className="size-4" /> Confirm
                </ActionButton>
              )}
              {status === "CONFIRMED" && (
                <ActionButton action={act("ACTIVE")} variant="default" size="default" confirm={{ title: "Activate subscription?", description: `Billing starts ${formatDate(sub.nextBillingDate ?? sub.startDate)}. The next billing run will generate the first invoice once that date is reached.`, confirmLabel: "Activate" }}>
                  <Rocket className="size-4" /> Activate
                </ActionButton>
              )}
              {status === "ACTIVE" && rules.allowPause !== false && (
                <ActionButton action={act("PAUSED")} size="default" confirm={{ title: "Pause subscription?", description: "No invoices are generated while paused. On resume, the next billing date and expiry shift forward by the paused time.", confirmLabel: "Pause", reasonLabel: "Reason (optional)" }}>
                  <Pause className="size-4" /> Pause
                </ActionButton>
              )}
              {status === "PAUSED" && (
                <ActionButton action={act("ACTIVE")} variant="default" size="default" confirm={{ title: "Resume subscription?", description: "Billing resumes. The next billing date shifts forward by the number of paused days, so the paused period is not charged.", confirmLabel: "Resume" }}>
                  <Play className="size-4" /> Resume
                </ActionButton>
              )}
              {live && rules.allowRenewal !== false && (
                <ActionButton action={renewSubscriptionAction.bind(null, id)} size="default" confirm={{ title: "Renew subscription?", description: `Extends the expiry date (${formatDate(sub.expiryDate)}) by another term of ${rules.termLength ?? 12} billing period(s).`, confirmLabel: "Renew" }}>
                  <RefreshCw className="size-4" /> Renew for another term
                </ActionButton>
              )}
              {status !== "CLOSED" && closeAllowed && (
                <ActionButton
                  action={act("CLOSED")}
                  size="default"
                  confirm={{
                    title: live ? "Close subscription?" : "Cancel this subscription?",
                    description: live ? "No further invoices will be generated. Existing invoices are unaffected." : "The subscription will be closed before it ever started billing.",
                    destructive: true,
                    confirmLabel: "Close",
                    reasonLabel: live ? "Reason for closing" : "Reason (optional)",
                    reasonRequired: live,
                  }}
                >
                  <Power className="size-4" /> {live ? (atExpiry ? "Close (term ended)" : "Close early") : "Cancel"}
                </ActionButton>
              )}
              {status !== "CLOSED" && !closeAllowed && (
                <div className="space-y-2 rounded-lg border border-dashed p-3">
                  <p className="text-xs text-muted-foreground">This plan does not allow early closure. It closes automatically on {formatDate(sub.expiryDate)}.</p>
                  {isAdmin && (
                    <ActionButton
                      action={forceCloseSubscriptionAction.bind(null, id)}
                      variant="destructive"
                      size="sm"
                      confirm={{ title: "Override plan rule and close?", description: "This plan forbids early closure. As an admin you can override it; the override and reason are recorded in the history.", destructive: true, confirmLabel: "Force close", reasonLabel: "Reason for override", reasonRequired: true }}
                    >
                      <ShieldAlert className="size-4" /> Admin override: close
                    </ActionButton>
                  )}
                </div>
              )}
              {status === "CLOSED" && <p className="text-sm text-muted-foreground">This subscription is closed. No further lifecycle changes are possible.</p>}
            </div>
            <div className="mt-4 flex gap-2 rounded-lg bg-indigo-50/60 p-3 text-xs text-indigo-900">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <p>Paused periods are not billed; the next billing date shifts forward on resume.</p>
            </div>
          </Panel>

          {(sub.pausePeriods?.length ?? 0) > 0 || sub.pausedAt ? (
            <Panel title="Pause periods">
              <ul className="space-y-1.5 text-sm">
                {((sub.pausePeriods ?? []) as { from?: Date | null; to?: Date | null }[]).map((p, i) => (
                  <li key={i} className="flex justify-between">
                    <span>
                      {formatDate(p.from)} → {formatDate(p.to)}
                    </span>
                    <span className="text-muted-foreground">{p.from && p.to ? daysBetween(p.from, p.to) : 0} days</span>
                  </li>
                ))}
                {sub.pausedAt && (
                  <li className="flex justify-between text-amber-700">
                    <span>{formatDate(sub.pausedAt)} → now</span>
                    <span>{daysBetween(sub.pausedAt, today)} days</span>
                  </li>
                )}
              </ul>
            </Panel>
          ) : null}

          {resolved.length > 0 && (
            <Panel title="Past customer requests">
              <ul className="space-y-2 text-sm">
                {resolved.map((r) => (
                  <li key={String(r._id)} className="flex items-start justify-between gap-2">
                    <span>
                      {r.type.replace("_", " ").toLowerCase()} {r.resolutionNote && <span className="block text-xs text-muted-foreground">{r.resolutionNote}</span>}
                    </span>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="History">
            <HistoryTimeline entries={sub.history as never} />
          </Panel>
        </div>
      </div>
    </>
  );
}
