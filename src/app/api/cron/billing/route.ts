import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { connectDB } from "@/lib/db";
import { runBilling } from "@/services/billing";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Scheduled recurring billing (Vercel Cron). Idempotent: safe to call more than once a day. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const ok = given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await connectDB();
  try {
    const run = await runBilling({ trigger: "CRON" });
    return NextResponse.json({
      ok: true,
      executionId: String(run?._id),
      status: run?.status,
      asOf: run?.asOf,
      processed: run?.processed,
      generated: run?.generated,
      skipped: run?.skipped,
      failed: run?.failed,
      autoClosed: run?.autoClosed,
      totalValuePaise: run?.totalValue,
    });
  } catch (err) {
    console.error("Cron billing failed", err);
    return NextResponse.json({ ok: false, error: "Billing run failed" }, { status: 500 });
  }
}
