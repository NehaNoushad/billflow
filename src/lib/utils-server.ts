import { Types } from "mongoose";
import { Counter, ActivityLog, Setting } from "@/models";
import type { CurrentUser } from "@/lib/auth/guard";
import { AuthError, BusinessError } from "@/lib/errors";
import { ZodError } from "zod";

/** Convert Mongoose lean docs (ObjectIds, Dates) into plain JSON for client components. */
export function serialize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function isObjectId(id: unknown): id is string {
  return typeof id === "string" && Types.ObjectId.isValid(id) && String(new Types.ObjectId(id)) === id;
}

/** Atomically allocate the next sequence number for a document type. */
export async function nextSequence(key: string): Promise<number> {
  const doc = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" }).lean();
  return doc!.seq;
}

export async function nextNumber(kind: "INV" | "SUB" | "QT" | "PAY", date = new Date()): Promise<string> {
  if (kind === "INV") {
    const year = date.getUTCFullYear();
    const seq = await nextSequence(`INV-${year}`);
    return `INV-${year}-${String(seq).padStart(5, "0")}`;
  }
  const seq = await nextSequence(kind);
  return `${kind}-${String(seq).padStart(5, "0")}`;
}

export async function logActivity(entry: {
  actor?: CurrentUser | null;
  action: string;
  entityType: string;
  entityId?: unknown;
  entityLabel?: string;
  customer?: unknown;
  message: string;
  meta?: Record<string, unknown>;
}) {
  try {
    await ActivityLog.create({
      actor: entry.actor?.id,
      actorName: entry.actor?.name ?? "System",
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      entityLabel: entry.entityLabel,
      customer: entry.customer,
      message: entry.message,
      meta: entry.meta,
    });
  } catch (err) {
    console.error("Failed to write activity log", err);
  }
}

export async function getSettings() {
  const s = await Setting.findById("global").lean();
  if (s) return s;
  return (await Setting.create({ _id: "global" })).toObject();
}

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Wrap a server action body: converts auth, validation and business errors into a typed result. */
export async function runAction<T>(fn: () => Promise<T>, successMessage?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message: successMessage };
  } catch (err) {
    if (err instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of err.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
      return { ok: false, error: err.issues[0]?.message ?? "Invalid input", fieldErrors };
    }
    if (err instanceof AuthError || err instanceof BusinessError) return { ok: false, error: err.message };
    if (err && typeof err === "object" && "code" in err && (err as { code: number }).code === 11000) {
      return { ok: false, error: "A record with the same unique value already exists." };
    }
    // Next.js redirect()/notFound() throw special errors that must propagate.
    if (err && typeof err === "object" && "digest" in err && String((err as { digest: string }).digest).startsWith("NEXT_")) throw err;
    console.error(err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export { BusinessError };

export function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Read a single string from Next.js searchParams. */
export function sp(params: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v || undefined;
}

export function pageParam(params: Record<string, string | string[] | undefined>): number {
  const n = Number(sp(params, "page") ?? 1);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}
