import Link from "next/link";
import { notFound } from "next/navigation";
import { connectDB } from "@/lib/db";
import { BillingExecution } from "@/models";
import { requirePage } from "@/lib/auth/guard";
import { isObjectId } from "@/lib/utils-server";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { humanize } from "@/lib/constants";
import { DetailList, EmptyState, PageHeader, Panel, StatusBadge, tableCls } from "@/components/app/ui-bits";
import { ExecutionStats } from "@/components/billing/execution-stats";

type Entry = { subscription?: unknown; subscriptionNumber?: string; outcome?: "GENERATED" | "SKIPPED" | "FAILED" | "CLOSED"; invoice?: unknown; invoiceNumber?: string; periodStart?: Date; amount?: number; message?: string };

export const metadata = { title: "Billing execution" };


export default async function ExecutionPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage("billing.run");
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  await connectDB();
  const run = await BillingExecution.findById(id).lean();
  if (!run) notFound();
  const duration = run.finishedAt ? `${((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000).toFixed(1)}s` : "Running…";

  return (
    <>
      <PageHeader title={`Billing run · ${formatDate(run.asOf)}`} description={`${humanize(run.trigger)} run started ${formatDateTime(run.startedAt)} by ${run.triggeredByName ?? "System"}`} back={{ href: "/billing", label: "Billing runs" }} actions={<StatusBadge status={run.status} />} />
      <Panel title="Execution summary">
        <ExecutionStats run={run} />
        <div className="mt-5 border-t pt-4">
          <DetailList
            items={[
              { label: "Billed up to (as of)", value: formatDate(run.asOf) },
              { label: "Duration", value: duration },
              { label: "Trigger", value: humanize(run.trigger) },
              { label: "Finished", value: formatDateTime(run.finishedAt) },
            ]}
          />
        </div>
      </Panel>
      <Panel title="Operations log" description="Every subscription period the engine touched in this run" className="mt-6" bodyClassName="p-0">
        {run.entries.length === 0 ? (
          <EmptyState title="Nothing was due" description="No active subscription had a billing date on or before this run's date." />
        ) : (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead className={tableCls.thead}>
                <tr>
                  <th className={tableCls.th}>Subscription</th>
                  <th className={tableCls.th}>Outcome</th>
                  <th className={tableCls.th}>Period start</th>
                  <th className={tableCls.th}>Invoice</th>
                  <th className={`${tableCls.th} text-right`}>Amount</th>
                  <th className={tableCls.th}>Message</th>
                </tr>
              </thead>
              <tbody>
                {(run.entries as Entry[]).map((e, i) => (
                  <tr key={i} className={tableCls.tr}>
                    <td className={tableCls.td}>
                      {e.subscription ? (
                        <Link href={`/subscriptions/${e.subscription}`} className="text-primary hover:underline">
                          {e.subscriptionNumber}
                        </Link>
                      ) : (
                        e.subscriptionNumber
                      )}
                    </td>
                    <td className={tableCls.td}>
                      <span className={{ GENERATED: "font-medium text-emerald-700", SKIPPED: "text-slate-500", FAILED: "font-medium text-red-600", CLOSED: "text-slate-600" }[e.outcome ?? "SKIPPED"]}>{humanize(e.outcome ?? "")}</span>
                    </td>
                    <td className={tableCls.td}>{formatDate(e.periodStart)}</td>
                    <td className={tableCls.td}>
                      {e.invoice ? (
                        <Link href={`/invoices/${e.invoice}`} className="text-primary hover:underline">
                          {e.invoiceNumber}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={tableCls.num}>{e.amount != null ? formatMoney(e.amount) : "—"}</td>
                    <td className="max-w-md px-4 py-3 text-xs text-muted-foreground">{e.message ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
