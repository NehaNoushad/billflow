import { connectDB } from "@/lib/db";
import { Invoice } from "@/models";
import { requirePage, scopeFilter } from "@/lib/auth/guard";
import { getSettings, sp } from "@/lib/utils-server";
import { businessToday, toDateInput } from "@/lib/dates";
import { PageHeader, Panel } from "@/components/app/ui-bits";
import { NewPaymentForm } from "@/components/billing/misc";

export const metadata = { title: "Record payment" };

export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("payments.record");
  const params = await searchParams;
  await connectDB();
  const [open, settings] = await Promise.all([
    Invoice.find({ ...(await scopeFilter(user)), status: "CONFIRMED", amountDue: { $gt: 0 } }).sort({ dueDate: 1 }).select("number customerSnapshot amountDue dueDate").limit(500).lean(),
    getSettings(),
  ]);
  return (
    <>
      <PageHeader title="Record payment" description="Record money received outside BILLFLOW (bank transfer, UPI, cash, card terminal). Invoice balances update automatically." back={{ href: "/payments", label: "Payments" }} />
      <Panel className="max-w-2xl">
        <NewPaymentForm
          invoices={open.map((i) => ({ _id: String(i._id), number: i.number, customerName: i.customerSnapshot?.companyName || i.customerSnapshot?.name || "", amountDue: i.amountDue, dueDate: new Date(i.dueDate).toISOString() }))}
          initialInvoice={sp(params, "invoice")}
          allowPartial={settings.allowPartialPayments ?? true}
          today={toDateInput(businessToday())}
        />
      </Panel>
    </>
  );
}
