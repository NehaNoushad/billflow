import Link from "next/link";
import { AlertOctagon, AlertTriangle, Bot, Info, ShieldCheck, Sparkles } from "lucide-react";
import { requirePage } from "@/lib/auth/guard";
import { connectDB } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { isObjectId, sp } from "@/lib/utils-server";
import { RevenueInsight } from "@/models";
import { ActionButton } from "@/components/app/action-button";
import { EmptyState, PageHeader, Panel, StatusBadge } from "@/components/app/ui-bits";
import { runRevenueScanAction } from "@/actions/revenue-guard";
import { cn } from "@/lib/utils";
import type { Finding, Severity } from "@/services/revenue-guard";

export const metadata = { title: "AI Revenue Guard" };

const PROVIDER_LABEL: Record<string, string> = { gemini: "Google Gemini", openai: "OpenAI", rules: "Rule-based fallback" };
const SEVERITY: Record<Severity, { label: string; icon: typeof Info; cls: string; ring: string }> = {
  CRITICAL: { label: "Critical", icon: AlertOctagon, cls: "text-red-700 bg-red-50", ring: "border-l-red-500" },
  WARNING: { label: "Warning", icon: AlertTriangle, cls: "text-amber-800 bg-amber-50", ring: "border-l-amber-500" },
  INFO: { label: "Information", icon: Info, cls: "text-indigo-700 bg-indigo-50", ring: "border-l-indigo-500" },
};

