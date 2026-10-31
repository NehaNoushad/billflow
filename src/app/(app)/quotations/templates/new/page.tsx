import { connectDB } from "@/lib/db";
import { requirePage } from "@/lib/auth/guard";
import { getCatalog } from "@/services/catalog";
import { PageHeader } from "@/components/app/ui-bits";
import { TemplateForm } from "@/components/sales/template-form";

export const metadata = { title: "New template" };

export default async function NewTemplatePage() {
  await requirePage("quotations.manage");
  await connectDB();
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="New quotation template" back={{ href: "/quotations/templates", label: "Templates" }} />
      <TemplateForm catalog={await getCatalog()} defaultValues={{ lines: [] }} />
    </div>
  );
}
