import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArchiveRestore, Pencil, Trash2 } from "lucide-react";
import { connectDB } from "@/lib/db";
import { requirePage } from "@/lib/auth/guard";
import { can } from "@/lib/auth/permissions";
import { humanize } from "@/lib/constants";
import { formatDate } from "@/lib/dates";
import { formatBps, formatMoney } from "@/lib/money";
import { isObjectId } from "@/lib/utils-server";
import { Product, ProductVariant, SubscriptionPlan, Tax } from "@/models";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/app/action-button";
import { DetailList, PageHeader, Panel, StatusBadge, tableCls } from "@/components/app/ui-bits";
import { deleteProduct, setProductStatus } from "@/actions/products";
import { productUsage } from "../_lib/usage";

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("catalog.view");
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  await connectDB();
  const product = await Product.findById(id).lean();
  if (!product) notFound();
  const [variants, taxes, usage, plans] = await Promise.all([
    ProductVariant.find({ product: id }).sort({ active: -1, extraPrice: 1 }).lean(),
    Tax.find({ _id: { $in: product.taxes ?? [] } }).lean(),
    productUsage(id),
    SubscriptionPlan.find({ products: id }).select("name status").lean(),
  ]);
  const manage = can(user.role, "catalog.manage");
  const taxRate = taxes.filter((t) => t.active).reduce((s, t) => s + t.rateBps, 0);
  const archived = product.status === "ARCHIVED";

  return (
    <>
      <PageHeader
        title={product.name}
        description={humanize(product.type)}
        back={{ href: "/products", label: "Products" }}
        actions={
          manage && (
            <>
              <Button nativeButton={false} variant="outline" size="sm" render={<Link href={`/products/${id}/edit`} />}>
                <Pencil className="size-4" /> Edit
              </Button>
              <ActionButton
                action={setProductStatus.bind(null, id, archived ? "ACTIVE" : "ARCHIVED")}
                confirm={archived ? undefined : { title: "Archive product?", description: "Archived products can no longer be added to new quotations or subscriptions. Existing subscriptions keep billing at their agreed prices.", confirmLabel: "Archive" }}
              >
                {archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />} {archived ? "Restore" : "Archive"}
              </ActionButton>
              <ActionButton
                action={deleteProduct.bind(null, id)}
                variant="destructive"
                redirectTo="/products"
                confirm={{ title: "Delete product?", description: usage.total > 0 ? `This product is referenced ${usage.total} time(s) and cannot be deleted — archive it instead.` : "This permanently deletes the product and its variants.", confirmLabel: "Delete", destructive: true }}
              >
                <Trash2 className="size-4" /> Delete
              </ActionButton>
            </>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Panel title="Details">
            <div className="flex gap-5">
              {product.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={product.imageUrl} alt="" className="size-24 shrink-0 rounded-lg border object-cover" />
              )}
              <div className="flex-1">
                <DetailList
                  items={[
                    { label: "Status", value: <StatusBadge status={product.status} /> },
                    { label: "Type", value: humanize(product.type) },
                    { label: "Sales price", value: formatMoney(product.salesPrice) },
                    { label: "Cost price", value: formatMoney(product.costPrice ?? 0) },
                    { label: "Margin", value: product.salesPrice > 0 ? `${Math.round(((product.salesPrice - (product.costPrice ?? 0)) / product.salesPrice) * 100)}%` : "—" },
                    { label: "Taxes", value: taxes.length ? `${taxes.map((t) => t.name).join(" + ")} (${formatBps(taxRate)})` : "None" },
                    { label: "Created", value: formatDate(product.createdAt) },
                    { label: "Last updated", value: formatDate(product.updatedAt) },
                  ]}
                />
                {product.description && <p className="mt-4 text-sm text-muted-foreground">{product.description}</p>}
              </div>
            </div>
          </Panel>
          <Panel title="Variant pricing" bodyClassName="p-0">
            <div className={tableCls.wrap}>
              <table className={tableCls.table}>
                <thead className={tableCls.thead}>
                  <tr>
                    <th className={tableCls.th}>Variant</th>
                    <th className={`${tableCls.th} text-right`}>Extra</th>
                    <th className={`${tableCls.th} text-right`}>Final price</th>
                    <th className={`${tableCls.th} text-right`}>Incl. tax</th>
                    <th className={tableCls.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className={tableCls.tr}>
                    <td className={tableCls.td}>Base</td>
                    <td className={tableCls.num}>—</td>
                    <td className={tableCls.num}>{formatMoney(product.salesPrice)}</td>
                    <td className={tableCls.num}>{formatMoney(product.salesPrice + Math.round((product.salesPrice * taxRate) / 10000))}</td>
                    <td className={tableCls.td} />
                  </tr>
                  {variants.map((v) => {
                    const price = product.salesPrice + (v.extraPrice ?? 0);
                    return (
                      <tr key={String(v._id)} className={tableCls.tr}>
                        <td className={tableCls.td}>{v.name}</td>
                        <td className={tableCls.num}>+{formatMoney(v.extraPrice ?? 0)}</td>
                        <td className={`${tableCls.num} font-medium`}>{formatMoney(price)}</td>
                        <td className={tableCls.num}>{formatMoney(price + Math.round((price * taxRate) / 10000))}</td>
                        <td className={tableCls.td}>
                          <StatusBadge status={v.active ? "ACTIVE" : "INACTIVE"} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="Where used">
            <dl className="space-y-2 text-sm">
              {[
                ["Plans", usage.plans],
                ["Subscriptions", usage.subscriptions],
                ["Quotations", usage.quotations],
                ["Quotation templates", usage.templates],
                ["Invoice lines", usage.invoiceLines],
              ].map(([label, n]) => (
                <div key={label as string} className="flex justify-between">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-medium tabular-nums">{n}</dd>
                </div>
              ))}
            </dl>
            {plans.length > 0 && (
              <ul className="mt-4 space-y-1 border-t pt-3 text-sm">
                {plans.map((p) => (
                  <li key={String(p._id)} className="flex items-center justify-between">
                    <Link href={`/plans/${p._id}`} className="hover:text-primary">
                      {p.name}
                    </Link>
                    <StatusBadge status={p.status} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 text-sm text-indigo-900">
            <p className="font-medium">Price changes are safe</p>
            <p className="mt-1 text-indigo-900/80">Subscriptions, quotations and invoices store a snapshot of the price at the time they were created. Editing this product only affects new documents.</p>
          </div>
        </div>
      </div>
    </>
  );
}
