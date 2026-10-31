"use server";

import { revalidatePath } from "next/cache";
import { connectDB } from "@/lib/db";
import { Customer, User } from "@/models";
import { customerSchema } from "@/validators/sales";
import { assertCustomerAccess, requireAction } from "@/lib/auth/guard";
import { can } from "@/lib/auth/permissions";
import { BusinessError, isObjectId, logActivity, runAction, type ActionResult } from "@/lib/utils-server";

function toDoc(data: ReturnType<typeof customerSchema.parse>) {
  return {
    name: data.name,
    email: data.email,
    phone: data.phone || undefined,
    companyName: data.companyName || undefined,
    billingAddress: {
      line1: data.line1 || undefined,
      line2: data.line2 || undefined,
      city: data.city || undefined,
      state: data.state || undefined,
      postalCode: data.postalCode || undefined,
      country: data.country || "India",
    },
    taxId: data.taxId || undefined,
    status: data.status,
    notes: data.notes || undefined,
  };
}

async function validStaff(id: string | undefined) {
  if (!id) return undefined;
  const staff = await User.findOne({ _id: id, role: { $in: ["STAFF", "ADMIN"] }, active: true }).lean();
  if (!staff) throw new BusinessError("Selected staff member not found.");
  return staff._id;
}

export async function createCustomerAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await requireAction("customers.manage");
    const data = customerSchema.parse(input);
    await connectDB();
    if (await Customer.exists({ email: data.email })) throw new BusinessError("A customer with this email already exists.");
    // Staff-created customers are assigned to the creator so they stay within their scope.
    const assignedStaff = user.role === "STAFF" ? user.id : await validStaff(data.assignedStaff);
    const customer = await Customer.create({ ...toDoc(data), assignedStaff });
    // Link an existing portal account with the same email, if any.
    const existingUser = await User.findOne({ email: data.email, role: "CUSTOMER" }).lean();
    if (existingUser) {
      await User.updateOne({ _id: existingUser._id }, { $set: { customer: customer._id } });
      await Customer.updateOne({ _id: customer._id }, { $set: { user: existingUser._id } });
    }
    await logActivity({ actor: user, action: "customer.created", entityType: "Customer", entityId: customer._id, entityLabel: customer.name, customer: customer._id, message: `Customer ${customer.name} created` });
    revalidatePath("/customers");
    return { id: String(customer._id) };
  }, "Customer created");
}

export async function updateCustomerAction(id: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await requireAction("customers.manage");
    if (!isObjectId(id)) throw new BusinessError("Invalid customer.");
    const data = customerSchema.parse(input);
    await connectDB();
    await assertCustomerAccess(user, id);
    const existing = await Customer.findById(id).lean();
    if (!existing) throw new BusinessError("Customer not found.");
    if (data.email !== existing.email && (await Customer.exists({ email: data.email, _id: { $ne: id } }))) throw new BusinessError("Another customer already uses this email.");
    if (data.email !== existing.email && existing.user) throw new BusinessError("This customer has a portal login; their email cannot be changed here.");
    const update: Record<string, unknown> = toDoc(data);
    if (can(user.role, "customers.assign")) update.assignedStaff = (await validStaff(data.assignedStaff)) ?? null;
    await Customer.updateOne({ _id: id }, { $set: update });
    await logActivity({ actor: user, action: "customer.updated", entityType: "Customer", entityId: existing._id, entityLabel: data.name, customer: existing._id, message: `Customer ${data.name} updated` });
    revalidatePath("/customers");
    revalidatePath(`/customers/${id}`);
    return { id };
  }, "Customer updated");
}
