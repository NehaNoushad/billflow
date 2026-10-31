import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArchiveRestore, Check, Pencil, Trash2, X } from "lucide-react";
import { connectDB } from "@/lib/db";
import { requirePage } from "@/lib/auth/guard";
import { can } from "@/lib/auth/permissions";
import { computeTotals, type LineInput } from "@/lib/billing/calc";
import { formatDate, intervalLabel, perIntervalSuffix, type BillingInterval } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { isObjectId } from "@/lib/utils-server";
import { Product, Quotation, Subscription, SubscriptionPlan, Tax } from "@/models";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/app/action-button";
import { DetailList, PageHeader, Panel, StatusBadge, Tone, tableCls } from "@/components/app/ui-bits";
import { deletePlan, setPlanArchived } from "@/actions/plans";
import { availabilityState } from "../_lib/data";

function Rule({ on, label }: { on: boolean | null | undefined; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {on ? <Check className="size-4 text-emerald-600" /> : <X className="size-4 text-muted-foreground" />}
      <span className={on ? "" : "text-muted-foreground"}>{label}</span>
    </li>
  );
}

export default async function PlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("catalog.view");
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  await connectDB();
  const plan = await SubscriptionPlan.findById(id).lean();
  if (!plan) notFound();
  const [products, taxes, subsByStatus, quotes] = await Promise.all([
    Product.find({ _id: { $in: plan.products ?? [] } }).lean(),
    Tax.find({}).lean(),
    Subscription.aggregate<{ _id: string; n: number }>([{ $match: { plan: plan._id } }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    Quotation.countDocuments({ plan: plan._id }),
  ]);
  const manage = can(user.role, "catalog.manage");
  const iv = plan.billingInterval as BillingInterval;
  const a = availabilityState(plan);
  const archived = plan.status === "ARCHIVED";
  const totalSubs = subsByStatus.reduce((s, x) => s + x.n, 0);

  const taxSnap = (ids: unknown[] = []) =>
    ids
      .map((tid) => taxes.find((t) => String(t._id) === String(tid) && t.active))
      .filter((t): t is (typeof taxes)[number] => !!t)
      .map((t) => ({ tax: String(t._id), name: t.name, type: t.type, rateBps: t.rateBps }));
  const lines: LineInput[] = [];
  if (plan.basePrice > 0) lines.push({ productName: `${plan.name} — plan fee`, quantity: 1, unitPrice: plan.basePrice, taxes: taxSnap(plan.taxes) });
  for (const p of products) lines.push({ product: String(p._id), productName: p.name, quantity: plan.minQuantity ?? 1, unitPrice: p.salesPrice, taxes: taxSnap(p.taxes) });
  const preview = computeTotals(lines);

  return (
    <>
      <PageHeader
        title={plan.name}
        description={plan.description ?? undefined}
        back={{ href: "/plans", label: "Plans" }}
        actions={
          manage && (
            <>
              {!archived && (
                <Button nativeButton={false} variant="outline" size="sm" render={<Link href={`/plans/${id}/edit`} />}>
                  <Pencil className="size-4" /> Edit
                </Button>
              )}
              <ActionButton
                action={setPlanArchived.bind(null, id, !archived)}
                confirm={archived ? undefined : { title: "Archive plan?", description: "Archived plans cannot be used for new quotations or subscriptions. Existing subscriptions continue unchanged.", confirmLabel: "Archive" }}
              >
                {archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />} {archived ? "Restore" : "Archive"}
              </ActionButton>
              <ActionButton
                action={deletePlan.bind(null, id)}
                variant="destructive"
                redirectTo="/plans"
                disabled={totalSubs + quotes > 0}
                title={totalSubs + quotes > 0 ? "Used by subscriptions or quotations — archive instead" : undefined}
                confirm={{ title: "Delete plan?", description: "This permanently deletes an unused plan.", confirmLabel: "Delete", destructive: true }}
              >
                <Trash2 className="size-4" /> Delete
              </ActionButton>
            </>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Panel title="Plan configuration">
            <DetailList
              items={[
                { label: "Status", value: <StatusBadge status={plan.status} /> },
                { label: "Availability", value: <Tone tone={a.tone}>{a.label}</Tone> },
                { label: "Billing interval", value: intervalLabel(iv) },
                { label: "Plan fee", value: `${formatMoney(plan.basePrice)}${perIntervalSuffix(iv)}` },
                { label: "Minimum quantity", value: plan.minQuantity },
                { label: "Term", value: `${plan.termLength} × ${intervalLabel(iv).toLowerCase()}` },
                { label: "Available from", value: formatDate(plan.availableFrom) },
                { label: "Available until", value: plan.availableUntil ? formatDate(plan.availableUntil) : "No end date" },
              ]}
            />
          </Panel>
          <Panel title="Products" bodyClassName="p-0">
            {products.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">No products associated.</p>
            ) : (
              <table className={tableCls.table}>
                <thead className={tableCls.thead}>
                  <tr>
                    <th className={tableCls.th}>Product</th>
                    <th className={`${tableCls.th} text-right`}>List price</th>
                    <th className={tableCls.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={String(p._id)} className={tableCls.tr}>
                      <td className={tableCls.td}>
                        <Link href={`/products/${p._id}`} className="hover:text-primary">
                          {p.name}
                        </Link>
                      </td>
                      <td className={tableCls.num}>{formatMoney(p.salesPrice)}</td>
                      <td className={tableCls.td}>
                        <StatusBadge status={p.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="Pricing preview" description={`At list price × minimum quantity (${plan.minQuantity})`}>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="tabular-nums">{formatMoney(preview.subtotal)}</dd>
              </div>
              {preview.taxBreakdown.map((t) => (
                <div key={t.name} className="flex justify-between">
                  <dt className="text-muted-foreground">{t.name}</dt>
                  <dd className="tabular-nums">{formatMoney(t.amount)}</dd>
                </div>
              ))}
              <div className="flex justify-between border-t pt-2 font-semibold">
                <dt>Total {perIntervalSuffix(iv)}</dt>
                <dd className="tabular-nums">{formatMoney(preview.total)}</dd>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <dt>Full term</dt>
                <dd className="tabular-nums">{formatMoney(preview.total * (plan.termLength ?? 1))}</dd>
              </div>
            </dl>
          </Panel>
          <Panel title="Lifecycle rules">
            <ul className="space-y-2">
              <Rule on={plan.autoClose} label="Auto-close at end of term" />
              <Rule on={plan.allowEarlyClose} label="Early closure allowed" />
              <Rule on={plan.allowPause} label="Pause allowed" />
              <Rule on={plan.allowRenewal} label="Renewal allowed" />
            </ul>
          </Panel>
          <Panel title="Usage">
            <dl className="space-y-1.5 text-sm">
              {subsByStatus.map((s) => (
                <div key={s._id} className="flex justify-between">
                  <dt>
                    <StatusBadge status={s._id} />
                  </dt>
                  <dd className="tabular-nums">{s.n}</dd>
                </div>
              ))}
              <div className="flex justify-between border-t pt-2">
                <dt className="text-muted-foreground">Quotations</dt>
                <dd className="tabular-nums">{quotes}</dd>
              </div>
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}
