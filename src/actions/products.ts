"use server";

import { revalidatePath } from "next/cache";
import { connectDB } from "@/lib/db";
import { requireAction } from "@/lib/auth/guard";
import { BusinessError, isObjectId, logActivity, runAction } from "@/lib/utils-server";
import { InvoiceLine, Product, ProductVariant, Quotation, QuotationTemplate, Subscription } from "@/models";
import { productUsage } from "@/app/(app)/products/_lib/usage";
import { productSchema } from "@/validators/catalog";

async function variantInUse(variantId: string) {
  const [s, q, t, i] = await Promise.all([
    Subscription.exists({ "lines.variant": variantId }),
    Quotation.exists({ "lines.variant": variantId }),
    QuotationTemplate.exists({ "lines.variant": variantId }),
    InvoiceLine.exists({ variant: variantId }),
  ]);
  return !!(s || q || t || i);
}

export async function saveProduct(id: string | null, input: unknown) {
  return runAction(async () => {
    const user = await requireAction("catalog.manage");
    const data = productSchema.parse(input);
    await connectDB();

    const fields = {
      name: data.name,
      type: data.type,
      description: data.description || undefined,
      salesPrice: data.salesPrice,
      costPrice: data.costPrice,
      imageUrl: data.imageUrl || undefined,
      taxes: data.taxes,
      status: data.status,
    };
    let product;
    if (id) {
      if (!isObjectId(id)) throw new BusinessError("Invalid product.");
      product = await Product.findByIdAndUpdate(id, { $set: fields }, { returnDocument: "after", runValidators: true });
      if (!product) throw new BusinessError("Product not found.");
    } else {
      product = await Product.create(fields);
    }

    // Upsert variants. Removed variants are deleted only if never used; otherwise deactivated.
    const existing = await ProductVariant.find({ product: product._id }).lean();
    const keptIds = new Set<string>();
    for (const v of data.variants) {
      const match = v._id ? existing.find((e) => String(e._id) === v._id) : existing.find((e) => e.name.toLowerCase() === v.name.toLowerCase());
      if (match) {
        keptIds.add(String(match._id));
        await ProductVariant.updateOne({ _id: match._id }, { $set: { name: v.name, extraPrice: v.extraPrice, active: true } });
      } else {
        const created = await ProductVariant.create({ product: product._id, name: v.name, extraPrice: v.extraPrice });
        keptIds.add(String(created._id));
      }
    }
    let deactivated = 0;
    for (const e of existing) {
      if (keptIds.has(String(e._id))) continue;
      if (await variantInUse(String(e._id))) {
        if (e.active) {
          await ProductVariant.updateOne({ _id: e._id }, { $set: { active: false } });
          deactivated++;
        }
      } else {
        await ProductVariant.deleteOne({ _id: e._id });
      }
    }

    await logActivity({
      actor: user,
      action: id ? "product.updated" : "product.created",
      entityType: "Product",
      entityId: product._id,
      entityLabel: product.name,
      message: `Product ${product.name} ${id ? "updated" : "created"}${deactivated ? ` (${deactivated} used variant(s) deactivated)` : ""}`,
    });
    revalidatePath("/products");
    return { id: String(product._id) };
  }, id ? "Product updated" : "Product created");
}

export async function setProductStatus(id: string, status: "ACTIVE" | "ARCHIVED") {
  return runAction(async () => {
    const user = await requireAction("catalog.manage");
    if (!isObjectId(id)) throw new BusinessError("Invalid product.");
    await connectDB();
    const product = await Product.findByIdAndUpdate(id, { $set: { status } }, { returnDocument: "after" }).lean();
    if (!product) throw new BusinessError("Product not found.");
    await logActivity({ actor: user, action: status === "ARCHIVED" ? "product.archived" : "product.restored", entityType: "Product", entityId: product._id, entityLabel: product.name, message: `Product ${product.name} ${status === "ARCHIVED" ? "archived" : "restored"}` });
    revalidatePath("/products");
    revalidatePath(`/products/${id}`);
  }, status === "ARCHIVED" ? "Product archived" : "Product restored");
}

export async function deleteProduct(id: string) {
  return runAction(async () => {
    const user = await requireAction("catalog.manage");
    if (!isObjectId(id)) throw new BusinessError("Invalid product.");
    await connectDB();
    const product = await Product.findById(id).lean();
    if (!product) throw new BusinessError("Product not found.");
    const usage = await productUsage(id);
    if (usage.total > 0) {
      const parts = [
        usage.plans && `${usage.plans} plan(s)`,
        usage.subscriptions && `${usage.subscriptions} subscription(s)`,
        usage.quotations && `${usage.quotations} quotation(s)`,
        usage.templates && `${usage.templates} template(s)`,
        usage.invoiceLines && `${usage.invoiceLines} invoice line(s)`,
      ].filter(Boolean);
      throw new BusinessError(`${product.name} is used by ${parts.join(", ")} and cannot be deleted. Archive it instead to stop selling it.`);
    }
    await ProductVariant.deleteMany({ product: id });
    await Product.deleteOne({ _id: id });
    await logActivity({ actor: user, action: "product.deleted", entityType: "Product", entityId: product._id, entityLabel: product.name, message: `Product ${product.name} deleted` });
    revalidatePath("/products");
  }, "Product deleted");
}
