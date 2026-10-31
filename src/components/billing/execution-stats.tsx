import { Archive, CheckCircle2, FileText, SkipForward, XCircle } from "lucide-react";
import { formatMoney } from "@/lib/money";

export function ExecutionStats({ run }: { run: { processed: number; generated: number; skipped: number; failed: number; autoClosed: number; totalValue: number } }) {
  const items = [
    { label: "Subscriptions processed", value: run.processed, icon: FileText, cls: "text-foreground" },
    { label: "Invoices generated", value: run.generated, icon: CheckCircle2, cls: "text-emerald-700" },
    { label: "Skipped (already billed)", value: run.skipped, icon: SkipForward, cls: "text-slate-600" },
    { label: "Failed operations", value: run.failed, icon: XCircle, cls: run.failed ? "text-red-600" : "text-slate-600" },
    { label: "Auto-closed", value: run.autoClosed, icon: Archive, cls: "text-slate-600" },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((i) => (
        <div key={i.label}>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <i.icon className="size-3.5" /> {i.label}
          </p>
          <p className={`mt-1 text-xl font-semibold tabular-nums ${i.cls}`}>{i.value}</p>
        </div>
      ))}
      <div>
        <p className="text-xs text-muted-foreground">Total invoice value</p>
        <p className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(run.totalValue)}</p>
      </div>
    </div>
  );
}
