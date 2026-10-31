import { notFound, redirect } from "next/navigation";
import { connectDB } from "@/lib/db";
import { Subscription } from "@/models";
import { canAccessCustomer, requirePage } from "@/lib/auth/guard";
import { isObjectId } from "@/lib/utils-server";
import { toDateInput } from "@/lib/dates";
import { toRupeeString } from "@/lib/money";
import { getCatalog } from "@/services/catalog";
import { PageHeader } from "@/components/app/ui-bits";
import { SubscriptionForm } from "@/components/sales/subscription-form";
import { customerOptions, toEditorLines } from "@/components/sales/data";

export const metadata = { title: "Edit subscription" };

export default async function EditSubscriptionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("subscriptions.manage");
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  await connectDB();
  const sub = await Subscription.findById(id).lean();
  if (!sub || !(await canAccessCustomer(user, sub.customer))) notFound();
  if (!["DRAFT", "QUOTATION"].includes(sub.status)) redirect(`/subscriptions/${id}`);
  const [catalog, customers] = await Promise.all([getCatalog(), customerOptions(user)]);
  const md = sub.manualDiscount;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={`Edit ${sub.number}`} back={{ href: `/subscriptions/${id}`, label: sub.number }} />
      <SubscriptionForm
        subscriptionId={id}
        catalog={catalog}
        customers={customers.some((c) => c._id === String(sub.customer)) ? customers : [...customers, { _id: String(sub.customer), name: sub.customerSnapshot?.name ?? "Customer" }]}
        defaultValues={{
          customer: String(sub.customer),
          plan: String(sub.plan),
          startDate: toDateInput(sub.startDate),
          paymentTermsDays: sub.paymentTermsDays ?? 15,
          notes: sub.notes ?? "",
          manualDiscount: md?.amount ? { type: "FIXED", value: toRupeeString(md.amount), name: md.name } : { type: "PERCENTAGE", value: "", name: "" },
          lines: toEditorLines(sub.lines as { product?: unknown; variant?: unknown; quantity: number }[]),
        }}
      />
    </div>
  );
}
