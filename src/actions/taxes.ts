"use server";

import { revalidatePath } from "next/cache";
import { connectDB } from "@/lib/db";
import { requireAction } from "@/lib/auth/guard";
import { BusinessError, isObjectId, logActivity, runAction } from "@/lib/utils-server";
import { Product, SubscriptionPlan, Tax } from "@/models";
import { taxSchema } from "@/validators/catalog";

export async function saveTax(id: string | null, input: unknown) {
  return runAction(async () => {
    const user = await requireAction("catalog.manage");
    const data = taxSchema.parse(input);
    await connectDB();
    const fields = { name: data.name, rateBps: data.rate, type: data.type, description: data.description || undefined, active: data.active };
    let tax;
    if (id) {
      if (!isObjectId(id)) throw new BusinessError("Invalid tax.");
      tax = await Tax.findByIdAndUpdate(id, { $set: fields }, { returnDocument: "after", runValidators: true }).lean();
      if (!tax) throw new BusinessError("Tax not found.");
    } else {
      tax = (await Tax.create(fields)).toObject();
    }
    await logActivity({ actor: user, action: id ? "tax.updated" : "tax.created", entityType: "Tax", entityId: tax._id, entityLabel: tax.name, message: `Tax ${tax.name} ${id ? "updated" : "created"} — applies to new quotations, subscriptions and invoices only` });
    revalidatePath("/taxes");
  }, id ? "Tax updated" : "Tax created");
}

export async function setTaxActive(id: string, active: boolean) {
  return runAction(async () => {
    const user = await requireAction("catalog.manage");
    if (!isObjectId(id)) throw new BusinessError("Invalid tax.");
    await connectDB();
    const tax = await Tax.findByIdAndUpdate(id, { $set: { active } }, { returnDocument: "after" }).lean();
    if (!tax) throw new BusinessError("Tax not found.");
    await logActivity({ actor: user, action: active ? "tax.restored" : "tax.archived", entityType: "Tax", entityId: tax._id, entityLabel: tax.name, message: `Tax ${tax.name} ${active ? "restored" : "archived"}` });
    revalidatePath("/taxes");
  }, active ? "Tax restored" : "Tax archived");
}

export async function deleteTax(id: string) {
  return runAction(async () => {
    const user = await requireAction("catalog.manage");
    if (!isObjectId(id)) throw new BusinessError("Invalid tax.");
    await connectDB();
    const tax = await Tax.findById(id).lean();
    if (!tax) throw new BusinessError("Tax not found.");
    const [products, plans] = await Promise.all([Product.countDocuments({ taxes: id }), SubscriptionPlan.countDocuments({ taxes: id })]);
    if (products + plans > 0) throw new BusinessError(`${tax.name} is assigned to ${products} product(s) and ${plans} plan(s). Archive it instead.`);
    await Tax.deleteOne({ _id: id });
    await logActivity({ actor: user, action: "tax.deleted", entityType: "Tax", entityId: tax._id, entityLabel: tax.name, message: `Tax ${tax.name} deleted` });
    revalidatePath("/taxes");
  }, "Tax deleted");
}
