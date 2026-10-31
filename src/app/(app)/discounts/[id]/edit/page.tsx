import { notFound } from "next/navigation";
import { connectDB } from "@/lib/db";
import { requirePage } from "@/lib/auth/guard";
import { toDateInput } from "@/lib/dates";
import { toRupeeString } from "@/lib/money";
import { isObjectId } from "@/lib/utils-server";
import { Discount } from "@/models";
import { PageHeader } from "@/components/app/ui-bits";
import { DiscountForm } from "@/components/catalog/discount-form";
import { discountFormOptions } from "../../_lib/data";

export const metadata = { title: "Edit discount" };

export default async function EditDiscountPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage("catalog.manage");
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  await connectDB();
  const d = await Discount.findById(id).lean();
  if (!d) notFound();
  const { products, subscriptions } = await discountFormOptions();
  return (
    <>
      <PageHeader title={`Edit ${d.name}`} back={{ href: "/discounts", label: "Discounts" }} />
      <DiscountForm
        id={id}
        usageCount={d.usageCount ?? 0}
        products={products}
        subscriptions={subscriptions}
        defaults={{
          name: d.name,
          code: d.code ?? "",
          type: d.type as "PERCENTAGE" | "FIXED",
          // value is bps for percentages and paise for fixed; both render as 2-decimal strings.
          value: toRupeeString(d.value),
          minPurchase: toRupeeString(d.minPurchase ?? 0),
          minQuantity: d.minQuantity ?? 0,
          applicableProducts: (d.applicableProducts ?? []).map(String),
          applicableSubscriptions: (d.applicableSubscriptions ?? []).map(String),
          startDate: toDateInput(d.startDate),
          endDate: toDateInput(d.endDate),
          usageLimit: d.usageLimit ? String(d.usageLimit) : "",
          autoApply: d.autoApply ?? true,
          active: d.active ?? true,
        }}
      />
    </>
  );
}
