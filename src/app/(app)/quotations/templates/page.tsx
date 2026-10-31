import Link from "next/link";
import { LayoutTemplate, Pencil, Plus, Trash2 } from "lucide-react";
import { connectDB } from "@/lib/db";
import { Product, QuotationTemplate, SubscriptionPlan } from "@/models";
import { requirePage } from "@/lib/auth/guard";
import { formatDate } from "@/lib/dates";
import { deleteTemplateAction } from "@/actions/quotations";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/app/action-button";
import { EmptyState, PageHeader, tableCls } from "@/components/app/ui-bits";

export const metadata = { title: "Quotation templates" };

export default async function TemplatesPage() {
  await requirePage("quotations.manage");
  await connectDB();
  const [templates, plans, products] = await Promise.all([
    QuotationTemplate.find().sort({ name: 1 }).lean(),
    SubscriptionPlan.find().select("name").lean(),
    Product.find().select("name").lean(),
  ]);
  const planName = (id: unknown) => plans.find((p) => String(p._id) === String(id))?.name;
  const productName = (id: unknown) => products.find((p) => String(p._id) === String(id))?.name ?? "Deleted product";

  return (
    <>
      <PageHeader
        title="Quotation templates"
        description="Reusable bundles to create quotations in seconds"
        back={{ href: "/quotations", label: "Quotations" }}
        actions={
          <Button nativeButton={false} render={<Link href="/quotations/templates/new" />}>
            <Plus className="size-4" /> New template
          </Button>
        }
      />
      <div className="rounded-xl border bg-card shadow-xs">
        {templates.length === 0 ? (
          <EmptyState icon={LayoutTemplate} title="No templates yet" description="Save a common product bundle as a template." />
        ) : (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead className={tableCls.thead}>
                <tr>
                  <th className={tableCls.th}>Template</th>
                  <th className={tableCls.th}>Plan</th>
                  <th className={tableCls.th}>Products</th>
                  <th className={tableCls.th}>Validity</th>
                  <th className={tableCls.th}>Updated</th>
                  <th className={tableCls.th} />
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={String(t._id)} className={tableCls.tr}>
                    <td className={tableCls.td}>
                      <p className="font-medium">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.description}</p>
                    </td>
                    <td className={tableCls.td}>{planName(t.plan) ?? "—"}</td>
                    <td className="max-w-sm px-4 py-3 text-xs text-muted-foreground">{(t.lines as { product: unknown; quantity: number }[]).map((l) => `${l.quantity}× ${productName(l.product)}`).join(", ")}</td>
                    <td className={tableCls.td}>{t.validityDays} days</td>
                    <td className={tableCls.td}>{formatDate(t.updatedAt)}</td>
                    <td className={`${tableCls.td} text-right`}>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon-sm" aria-label="Edit template" nativeButton={false} render={<Link href={`/quotations/templates/${t._id}`} />}>
                          <Pencil className="size-4" />
                        </Button>
                        <ActionButton action={deleteTemplateAction.bind(null, String(t._id))} variant="ghost" size="icon-sm" title="Delete template" confirm={{ title: `Delete "${t.name}"?`, description: "Existing quotations created from this template are not affected.", destructive: true, confirmLabel: "Delete" }}>
                          <Trash2 className="size-4 text-destructive" />
                        </ActionButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
