import Link from "next/link";
import { Pencil, Plus, Tag } from "lucide-react";
import { connectDB } from "@/lib/db";
import { requirePage } from "@/lib/auth/guard";
import { can } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/dates";
import { formatBps, formatMoney } from "@/lib/money";
import { escapeRegex, sp } from "@/lib/utils-server";
import { humanize } from "@/lib/constants";
import { Discount } from "@/models";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/app/action-button";
import { FilterBar } from "@/components/app/filters";
import { EmptyState, PageHeader, Panel, Tone, tableCls } from "@/components/app/ui-bits";
import { deleteDiscount, setDiscountActive } from "@/actions/discounts";
import { STATE_TONE, discountState, type DiscountState } from "./_lib/data";

export const metadata = { title: "Discounts" };

const STATES: DiscountState[] = ["ACTIVE", "SCHEDULED", "EXPIRED", "EXHAUSTED", "INACTIVE"];

export default async function DiscountsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("catalog.view");
  const params = await searchParams;
  await connectDB();
  const q = sp(params, "q");
  const type = sp(params, "type");
  const state = sp(params, "state");
  const filter: Record<string, unknown> = {};
  if (q) filter.$or = [{ name: { $regex: escapeRegex(q), $options: "i" } }, { code: { $regex: escapeRegex(q), $options: "i" } }];
  if (type === "PERCENTAGE" || type === "FIXED") filter.type = type;

  // State is derived from dates and usage, so it is filtered after the (small) query.
  const all = await Discount.find(filter).sort({ createdAt: -1 }).limit(500).lean();
  const discounts = all.map((d) => ({ ...d, state: discountState(d) })).filter((d) => !state || d.state === state);
  const manage = can(user.role, "catalog.manage");

  return (
    <>
      <PageHeader
        title="Discounts"
        description="Rules applied automatically during billing when a subscription is eligible."
        actions={
          manage && (
            <Button nativeButton={false} render={<Link href="/discounts/new" />}>
              <Plus className="size-4" /> New discount
            </Button>
          )
        }
      />
      <Panel bodyClassName="p-0">
        <FilterBar
          searchPlaceholder="Search by name or code…"
          filters={[
            { name: "state", label: "States", options: STATES.map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() })) },
            { name: "type", label: "Types", options: [{ value: "PERCENTAGE", label: "Percentage" }, { value: "FIXED", label: "Fixed" }] },
          ]}
        />
        {discounts.length === 0 ? (
          <EmptyState icon={Tag} title="No discounts found" description="Create percentage or fixed discounts with eligibility rules and usage limits." />
        ) : (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead className={tableCls.thead}>
                <tr>
                  <th className={tableCls.th}>Discount</th>
                  <th className={`${tableCls.th} text-right`}>Value</th>
                  <th className={tableCls.th}>Conditions</th>
                  <th className={tableCls.th}>Valid</th>
                  <th className={`${tableCls.th} text-right`}>Usage</th>
                  <th className={tableCls.th}>State</th>
                  {manage && <th className={tableCls.th} />}
                </tr>
              </thead>
              <tbody>
                {discounts.map((d) => {
                  const id = String(d._id);
                  const conditions = [
                    d.minPurchase ? `Min ${formatMoney(d.minPurchase)}` : null,
                    d.minQuantity ? `Min qty ${d.minQuantity}` : null,
                    d.applicableProducts?.length ? `${d.applicableProducts.length} product(s)` : "All products",
                    d.applicableSubscriptions?.length ? `${d.applicableSubscriptions.length} subscription(s)` : null,
                    d.autoApply ? null : "Manual only",
                  ].filter(Boolean);
                  const nearLimit = d.usageLimit && (d.usageCount ?? 0) / d.usageLimit >= 0.8 && d.state === "ACTIVE";
                  return (
                    <tr key={id} className={tableCls.tr}>
                      <td className={tableCls.td}>
                        <p className="font-medium">{d.name}</p>
                        {d.code && <p className="font-mono text-xs text-muted-foreground">{d.code}</p>}
                      </td>
                      <td className={`${tableCls.num} font-medium`}>{d.type === "PERCENTAGE" ? formatBps(d.value) : formatMoney(d.value)}</td>
                      <td className={`${tableCls.td} text-xs text-muted-foreground`}>{conditions.join(" · ")}</td>
                      <td className={`${tableCls.td} text-xs`}>
                        {d.startDate || d.endDate ? `${d.startDate ? formatDate(d.startDate) : "Any time"} → ${d.endDate ? formatDate(d.endDate) : "No end"}` : "Always"}
                      </td>
                      <td className={`${tableCls.num} ${nearLimit ? "font-medium text-amber-700" : ""}`}>
                        {d.usageCount ?? 0} / {d.usageLimit ?? "∞"}
                      </td>
                      <td className={tableCls.td}>
                        <Tone tone={STATE_TONE[d.state as DiscountState]}>{humanize(d.state)}</Tone>
                      </td>
                      {manage && (
                        <td className={`${tableCls.td} text-right`}>
                          <div className="flex justify-end gap-1">
                            <Button nativeButton={false} variant="ghost" size="icon-sm" aria-label="Edit discount" render={<Link href={`/discounts/${id}/edit`} />}>
                              <Pencil className="size-4" />
                            </Button>
                            <ActionButton action={setDiscountActive.bind(null, id, !d.active)} variant="ghost" size="xs">
                              {d.active ? "Deactivate" : "Activate"}
                            </ActionButton>
                            <ActionButton
                              action={deleteDiscount.bind(null, id)}
                              variant="ghost"
                              size="xs"
                              disabled={(d.usageCount ?? 0) > 0}
                              title={(d.usageCount ?? 0) > 0 ? "Already used on invoices — deactivate instead" : undefined}
                              confirm={{ title: `Delete ${d.name}?`, description: "This permanently deletes an unused discount.", confirmLabel: "Delete", destructive: true }}
                            >
                              Delete
                            </ActionButton>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
