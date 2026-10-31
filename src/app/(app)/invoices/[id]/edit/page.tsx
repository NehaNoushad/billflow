import { notFound, redirect } from "next/navigation";
import { connectDB } from "@/lib/db";
import { Customer, Invoice, InvoiceLine } from "@/models";
import { canAccessCustomer, requirePage } from "@/lib/auth/guard";
import { isObjectId, serialize } from "@/lib/utils-server";
import { toDateInput } from "@/lib/dates";
import { toRupeeString } from "@/lib/money";
import { getCatalog } from "@/services/catalog";
import { PageHeader } from "@/components/app/ui-bits";
import { InvoiceForm } from "@/components/billing/invoice-form";

export const metadata = { title: "Edit invoice" };

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("invoices.manage");
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  await connectDB();
  const invoice = await Invoice.findById(id).lean();
  if (!invoice || !(await canAccessCustomer(user, invoice.customer))) notFound();
  if (invoice.status !== "DRAFT") redirect(`/invoices/${id}`); // confirmed/paid invoices are locked
  const [lines, customer, catalog] = await Promise.all([InvoiceLine.find({ invoice: invoice._id }).sort({ position: 1 }).lean(), Customer.findById(invoice.customer).select("name companyName email").lean(), getCatalog()]);
  const manual = (invoice.discounts as { type: string; amount: number }[] | undefined)?.find((d) => d.type === "MANUAL");
  return (
    <>
      <PageHeader title={`Edit ${invoice.number}`} description="Only draft invoices can be edited." back={{ href: `/invoices/${id}`, label: invoice.number }} />
      <InvoiceForm
        invoiceId={id}
        catalog={catalog}
        customers={serialize(customer ? [customer] : []) as never}
        defaults={{
          customer: String(invoice.customer),
          invoiceDate: toDateInput(invoice.invoiceDate),
          paymentTermsDays: invoice.paymentTermsDays ?? 15,
          lines: lines.filter((l) => l.product).map((l) => ({ product: String(l.product), variant: l.variant ? String(l.variant) : undefined, quantity: l.quantity, unitPrice: toRupeeString(l.unitPrice) })),
          discountType: "FIXED",
          discountValue: manual ? toRupeeString(manual.amount) : "",
          notes: invoice.notes ?? "",
        }}
      />
    </>
  );
}
