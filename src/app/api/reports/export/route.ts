import { NextResponse, type NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { requireAction, scopeFilter } from "@/lib/auth/guard";
import { AuthError } from "@/lib/errors";
import { resolvePeriod } from "@/lib/dates";
import { buildMatches } from "@/services/analytics";
import { buildReport, isReportKey, toCsv } from "@/services/reports";
import { reportFiltersFrom } from "@/app/(app)/reports/filters";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAction("reports.view");
    await connectDB();
    const q = request.nextUrl.searchParams;
    const key = q.get("report") ?? undefined;
    if (!isReportKey(key)) return NextResponse.json({ error: "Unknown report" }, { status: 400 });
    const filters = reportFiltersFrom(Object.fromEntries(q.entries()));
    const period = resolvePeriod(q.get("from") && q.get("to") ? "custom" : "12m", q.get("from") ?? undefined, q.get("to") ?? undefined);
    const m = await buildMatches(await scopeFilter(user), filters);
    const report = await buildReport(key, m, period, filters);
    const filename = `billflow-${key}-${period.from.toISOString().slice(0, 10)}-to-${new Date(period.to.getTime() - 86400000).toISOString().slice(0, 10)}.csv`;
    return new NextResponse(toCsv(report), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    console.error(err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
