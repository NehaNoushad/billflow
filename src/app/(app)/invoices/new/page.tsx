import { connectDB } from "@/lib/db";
import { Customer } from "@/models";
import { requirePage, scopeFilter } from "@/lib/auth/guard";
import { getSettings, serialize, sp } from "@/lib/utils-server";
import { businessToday, toDateInput } from "@/lib/dates";
import { getCatalog } from "@/services/catalog";
import { PageHeader } from "@/components/app/ui-bits";
import { InvoiceForm } from "@/components/billing/invoice-form";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("invoices.manage");
  const params = await searchParams;
  await connectDB();
  const [customers, catalog, settings] = await Promise.all([
    Customer.find({ ...(await scopeFilter(user, "_id")), status: "ACTIVE" }).sort({ name: 1 }).select("name companyName email").lean(),
    getCatalog(),
    getSettings(),
  ]);
  return (
    <>
      <PageHeader title="New manual invoice" description="For one-off charges such as onboarding or services. Recurring invoices are created by the billing engine." back={{ href: "/invoices", label: "Invoices" }} />
      <InvoiceForm
        catalog={catalog}
        customers={serialize(customers) as never}
        defaults={{
          customer: sp(params, "customer") ?? "",
          invoiceDate: toDateInput(businessToday()),
          paymentTermsDays: settings.defaultPaymentTermsDays ?? 15,
          lines: [{ product: "", quantity: 1 }],
          discountType: "PERCENTAGE",
          discountValue: "",
          notes: "",
        }}
      />
    </>
  );
}
