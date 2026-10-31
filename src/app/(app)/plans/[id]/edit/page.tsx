import { notFound, redirect } from "next/navigation";
import { connectDB } from "@/lib/db";
import { requirePage } from "@/lib/auth/guard";
import { toDateInput } from "@/lib/dates";
import { toRupeeString } from "@/lib/money";
import { isObjectId } from "@/lib/utils-server";
import { SubscriptionPlan } from "@/models";
import { PageHeader } from "@/components/app/ui-bits";
import { PlanForm } from "@/components/catalog/plan-form";
import type { PlanFormValues } from "@/validators/catalog";
import { planFormOptions } from "../../_lib/data";

export const metadata = { title: "Edit plan" };

export default async function EditPlanPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage("catalog.manage");
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  await connectDB();
  const plan = await SubscriptionPlan.findById(id).lean();
  if (!plan) notFound();
  if (plan.status === "ARCHIVED") redirect(`/plans/${id}`);
  const { products, taxes } = await planFormOptions(plan.taxes ?? [], plan.products ?? []);
  const defaults: PlanFormValues = {
    name: plan.name,
    description: plan.description ?? "",
    products: (plan.products ?? []).map(String),
    billingInterval: plan.billingInterval,
    basePrice: toRupeeString(plan.basePrice),
    taxes: (plan.taxes ?? []).map(String),
    minQuantity: plan.minQuantity ?? 1,
    termLength: plan.termLength ?? 12,
    availableFrom: toDateInput(plan.availableFrom),
    availableUntil: toDateInput(plan.availableUntil),
    autoClose: plan.autoClose ?? true,
    allowEarlyClose: plan.allowEarlyClose ?? true,
    allowPause: plan.allowPause ?? true,
    allowRenewal: plan.allowRenewal ?? true,
    status: plan.status as "DRAFT" | "PUBLISHED",
  };
  return (
    <>
      <PageHeader title={`Edit ${plan.name}`} back={{ href: `/plans/${id}`, label: plan.name }} />
      <PlanForm id={id} defaults={defaults} products={products} taxes={taxes} />
    </>
  );
}
