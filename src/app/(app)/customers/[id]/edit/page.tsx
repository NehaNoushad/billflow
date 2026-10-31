import { notFound } from "next/navigation";
import { connectDB } from "@/lib/db";
import { Customer } from "@/models";
import { canAccessCustomer, requirePage } from "@/lib/auth/guard";
import { can } from "@/lib/auth/permissions";
import { isObjectId } from "@/lib/utils-server";
import { PageHeader } from "@/components/app/ui-bits";
import { CustomerForm } from "@/components/sales/customer-form";
import { staffOptions } from "@/components/sales/data";

export const metadata = { title: "Edit customer" };

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("customers.manage");
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  await connectDB();
  const c = await Customer.findById(id).lean();
  if (!c || !(await canAccessCustomer(user, c._id))) notFound();
  const canAssign = can(user.role, "customers.assign");
  const a = c.billingAddress ?? {};
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`Edit ${c.name}`} back={{ href: `/customers/${id}`, label: c.name }} />
      <CustomerForm
        customerId={id}
        canAssign={canAssign}
        staff={canAssign ? await staffOptions() : []}
        defaultValues={{
          name: c.name,
          email: c.email,
          phone: c.phone ?? "",
          companyName: c.companyName ?? "",
          line1: a.line1 ?? "",
          line2: a.line2 ?? "",
          city: a.city ?? "",
          state: a.state ?? "",
          postalCode: a.postalCode ?? "",
          country: a.country ?? "India",
          taxId: c.taxId ?? "",
          status: c.status as "ACTIVE" | "INACTIVE",
          assignedStaff: c.assignedStaff ? String(c.assignedStaff) : "",
          notes: c.notes ?? "",
        }}
      />
    </div>
  );
}
