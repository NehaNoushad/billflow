import { notFound } from "next/navigation";
import { connectDB } from "@/lib/db";
import { QuotationTemplate } from "@/models";
import { requirePage } from "@/lib/auth/guard";
import { isObjectId } from "@/lib/utils-server";
import { getCatalog } from "@/services/catalog";
import { PageHeader } from "@/components/app/ui-bits";
import { TemplateForm } from "@/components/sales/template-form";
import { toEditorLines } from "@/components/sales/data";

export const metadata = { title: "Edit template" };

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage("quotations.manage");
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  await connectDB();
  const t = await QuotationTemplate.findById(id).lean();
  if (!t) notFound();
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={`Edit ${t.name}`} back={{ href: "/quotations/templates", label: "Templates" }} />
      <TemplateForm
        templateId={id}
        catalog={await getCatalog()}
        defaultValues={{
          name: t.name,
          description: t.description ?? "",
          plan: t.plan ? String(t.plan) : "",
          validityDays: t.validityDays ?? 30,
          notes: t.notes ?? "",
          lines: toEditorLines(t.lines as { product: unknown; variant?: unknown; quantity: number }[]),
        }}
      />
    </div>
  );
}
