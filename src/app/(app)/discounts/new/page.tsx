import { connectDB } from "@/lib/db";
import { requirePage } from "@/lib/auth/guard";
import { PageHeader } from "@/components/app/ui-bits";
import { DiscountForm } from "@/components/catalog/discount-form";
import { discountFormOptions } from "../_lib/data";

export const metadata = { title: "New discount" };

export default async function NewDiscountPage() {
  await requirePage("catalog.manage");
  await connectDB();
  const { products, subscriptions } = await discountFormOptions();
  return (
    <>
      <PageHeader title="New discount" back={{ href: "/discounts", label: "Discounts" }} />
      <DiscountForm products={products} subscriptions={subscriptions} />
    </>
  );
}
