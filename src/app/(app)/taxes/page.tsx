import { Info, Percent } from "lucide-react";
import { connectDB } from "@/lib/db";
import { requirePage } from "@/lib/auth/guard";
import { can } from "@/lib/auth/permissions";
import { TAX_TYPES } from "@/lib/constants";
import { formatBps } from "@/lib/money";
import { escapeRegex, sp } from "@/lib/utils-server";
import { Product, SubscriptionPlan, Tax } from "@/models";
import { ActionButton } from "@/components/app/action-button";
import { FilterBar } from "@/components/app/filters";
import { EmptyState, PageHeader, Panel, StatusBadge, tableCls } from "@/components/app/ui-bits";
import { TaxDialog } from "@/components/catalog/tax-dialog";
import { deleteTax, setTaxActive } from "@/actions/taxes";
import { toRupeeString } from "@/lib/money";

export const metadata = { title: "Taxes" };

export default async function TaxesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("catalog.view");
  const params = await searchParams;
  await connectDB();
  const q = sp(params, "q");
  const type = sp(params, "type");
  const status = sp(params, "status");
  const filter: Record<string, unknown> = {};
  if (q) filter.name = { $regex: escapeRegex(q), $options: "i" };
  if (type && (TAX_TYPES as readonly string[]).includes(type)) filter.type = type;
  if (status === "active") filter.active = true;
  if (status === "archived") filter.active = false;

  const taxes = await Tax.find(filter).sort({ active: -1, name: 1 }).lean();
  const ids = taxes.map((t) => t._id);
  const [productUse, planUse] = await Promise.all([
    Product.aggregate<{ _id: unknown; n: number }>([{ $match: { taxes: { $in: ids } } }, { $unwind: "$taxes" }, { $match: { taxes: { $in: ids } } }, { $group: { _id: "$taxes", n: { $sum: 1 } } }]),
    SubscriptionPlan.aggregate<{ _id: unknown; n: number }>([{ $match: { taxes: { $in: ids } } }, { $unwind: "$taxes" }, { $match: { taxes: { $in: ids } } }, { $group: { _id: "$taxes", n: { $sum: 1 } } }]),
  ]);
  const manage = can(user.role, "catalog.manage");

  return (
    <>
      <PageHeader title="Taxes" description="Tax rules assigned to products and plan fees." actions={manage && <TaxDialog />} />
      <div className="mb-4 flex gap-3 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 text-sm text-indigo-900">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>
          Indian GST examples are provided as configurable rules: use <strong>CGST + SGST</strong> for intra-state supply and <strong>IGST</strong> for inter-state supply. BILLFLOW never applies a tax automatically — only the taxes you assign to a product or plan are charged.
        </p>
      </div>
      <Panel bodyClassName="p-0">
        <FilterBar
          searchPlaceholder="Search taxes…"
          filters={[
            { name: "type", label: "Types", options: TAX_TYPES.map((t) => ({ value: t, label: t })) },
            { name: "status", label: "Statuses", options: [{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }] },
          ]}
        />
        {taxes.length === 0 ? (
          <EmptyState icon={Percent} title="No taxes found" description="Create taxes such as CGST, SGST or IGST and assign them to products." />
        ) : (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead className={tableCls.thead}>
                <tr>
                  <th className={tableCls.th}>Name</th>
                  <th className={tableCls.th}>Type</th>
                  <th className={`${tableCls.th} text-right`}>Rate</th>
                  <th className={tableCls.th}>Description</th>
                  <th className={`${tableCls.th} text-right`}>Used by</th>
                  <th className={tableCls.th}>Status</th>
                  {manage && <th className={tableCls.th} />}
                </tr>
              </thead>
              <tbody>
                {taxes.map((t) => {
                  const id = String(t._id);
                  const products = productUse.find((u) => String(u._id) === id)?.n ?? 0;
                  const plans = planUse.find((u) => String(u._id) === id)?.n ?? 0;
                  return (
                    <tr key={id} className={tableCls.tr}>
                      <td className={`${tableCls.td} font-medium`}>{t.name}</td>
                      <td className={tableCls.td}>{t.type}</td>
                      <td className={tableCls.num}>{formatBps(t.rateBps)}</td>
                      <td className={`${tableCls.td} max-w-xs truncate text-muted-foreground`}>{t.description || "—"}</td>
                      <td className={`${tableCls.num} text-xs text-muted-foreground`}>
                        {products} product(s) · {plans} plan(s)
                      </td>
                      <td className={tableCls.td}>
                        <StatusBadge status={t.active ? "ACTIVE" : "ARCHIVED"} />
                      </td>
                      {manage && (
                        <td className={`${tableCls.td} text-right`}>
                          <div className="flex justify-end gap-1">
                            <TaxDialog id={id} defaults={{ name: t.name, rate: toRupeeString(t.rateBps), type: t.type as (typeof TAX_TYPES)[number], description: t.description ?? "", active: t.active ?? true }} />
                            <ActionButton action={setTaxActive.bind(null, id, !t.active)} variant="ghost" size="xs">
                              {t.active ? "Archive" : "Restore"}
                            </ActionButton>
                            <ActionButton
                              action={deleteTax.bind(null, id)}
                              variant="ghost"
                              size="xs"
                              disabled={products + plans > 0}
                              title={products + plans > 0 ? "Assigned to products or plans — archive instead" : undefined}
                              confirm={{ title: `Delete ${t.name}?`, description: "This permanently deletes an unused tax.", confirmLabel: "Delete", destructive: true }}
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
