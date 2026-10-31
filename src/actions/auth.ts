"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connectDB } from "@/lib/db";
import { Customer, PasswordResetToken, User } from "@/models";
import { forgotSchema, loginSchema, registerSchema, resetSchema } from "@/validators/auth";
import { generateToken, hashPassword, sha256, verifyPassword } from "@/lib/auth/password";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/auth/session";
import { isRateLimited, rateLimit, recordAttempt } from "@/lib/rate-limit";
import { appUrl, emailConfigured, sendEmail } from "@/lib/email";
import { logActivity, runAction, BusinessError, type ActionResult } from "@/lib/utils-server";
import type { Role } from "@/lib/constants";

async function startSession(user: { _id: unknown; name: string; email: string; role: string; customer?: unknown; sessionVersion?: number | null }) {
  const token = await signSession({
    sub: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role as Role,
    customerId: user.customer ? String(user.customer) : undefined,
    v: user.sessionVersion ?? 0,
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function loginAction(input: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  return runAction(async () => {
    const data = loginSchema.parse(input);
    await connectDB();
    // Only failed attempts count, so normal use never locks anyone out.
    const bucket = `login:${data.email}`;
    if (await isRateLimited(bucket, 10, 15 * 60)) throw new BusinessError("Too many failed sign-in attempts. Please wait 15 minutes and try again.");
    const user = await User.findOne({ email: data.email }).select("+passwordHash").lean();
    // Same message for unknown email and wrong password to avoid account enumeration.
    if (!user || !(await verifyPassword(data.password, user.passwordHash))) {
      await recordAttempt(bucket, 15 * 60);
      throw new BusinessError("Invalid email or password.");
    }
    if (!user.active) throw new BusinessError("This account has been deactivated. Contact your administrator.");
    await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
    await startSession(user);
    return { redirectTo: user.role === "CUSTOMER" ? "/portal" : "/dashboard" };
  });
}

export async function registerAction(input: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  return runAction(async () => {
    const data = registerSchema.parse(input);
    await connectDB();
    if (!(await rateLimit("register", 10, 60 * 60))) throw new BusinessError("Too many registrations from this network. Try again later.");
    if (await User.exists({ email: data.email })) throw new BusinessError("An account with this email already exists.");
    // Link to an existing customer record (created by staff) instead of duplicating it.
    let customer = await Customer.findOne({ email: data.email });
    if (customer?.user) throw new BusinessError("An account with this email already exists.");
    if (!customer) customer = await Customer.create({ name: data.name, email: data.email, status: "ACTIVE" });
    const user = await User.create({ name: data.name, email: data.email, passwordHash: await hashPassword(data.password), role: "CUSTOMER", customer: customer._id });
    customer.user = user._id;
    await customer.save();
    await logActivity({ actor: { id: String(user._id), name: user.name, email: user.email, role: "CUSTOMER" }, action: "customer.registered", entityType: "Customer", entityId: customer._id, entityLabel: customer.name, customer: customer._id, message: `${user.name} registered a customer account` });
    await startSession(user.toObject());
    return { redirectTo: "/portal" };
  });
}

export async function logoutAction() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export async function forgotPasswordAction(input: unknown): Promise<ActionResult<{ devLink?: string }>> {
  return runAction(async () => {
    const data = forgotSchema.parse(input);
    await connectDB();
    if (!(await rateLimit(`forgot:${data.email}`, 5, 60 * 60))) throw new BusinessError("Too many reset requests. Please try again later.");
    const user = await User.findOne({ email: data.email, active: true }).lean();
    if (!user) return {}; // do not reveal whether the email exists
    const { token, hash } = generateToken();
    await PasswordResetToken.create({ user: user._id, tokenHash: hash, expiresAt: new Date(Date.now() + 30 * 60 * 1000) });
    const link = `${appUrl()}/reset-password?token=${token}`;
    const sent = await sendEmail({
      to: user.email,
      subject: "Reset your BILLFLOW password",
      text: `Use this link to reset your password (valid for 30 minutes): ${link}`,
      html: `<p>Hi ${user.name},</p><p>Use the link below to reset your BILLFLOW password. It expires in 30 minutes.</p><p><a href="${link}">Reset password</a></p><p>If you didn't request this, ignore this email.</p>`,
    });
    // Without SMTP, show the link only in local development so the flow can be demonstrated.
    return !sent && !emailConfigured() && process.env.NODE_ENV !== "production" ? { devLink: link } : {};
  });
}

export async function resetPasswordAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const data = resetSchema.parse(input);
    await connectDB();
    if (!(await rateLimit("reset", 20, 60 * 60))) throw new BusinessError("Too many attempts. Try again later.");
    const record = await PasswordResetToken.findOneAndUpdate(
      { tokenHash: sha256(data.token), usedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } }
    ).lean();
    if (!record) throw new BusinessError("This reset link is invalid or has expired. Request a new one.");
    // Changing the password also bumps sessionVersion, signing out every existing session.
    await User.updateOne({ _id: record.user }, { $set: { passwordHash: await hashPassword(data.password) }, $inc: { sessionVersion: 1 } });
    return undefined;
  }, "Password updated. You can now sign in.");
}
