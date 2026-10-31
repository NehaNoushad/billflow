import { connectDB } from "@/lib/db";
import { requirePage } from "@/lib/auth/guard";
import { getSettings, sp } from "@/lib/utils-server";
import { businessToday, toDateInput } from "@/lib/dates";
import { getCatalog } from "@/services/catalog";
import { PageHeader } from "@/components/app/ui-bits";
import { SubscriptionForm } from "@/components/sales/subscription-form";
import { customerOptions } from "@/components/sales/data";

export const metadata = { title: "New subscription" };

export default async function NewSubscriptionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("subscriptions.manage");
  const params = await searchParams;
  await connectDB();
  const [catalog, customers, settings] = await Promise.all([getCatalog(), customerOptions(user), getSettings()]);
  const customer = sp(params, "customer");
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="New subscription" back={{ href: "/subscriptions", label: "Subscriptions" }} />
      <SubscriptionForm
        catalog={catalog}
        customers={customers}
        defaultValues={{ customer: customers.some((c) => c._id === customer) ? customer : "", startDate: toDateInput(businessToday()), paymentTermsDays: settings.defaultPaymentTermsDays ?? 15, lines: [] }}
      />
    </div>
  );
}
