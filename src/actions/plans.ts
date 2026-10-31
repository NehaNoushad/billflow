"use server";

import { revalidatePath } from "next/cache";
import { connectDB } from "@/lib/db";
import { requireAction } from "@/lib/auth/guard";
import { parseDateInput } from "@/lib/dates";
import { BusinessError, isObjectId, logActivity, runAction } from "@/lib/utils-server";
import { Quotation, QuotationTemplate, Subscription, SubscriptionPlan } from "@/models";
import { planSchema } from "@/validators/catalog";

export async function savePlan(id: string | null, input: unknown) {
  return runAction(async () => {
    const user = await requireAction("catalog.manage");
    const data = planSchema.parse(input);
    await connectDB();
    const fields = {
      name: data.name,
      description: data.description || undefined,
      products: data.products,
      billingInterval: data.billingInterval,
      basePrice: data.basePrice,
      taxes: data.taxes,
      minQuantity: data.minQuantity,
      termLength: data.termLength,
      availableFrom: data.availableFrom ? parseDateInput(data.availableFrom) : null,
      availableUntil: data.availableUntil ? parseDateInput(data.availableUntil) : null,
      autoClose: data.autoClose,
      allowEarlyClose: data.allowEarlyClose,
      allowPause: data.allowPause,
      allowRenewal: data.allowRenewal,
      status: data.status,
    };
    let plan;
    if (id) {
      if (!isObjectId(id)) throw new BusinessError("Invalid plan.");
      const existing = await SubscriptionPlan.findById(id).lean();
      if (!existing) throw new BusinessError("Plan not found.");
      if (existing.status === "ARCHIVED") throw new BusinessError("Restore this plan before editing it.");
      plan = await SubscriptionPlan.findByIdAndUpdate(id, { $set: fields }, { returnDocument: "after", runValidators: true });
    } else {
      plan = await SubscriptionPlan.create(fields);
    }
    await logActivity({ actor: user, action: id ? "plan.updated" : "plan.created", entityType: "SubscriptionPlan", entityId: plan!._id, entityLabel: plan!.name, message: `Plan ${plan!.name} ${id ? "updated" : "created"} — existing subscriptions keep their agreed terms` });
    revalidatePath("/plans");
    return { id: String(plan!._id) };
  }, id ? "Plan updated" : "Plan created");
}

export async function setPlanArchived(id: string, archived: boolean) {
  return runAction(async () => {
    const user = await requireAction("catalog.manage");
    if (!isObjectId(id)) throw new BusinessError("Invalid plan.");
    await connectDB();
    // Restored plans come back as DRAFT so they are reviewed before being sold again.
    const plan = await SubscriptionPlan.findByIdAndUpdate(id, { $set: { status: archived ? "ARCHIVED" : "DRAFT" } }, { returnDocument: "after" }).lean();
    if (!plan) throw new BusinessError("Plan not found.");
    await logActivity({ actor: user, action: archived ? "plan.archived" : "plan.restored", entityType: "SubscriptionPlan", entityId: plan._id, entityLabel: plan.name, message: `Plan ${plan.name} ${archived ? "archived" : "restored as draft"}` });
    revalidatePath("/plans");
    revalidatePath(`/plans/${id}`);
  }, archived ? "Plan archived" : "Plan restored as draft");
}

export async function deletePlan(id: string) {
  return runAction(async () => {
    const user = await requireAction("catalog.manage");
    if (!isObjectId(id)) throw new BusinessError("Invalid plan.");
    await connectDB();
    const plan = await SubscriptionPlan.findById(id).lean();
    if (!plan) throw new BusinessError("Plan not found.");
    const [subs, quotes, templates] = await Promise.all([Subscription.countDocuments({ plan: id }), Quotation.countDocuments({ plan: id }), QuotationTemplate.countDocuments({ plan: id })]);
    if (subs + quotes + templates > 0) {
      throw new BusinessError(`${plan.name} is used by ${subs} subscription(s), ${quotes} quotation(s) and ${templates} template(s). Archive it instead.`);
    }
    await SubscriptionPlan.deleteOne({ _id: id });
    await logActivity({ actor: user, action: "plan.deleted", entityType: "SubscriptionPlan", entityId: plan._id, entityLabel: plan.name, message: `Plan ${plan.name} deleted` });
    revalidatePath("/plans");
  }, "Plan deleted");
}
