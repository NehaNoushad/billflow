import { connectDB } from "@/lib/db";
import { requirePage } from "@/lib/auth/guard";
import { PageHeader } from "@/components/app/ui-bits";
import { PlanForm } from "@/components/catalog/plan-form";
import { planFormOptions } from "../_lib/data";

export const metadata = { title: "New plan" };

export default async function NewPlanPage() {
  await requirePage("catalog.manage");
  await connectDB();
  const { products, taxes } = await planFormOptions();
  return (
    <>
      <PageHeader title="New subscription plan" back={{ href: "/plans", label: "Plans" }} />
      <PlanForm products={products} taxes={taxes} />
    </>
  );
}
