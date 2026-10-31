"use server";

import { revalidatePath } from "next/cache";
import { connectDB } from "@/lib/db";
import { requireAction } from "@/lib/auth/guard";
import { runAction, type ActionResult } from "@/lib/utils-server";
import { billingRunSchema } from "@/validators/billing";
import { runBilling } from "@/services/billing";
import { parseDateInput } from "@/lib/dates";
import { rateLimit } from "@/lib/rate-limit";
import { BusinessError } from "@/lib/errors";

export async function runBillingAction(input: unknown): Promise<ActionResult<{ executionId: string; generated: number; skipped: number; failed: number }>> {
  return runAction(async () => {
    const user = await requireAction("billing.run");
    const data = billingRunSchema.parse(input);
    await connectDB();
    if (!(await rateLimit(`billing-run:${user.id}`, 20, 60))) throw new BusinessError("Too many billing runs in a short time. Wait a minute and retry.");
    const run = await runBilling({ asOf: parseDateInput(data.asOf), trigger: "MANUAL", actor: user });
    revalidatePath("/billing");
    revalidatePath("/invoices");
    revalidatePath("/dashboard");
    return { executionId: String(run!._id), generated: run!.generated, skipped: run!.skipped, failed: run!.failed };
  });
}
