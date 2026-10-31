import { connectDB } from "@/lib/db";
import { requirePage } from "@/lib/auth/guard";
import { can } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/app/ui-bits";
import { CustomerForm } from "@/components/sales/customer-form";
import { staffOptions } from "@/components/sales/data";

export const metadata = { title: "New customer" };

export default async function NewCustomerPage() {
  const user = await requirePage("customers.manage");
  await connectDB();
  const canAssign = can(user.role, "customers.assign");
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="New customer" back={{ href: "/customers", label: "Customers" }} description={canAssign ? undefined : "The customer will be assigned to you."} />
      <CustomerForm canAssign={canAssign} staff={canAssign ? await staffOptions() : []} />
    </div>
  );
}
