import { headers } from "next/headers";
import { RateLimit } from "@/models";
import { connectDB } from "@/lib/db";

/**
 * Fixed-window rate limiter backed by MongoDB (works across serverless instances).
 * Returns true if the request is allowed.
 */
export async function rateLimit(bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  await connectDB();
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "local";
  const windowId = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `${bucket}:${ip}:${windowId}`;
  const doc = await RateLimit.findOneAndUpdate(
    { key },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((windowId + 1) * windowSeconds * 1000) } },
    { upsert: true, returnDocument: "after" }
  ).lean();
  return (doc?.count ?? 0) <= limit;
}

async function windowKey(bucket: string, windowSeconds: number) {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "local";
  const windowId = Math.floor(Date.now() / (windowSeconds * 1000));
  return { key: `${bucket}:${ip}:${windowId}`, expiresAt: new Date((windowId + 1) * windowSeconds * 1000) };
}

/** True if this bucket has already reached `limit` attempts in the current window (does not count this call). */
export async function isRateLimited(bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  await connectDB();
  const { key } = await windowKey(bucket, windowSeconds);
  const doc = await RateLimit.findOne({ key }).lean();
  return (doc?.count ?? 0) >= limit;
}

/** Count one attempt (e.g. a failed login) against the bucket. */
export async function recordAttempt(bucket: string, windowSeconds: number) {
  await connectDB();
  const { key, expiresAt } = await windowKey(bucket, windowSeconds);
  await RateLimit.updateOne({ key }, { $inc: { count: 1 }, $setOnInsert: { expiresAt } }, { upsert: true });
}
