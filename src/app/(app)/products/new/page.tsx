import { connectDB } from "@/lib/db";
import { requirePage } from "@/lib/auth/guard";
import { serialize } from "@/lib/utils-server";
import { Tax } from "@/models";
import { PageHeader } from "@/components/app/ui-bits";
import { ProductForm } from "@/components/catalog/product-form";

export const metadata = { title: "New product" };

export default async function NewProductPage() {
  await requirePage("catalog.manage");
  await connectDB();
  const taxes = await Tax.find({ active: true }).sort({ name: 1 }).select("name rateBps type").lean();
  return (
    <>
      <PageHeader title="New product" back={{ href: "/products", label: "Products" }} />
      <ProductForm taxes={serialize(taxes).map((t) => ({ ...t, _id: String(t._id) }))} />
    </>
  );
}
