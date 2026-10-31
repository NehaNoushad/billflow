import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Customer, User } from "@/models";
import { SESSION_COOKIE, verifySession } from "./session";
import { can, type Permission } from "./permissions";
import type { Role } from "@/lib/constants";
import { AuthError } from "@/lib/errors";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  customerId?: string;
};

export { AuthError };

/** Reads and re-validates the session against the database (deactivated users / revoked sessions are rejected). */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const store = await cookies();
  const session = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (!session || !Types.ObjectId.isValid(session.sub)) return null;
  await connectDB();
  const user = await User.findById(session.sub).select("name email role customer active sessionVersion").lean();
  if (!user || !user.active || (user.sessionVersion ?? 0) !== session.v) return null;
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role as Role,
    customerId: user.customer ? String(user.customer) : undefined,
  };
});

/** For pages: redirect to login (or the right home) when not permitted. */
export async function requirePage(permission?: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  // A stale cookie would otherwise loop between proxy.ts (/login → home) and this guard (home → /login).
  if (!user) redirect("/api/auth/clear");
  if (permission && !can(user.role, permission)) redirect(user.role === "CUSTOMER" ? "/portal" : "/dashboard");
  return user;
}

/** For server actions / route handlers: throw instead of redirecting. */
export async function requireAction(permission?: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Your session has expired. Please sign in again.");
  if (permission && !can(user.role, permission)) throw new AuthError();
  return user;
}

/**
 * Data scope for the signed-in user, as a list of customer ids they may see.
 * ADMIN → null (everything). STAFF → customers assigned to them. CUSTOMER → only their own record.
 */
export async function customerScope(user: CurrentUser): Promise<Types.ObjectId[] | null> {
  if (user.role === "ADMIN") return null;
  if (user.role === "CUSTOMER") return user.customerId ? [new Types.ObjectId(user.customerId)] : [];
  const ids = await Customer.find({ assignedStaff: user.id }).distinct("_id");
  return ids as Types.ObjectId[];
}

/** Mongo filter fragment restricting a query on `field` to the user's scope. */
export async function scopeFilter(user: CurrentUser, field = "customer"): Promise<Record<string, unknown>> {
  const ids = await customerScope(user);
  return ids === null ? {} : { [field]: { $in: ids } };
}

/** Throws unless the user may access records belonging to `customerId`. */
export async function assertCustomerAccess(user: CurrentUser, customerId: unknown) {
  const ids = await customerScope(user);
  if (ids === null) return;
  const target = String(customerId);
  if (!ids.some((id) => String(id) === target)) throw new AuthError("This record is outside your access scope.");
}

export async function canAccessCustomer(user: CurrentUser, customerId: unknown): Promise<boolean> {
  try {
    await assertCustomerAccess(user, customerId);
    return true;
  } catch {
    return false;
  }
}
