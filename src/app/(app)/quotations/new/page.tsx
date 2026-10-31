import { connectDB } from "@/lib/db";
import { QuotationTemplate } from "@/models";
import { requirePage } from "@/lib/auth/guard";
import { sp } from "@/lib/utils-server";
import { businessToday, toDateInput } from "@/lib/dates";
import { getCatalog } from "@/services/catalog";
import { PageHeader } from "@/components/app/ui-bits";
import { QuotationForm, type TemplateOption } from "@/components/sales/quotation-form";
import { customerOptions, toEditorLines } from "@/components/sales/data";

export const metadata = { title: "New quotation" };

export default async function NewQuotationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("quotations.manage");
  const params = await searchParams;
  await connectDB();
  const [catalog, customers, templates] = await Promise.all([getCatalog(), customerOptions(user), QuotationTemplate.find({ active: true }).sort({ name: 1 }).lean()]);
  const templateOptions: TemplateOption[] = templates.map((t) => ({
    _id: String(t._id),
    name: t.name,
    plan: t.plan ? String(t.plan) : undefined,
    validityDays: t.validityDays ?? 30,
    notes: t.notes ?? undefined,
    lines: toEditorLines(t.lines as { product: unknown; variant?: unknown; quantity: number }[]),
  }));
  const customer = sp(params, "customer");
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="New quotation" back={{ href: "/quotations", label: "Quotations" }} />
      <QuotationForm
        catalog={catalog}
        customers={customers}
        templates={templateOptions}
        defaultValues={{ customer: customers.some((c) => c._id === customer) ? customer : "", quotationDate: toDateInput(businessToday()), validityDays: 30, lines: [] }}
      />
    </div>
  );
}
