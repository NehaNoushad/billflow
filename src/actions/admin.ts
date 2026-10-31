"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { Customer, Setting, User } from "@/models";
import { requireAction } from "@/lib/auth/guard";
import { hashPassword } from "@/lib/auth/password";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { staffSchema } from "@/validators/auth";
import { intField } from "@/validators/common";
import { BusinessError, logActivity, runAction } from "@/lib/utils-server";
import { seedDatabase } from "@/services/seed";

const settingsSchema = z.object({
  companyName: z.string().trim().min(2, "Company name is required").max(120),
  companyEmail: z.string().trim().email("Enter a valid email"),
  companyPhone: z.string().trim().max(40).optional(),
  companyAddress: z.string().trim().max(300).optional(),
  companyTaxId: z.string().trim().max(20).optional(),
  defaultPaymentTermsDays: intField("Payment terms", 0).max(365),
  autoConfirmInvoices: z.boolean(),
  allowPartialPayments: z.boolean(),
  chargeDuringPause: z.boolean(),
  invoiceFooter: z.string().trim().max(300).optional(),
});
export type SettingsInput = z.input<typeof settingsSchema>;

export async function updateSettingsAction(input: unknown) {
  return runAction(async () => {
    const user = await requireAction("settings.manage");
    const data = settingsSchema.parse(input);
    await connectDB();
    await Setting.updateOne({ _id: "global" }, { $set: data }, { upsert: true });
    await logActivity({ actor: user, action: "settings.updated", entityType: "Setting", message: "Company and billing settings updated" });
    revalidatePath("/settings");
  }, "Settings saved");
}

export async function createStaffAction(input: unknown) {
  return runAction(async () => {
    const admin = await requireAction("staff.manage");
    const data = staffSchema.parse(input);
    await connectDB();
    if (await User.exists({ email: data.email })) throw new BusinessError("A user with this email already exists.");
    const user = await User.create({ name: data.name, email: data.email, role: data.role, passwordHash: await hashPassword(data.password) });
    await logActivity({ actor: admin, action: "staff.created", entityType: "User", entityId: user._id, entityLabel: user.name, message: `${data.role === "ADMIN" ? "Admin" : "Staff"} account created for ${user.name}` });
    revalidatePath("/staff");
  }, "Team member added");
}

export async function setStaffActiveAction(userId: string, active: boolean) {
  return runAction(async () => {
    const admin = await requireAction("staff.manage");
    if (userId === admin.id) throw new BusinessError("You cannot deactivate your own account.");
    await connectDB();
    const target = await User.findOne({ _id: userId, role: { $in: ["ADMIN", "STAFF"] } });
    if (!target) throw new BusinessError("User not found.");
    if (!active && target.role === "ADMIN" && (await User.countDocuments({ role: "ADMIN", active: true })) <= 1) throw new BusinessError("At least one active admin is required.");
    target.active = active;
    if (!active) target.sessionVersion = (target.sessionVersion ?? 0) + 1; // sign them out everywhere
    await target.save();
    if (!active) await Customer.updateMany({ assignedStaff: target._id }, { $unset: { assignedStaff: 1 } });
    await logActivity({ actor: admin, action: active ? "staff.activated" : "staff.deactivated", entityType: "User", entityId: target._id, entityLabel: target.name, message: `${target.name} ${active ? "re-activated" : "deactivated"}${active ? "" : "; their customers were unassigned"}` });
    revalidatePath("/staff");
  }, active ? "Account activated" : "Account deactivated");
}

export async function resetDemoAction() {
  return runAction(async () => {
    await requireAction("demo.reset");
    if (process.env.DEMO_MODE !== "true") throw new BusinessError("Demo reset is disabled. Set DEMO_MODE=true to enable it.");
    await connectDB();
    await seedDatabase();
    // All user ids changed, so the current session is no longer valid.
    (await cookies()).delete(SESSION_COOKIE);
    return { redirectTo: "/login" };
  }, "Demo data restored. Please sign in again.");
}
