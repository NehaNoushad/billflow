"use server";

import { revalidatePath } from "next/cache";
import { connectDB } from "@/lib/db";
import { requireAction } from "@/lib/auth/guard";
import { parseDateInput } from "@/lib/dates";
import { BusinessError, isObjectId, logActivity, runAction } from "@/lib/utils-server";
import { Discount } from "@/models";
import { discountSchema } from "@/validators/catalog";

export async function saveDiscount(id: string | null, input: unknown) {
  return runAction(async () => {
    const user = await requireAction("catalog.manage");
    const data = discountSchema.parse(input);
    await connectDB();
    const fields = {
      name: data.name,
      code: data.code || undefined,
      type: data.type,
      value: data.value,
      minPurchase: data.minPurchase,
      minQuantity: data.minQuantity,
      applicableProducts: data.applicableProducts,
      applicableSubscriptions: data.applicableSubscriptions,
      startDate: data.startDate ? parseDateInput(data.startDate) : null,
      endDate: data.endDate ? parseDateInput(data.endDate) : null,
      usageLimit: data.usageLimit ?? null,
      autoApply: data.autoApply,
      active: data.active,
    };
    let discount;
    if (id) {
      if (!isObjectId(id)) throw new BusinessError("Invalid discount.");
      const existing = await Discount.findById(id).lean();
      if (!existing) throw new BusinessError("Discount not found.");
      if (fields.usageLimit != null && fields.usageLimit < (existing.usageCount ?? 0)) {
        throw new BusinessError(`Usage limit cannot be lower than the current usage (${existing.usageCount}).`);
      }
      discount = await Discount.findByIdAndUpdate(id, { $set: fields }, { returnDocument: "after", runValidators: true }).lean();
    } else {
      discount = (await Discount.create(fields)).toObject();
    }
    await logActivity({ actor: user, action: id ? "discount.updated" : "discount.created", entityType: "Discount", entityId: discount!._id, entityLabel: discount!.name, message: `Discount ${discount!.name} ${id ? "updated" : "created"}` });
    revalidatePath("/discounts");
  }, id ? "Discount updated" : "Discount created");
}

export async function setDiscountActive(id: string, active: boolean) {
  return runAction(async () => {
    const user = await requireAction("catalog.manage");
    if (!isObjectId(id)) throw new BusinessError("Invalid discount.");
    await connectDB();
    const d = await Discount.findByIdAndUpdate(id, { $set: { active } }, { returnDocument: "after" }).lean();
    if (!d) throw new BusinessError("Discount not found.");
    await logActivity({ actor: user, action: active ? "discount.activated" : "discount.deactivated", entityType: "Discount", entityId: d._id, entityLabel: d.name, message: `Discount ${d.name} ${active ? "activated" : "deactivated"}` });
    revalidatePath("/discounts");
  }, active ? "Discount activated" : "Discount deactivated");
}

export async function deleteDiscount(id: string) {
  return runAction(async () => {
    const user = await requireAction("catalog.manage");
    if (!isObjectId(id)) throw new BusinessError("Invalid discount.");
    await connectDB();
    const d = await Discount.findById(id).lean();
    if (!d) throw new BusinessError("Discount not found.");
    if ((d.usageCount ?? 0) > 0) throw new BusinessError(`${d.name} has been used ${d.usageCount} time(s) and appears on invoices. Deactivate it instead.`);
    await Discount.deleteOne({ _id: id });
    await logActivity({ actor: user, action: "discount.deleted", entityType: "Discount", entityId: d._id, entityLabel: d.name, message: `Discount ${d.name} deleted` });
    revalidatePath("/discounts");
  }, "Discount deleted");
}
