import { notFound } from "next/navigation";
import { connectDB } from "@/lib/db";
import { requirePage } from "@/lib/auth/guard";
import { toRupeeString } from "@/lib/money";
import { isObjectId, serialize } from "@/lib/utils-server";
import { Product, ProductVariant, Tax } from "@/models";
import { PageHeader } from "@/components/app/ui-bits";
import { ProductForm } from "@/components/catalog/product-form";
import type { ProductFormValues } from "@/validators/catalog";

export const metadata = { title: "Edit product" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage("catalog.manage");
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  await connectDB();
  const product = await Product.findById(id).lean();
  if (!product) notFound();
  const [variants, taxes] = await Promise.all([
    ProductVariant.find({ product: id, active: true }).sort({ extraPrice: 1 }).lean(),
    // Keep currently assigned (possibly archived) taxes selectable so saving doesn't silently drop them.
    Tax.find({ $or: [{ active: true }, { _id: { $in: product.taxes ?? [] } }] }).sort({ name: 1 }).select("name rateBps type").lean(),
  ]);
  const defaults: ProductFormValues = {
    name: product.name,
    type: product.type as ProductFormValues["type"],
    description: product.description ?? "",
    salesPrice: toRupeeString(product.salesPrice),
    costPrice: toRupeeString(product.costPrice ?? 0),
    imageUrl: product.imageUrl ?? "",
    taxes: (product.taxes ?? []).map(String),
    status: product.status as "ACTIVE" | "ARCHIVED",
    variants: variants.map((v) => ({ _id: String(v._id), name: v.name, extraPrice: toRupeeString(v.extraPrice ?? 0) })),
  };
  return (
    <>
      <PageHeader title={`Edit ${product.name}`} back={{ href: `/products/${id}`, label: product.name }} />
      <ProductForm id={id} defaults={defaults} taxes={serialize(taxes).map((t) => ({ ...t, _id: String(t._id) }))} />
    </>
  );
}
