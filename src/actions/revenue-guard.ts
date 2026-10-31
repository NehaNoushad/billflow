"use server";

import { revalidatePath } from "next/cache";
import { connectDB } from "@/lib/db";
import { requireAction, scopeFilter } from "@/lib/auth/guard";
import { logActivity, runAction } from "@/lib/utils-server";
import { RevenueInsight } from "@/models";
import { runRevenueChecks } from "@/services/revenue-guard";
import { generateNarrative } from "@/services/ai";

export async function runRevenueScanAction() {
  return runAction(async () => {
    const user = await requireAction("revenueGuard.view");
    await connectDB();
    const scope = await scopeFilter(user);
    const { findings, metrics } = await runRevenueChecks(scope);
    const narrative = await generateNarrative(metrics, findings);
    const doc = await RevenueInsight.create({
      generatedBy: user.id,
      scope: user.role === "ADMIN" ? "ALL" : `STAFF:${user.id}`,
      aiProvider: narrative.provider,
      summary: narrative.summary,
      recommendations: narrative.recommendations,
      metrics: { ...metrics, aiError: narrative.error },
      findings,
    });
    await logActivity({ actor: user, action: "revenueGuard.scan", entityType: "RevenueInsight", entityId: doc._id, message: `Revenue Guard scan: ${findings.length} finding(s), ${metrics.findingCounts.CRITICAL} critical` });
    revalidatePath("/revenue-guard");
    return { id: String(doc._id) };
  }, "Scan complete");
}
