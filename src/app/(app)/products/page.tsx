import Link from "next/link";
import { Package, Plus } from "lucide-react";
import { connectDB } from "@/lib/db";
import { requirePage } from "@/lib/auth/guard";
import { can } from "@/lib/auth/permissions";
import { PAGE_SIZE, PRODUCT_TYPES, humanize } from "@/lib/constants";
import { formatMoney } from "@/lib/money";
import { escapeRegex, pageParam, sp } from "@/lib/utils-server";
import { Product, ProductVariant, Tax } from "@/models";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/app/filters";
import { EmptyState, PageHeader, Pagination, Panel, StatusBadge, tableCls } from "@/components/app/ui-bits";

export const metadata = { title: "Products" };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("catalog.view");
  const params = await searchParams;
  await connectDB();
  const page = pageParam(params);
  const q = sp(params, "q");
  const type = sp(params, "type");
  const status = sp(params, "status");

  const filter: Record<string, unknown> = {};
  if (q) filter.name = { $regex: escapeRegex(q), $options: "i" };
  if (type && (PRODUCT_TYPES as readonly string[]).includes(type)) filter.type = type;
  if (status === "ACTIVE" || status === "ARCHIVED") filter.status = status;

  const [products, total] = await Promise.all([
    Product.find(filter).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    Product.countDocuments(filter),
  ]);
  const ids = products.map((p) => p._id);
  const [variantCounts, taxes] = await Promise.all([
    ProductVariant.aggregate<{ _id: unknown; n: number }>([{ $match: { product: { $in: ids }, active: true } }, { $group: { _id: "$product", n: { $sum: 1 } } }]),
    Tax.find({ _id: { $in: products.flatMap((p) => p.taxes ?? []) } }).lean(),
  ]);
  const manage = can(user.role, "catalog.manage");

  return (
    <>
      <PageHeader
        title="Products"
        description="Products and variants you sell. Prices are snapshotted onto subscriptions and invoices."
        actions={
          manage && (
            <Button nativeButton={false} render={<Link href="/products/new" />}>
              <Plus className="size-4" /> New product
            </Button>
          )
        }
      />
      <Panel bodyClassName="p-0">
        <FilterBar
          searchPlaceholder="Search products…"
          filters={[
            { name: "type", label: "Types", options: PRODUCT_TYPES.map((t) => ({ value: t, label: humanize(t) })) },
            { name: "status", label: "Statuses", options: [{ value: "ACTIVE", label: "Active" }, { value: "ARCHIVED", label: "Archived" }] },
          ]}
        />
        {products.length === 0 ? (
          <EmptyState
            icon={Package}
            title={q || type || status ? "No products match your filters" : "No products yet"}
            description="Products are the building blocks of plans, quotations and subscriptions."
            action={manage && !q && <Button nativeButton={false} render={<Link href="/products/new" />}>Create your first product</Button>}
          />
        ) : (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead className={tableCls.thead}>
                <tr>
                  <th className={tableCls.th}>Product</th>
                  <th className={tableCls.th}>Type</th>
                  <th className={`${tableCls.th} text-right`}>Sales price</th>
                  <th className={`${tableCls.th} text-right`}>Cost</th>
                  <th className={tableCls.th}>Variants</th>
                  <th className={tableCls.th}>Taxes</th>
                  <th className={tableCls.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const vc = variantCounts.find((v) => String(v._id) === String(p._id))?.n ?? 0;
                  const t = (p.taxes ?? []).map((id: unknown) => taxes.find((x) => String(x._id) === String(id))?.name).filter(Boolean);
                  return (
                    <tr key={String(p._id)} className={tableCls.tr}>
                      <td className={tableCls.td}>
                        <Link href={`/products/${p._id}`} className="font-medium text-foreground hover:text-primary">
                          {p.name}
                        </Link>
                        {p.description && <p className="max-w-xs truncate text-xs text-muted-foreground">{p.description}</p>}
                      </td>
                      <td className={tableCls.td}>{humanize(p.type)}</td>
                      <td className={tableCls.num}>{formatMoney(p.salesPrice)}</td>
                      <td className={`${tableCls.num} text-muted-foreground`}>{formatMoney(p.costPrice ?? 0)}</td>
                      <td className={tableCls.td}>{vc || "—"}</td>
                      <td className={`${tableCls.td} text-xs text-muted-foreground`}>{t.length ? t.join(", ") : "None"}</td>
                      <td className={tableCls.td}>
                        <StatusBadge status={p.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} basePath="/products" params={params} />
      </Panel>
    </>
  );
}
