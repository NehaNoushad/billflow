import { notFound, redirect } from "next/navigation";
import { connectDB } from "@/lib/db";
import { Quotation } from "@/models";
import { canAccessCustomer, requirePage } from "@/lib/auth/guard";
import { isObjectId } from "@/lib/utils-server";
import { toDateInput } from "@/lib/dates";
import { toRupeeString } from "@/lib/money";
import { getCatalog } from "@/services/catalog";
import { PageHeader } from "@/components/app/ui-bits";
import { QuotationForm } from "@/components/sales/quotation-form";
import { customerOptions, toEditorLines } from "@/components/sales/data";

export const metadata = { title: "Edit quotation" };

export default async function EditQuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("quotations.manage");
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  await connectDB();
  const q = await Quotation.findById(id).lean();
  if (!q || !(await canAccessCustomer(user, q.customer))) notFound();
  if (q.status !== "DRAFT") redirect(`/quotations/${id}`);
  const [catalog, customers] = await Promise.all([getCatalog(), customerOptions(user)]);
  const manual = (q.discounts ?? []).find((d: { type: string }) => d.type === "MANUAL") as { name: string; amount: number } | undefined;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={`Edit ${q.number}`} back={{ href: `/quotations/${id}`, label: q.number }} />
      <QuotationForm
        quotationId={id}
        catalog={catalog}
        customers={customers}
        templates={[]}
        defaultValues={{
          customer: String(q.customer),
          plan: q.plan ? String(q.plan) : "",
          template: q.template ? String(q.template) : "",
          quotationDate: toDateInput(q.quotationDate),
          validityDays: q.validityDays ?? 30,
          notes: q.notes ?? "",
          manualDiscount: manual ? { type: "FIXED", value: toRupeeString(manual.amount), name: manual.name } : { type: "PERCENTAGE", value: "", name: "" },
          lines: toEditorLines(q.lines as { product?: unknown; variant?: unknown; quantity: number; unitPrice: number }[], true),
        }}
      />
    </div>
  );
}