export default async function RevenueGuardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("revenueGuard.view");
  await connectDB();
  const params = await searchParams;
  const scopeKey = user.role === "ADMIN" ? "ALL" : `STAFF:${user.id}`;
  const history = await RevenueInsight.find({ scope: scopeKey }).select("generatedAt aiProvider findings.severity").sort({ generatedAt: -1 }).limit(10).lean();
  const selectedId = sp(params, "scan");
  const insight = await RevenueInsight.findOne(isObjectId(selectedId) ? { _id: selectedId, scope: scopeKey } : { scope: scopeKey }).sort({ generatedAt: -1 }).lean();

  const findings = (insight?.findings ?? []) as Finding[];
  const counts = { CRITICAL: 0, WARNING: 0, INFO: 0 } as Record<Severity, number>;
  for (const f of findings) counts[f.severity]++;
  const metrics = (insight?.metrics ?? {}) as { aiError?: string; overdueAmount?: number; missedBillingAmount?: number; mrr?: number; activeSubscriptions?: number };

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Revenue Guard"
        description="Deterministic checks across subscriptions, invoices and payments — explained by AI. Every finding links to the records behind it."
        actions={
          <ActionButton action={runRevenueScanAction} variant="default" size="default" successMessage="Scan complete">
            <ShieldCheck className="size-4" /> Run scan
          </ActionButton>
        }
      />

      {!insight ? (
        <Panel>
          <EmptyState icon={ShieldCheck} title="No scans yet" description="Run a scan to check for missed invoices, duplicates, overdue payments, expiring subscriptions, discount limits and pricing leakage." />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Panel
              className="xl:col-span-2"
              title={
                <span className="flex items-center gap-2">
                  <Sparkles className="size-4 text-primary" /> Financial summary
                </span>
              }
              description={`Generated ${formatDateTime(insight.generatedAt)}${user.role === "STAFF" ? " · your assigned customers" : ""}`}
              actions={
                <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset", insight.aiProvider === "rules" ? "bg-slate-100 text-slate-700 ring-slate-500/20" : "bg-violet-50 text-violet-700 ring-violet-600/20")}>
                  <Bot className="size-3.5" /> {PROVIDER_LABEL[insight.aiProvider] ?? insight.aiProvider}
                </span>
              }
            >
              <p className="text-[15px] leading-relaxed">{insight.summary}</p>
              {insight.aiProvider === "rules" && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {metrics.aiError ? `AI provider unavailable (${metrics.aiError}); ` : "No AI API key configured (set GEMINI_API_KEY or OPENAI_API_KEY); "}
                  this summary was generated from the same verified findings by rules.
                </p>
              )}
              <h3 className="mt-5 mb-2 text-sm font-semibold">Recommendations</h3>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm">
                {((insight.recommendations ?? []) as string[]).map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ol>
            </Panel>

            <div className="space-y-6">
              <div className="grid grid-cols-3 gap-3">
                {(Object.keys(SEVERITY) as Severity[]).map((s) => {
                  const S = SEVERITY[s];
                  return (
                    <a key={s} href={`#${s.toLowerCase()}`} className="rounded-xl border bg-card p-3 text-center shadow-xs hover:bg-muted/40">
                      <S.icon className={cn("mx-auto size-5", s === "CRITICAL" ? "text-red-600" : s === "WARNING" ? "text-amber-600" : "text-indigo-600")} />
                      <p className="mt-1 text-2xl font-semibold tabular-nums">{counts[s]}</p>
                      <p className="text-xs text-muted-foreground">{S.label}</p>
                    </a>
                  );
                })}
              </div>
              <Panel title="Scan history" bodyClassName="p-0">
                <ul className="divide-y text-sm">
                  {history.map((h) => {
                    const crit = ((h.findings ?? []) as { severity?: string }[]).filter((f) => f.severity === "CRITICAL").length;
                    const selected = String(h._id) === String(insight._id);
                    return (
                      <li key={String(h._id)}>
                        <Link href={`/revenue-guard?scan=${h._id}`} className={cn("flex items-center gap-3 px-5 py-2.5 hover:bg-muted/40", selected && "bg-accent")}>
                          <span className="flex-1">
                            <span className="block font-medium">{formatDateTime(h.generatedAt)}</span>
                            <span className="block text-xs text-muted-foreground">
                              {(h.findings ?? []).length} findings · {PROVIDER_LABEL[h.aiProvider] ?? h.aiProvider}
                            </span>
                          </span>
                          {crit > 0 && <StatusBadge status="CRITICAL" />}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            </div>
          </div>

          {findings.length === 0 ? (
            <Panel>
              <EmptyState icon={ShieldCheck} title="No issues found" description="All checks passed for this scan." />
            </Panel>
          ) : (
            (Object.keys(SEVERITY) as Severity[])
              .filter((s) => counts[s] > 0)
              .map((s) => (
                <section key={s} id={s.toLowerCase()} className="space-y-3">
                  <h2 className="text-sm font-semibold text-muted-foreground">
                    {SEVERITY[s].label} · {counts[s]}
                  </h2>
                  {findings
                    .filter((f) => f.severity === s)
                    .map((f) => {
                      const S = SEVERITY[f.severity];
                      return (
                        <article key={f.code} className={cn("rounded-xl border border-l-4 bg-card p-5 shadow-xs", S.ring)}>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex items-start gap-3">
                              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", S.cls)}>
                                <S.icon className="size-4" />
                              </span>
                              <div>
                                <h3 className="font-semibold">{f.title}</h3>
                                <p className="mt-1 text-sm text-muted-foreground">{f.detail}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 sm:flex-col sm:items-end">
                              <StatusBadge status={f.severity} />
                              {f.amount ? <span className="text-sm font-semibold tabular-nums">{formatMoney(Math.abs(f.amount))}</span> : null}
                            </div>
                          </div>
                          {f.records.length > 0 && (
                            <div className="mt-4 border-t pt-3">
                              <p className="mb-2 text-xs font-medium text-muted-foreground">Supporting records ({f.records.length})</p>
                              <div className="flex flex-wrap gap-1.5">
                                {f.records.map((r) => (
                                  <Link key={`${r.type}-${r.id}`} href={r.href} className="rounded-md border bg-muted/30 px-2 py-1 text-xs hover:border-primary hover:text-primary">
                                    <span className="text-muted-foreground">{r.type}:</span> {r.label}
                                  </Link>
                                ))}
                              </div>
                            </div>
                          )}
                        </article>
                      );
                    })}
                </section>
              ))
          )}
        </>
      )}
    </div>
  );
}
