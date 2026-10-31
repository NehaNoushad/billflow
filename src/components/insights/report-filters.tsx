"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Loader2, X } from "lucide-react";

type Option = { value: string; label: string };
type Props = { products: Option[]; plans: Option[]; customers: Option[]; subscriptionStatuses: Option[]; invoiceStatuses: Option[]; defaultFrom: string; defaultTo: string };

/** Report filter row: date range + dimensions, all stored in the URL and applied on the server. */
export function ReportFilters({ products, plans, customers, subscriptionStatuses, invoiceStatuses, defaultFrom, defaultTo }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const set = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (changes.from && !next.get("to")) next.set("to", defaultTo);
    if (changes.to && !next.get("from")) next.set("from", defaultFrom);
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  const selects: { name: string; label: string; options: Option[] }[] = [
    { name: "customer", label: "All customers", options: customers },
    { name: "product", label: "All products", options: products },
    { name: "plan", label: "All plans", options: plans },
    { name: "subscriptionStatus", label: "Any subscription status", options: subscriptionStatuses },
    { name: "invoiceStatus", label: "Any invoice status", options: invoiceStatuses },
  ];
  const active = ["from", "to", ...selects.map((s) => s.name)].some((k) => params.get(k));
  const cls = "h-8 rounded-lg border border-input bg-white px-2.5 text-sm";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 shadow-xs">
      <div className="flex items-center gap-1.5 text-sm">
        <input type="date" aria-label="From date" className={cls} value={params.get("from") ?? defaultFrom} onChange={(e) => set({ from: e.target.value })} />
        <span className="text-muted-foreground">to</span>
        <input type="date" aria-label="To date" className={cls} value={params.get("to") ?? defaultTo} onChange={(e) => set({ to: e.target.value })} />
      </div>
      {selects.map((s) => (
        <select key={s.name} aria-label={s.label} className={`${cls} max-w-48`} value={params.get(s.name) ?? ""} onChange={(e) => set({ [s.name]: e.target.value })}>
          <option value="">{s.label}</option>
          {s.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ))}
      {active && (
        <button type="button" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" onClick={() => start(() => router.replace(`${pathname}${params.get("tab") ? `?tab=${params.get("tab")}` : ""}`, { scroll: false }))}>
          <X className="size-3.5" /> Clear
        </button>
      )}
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
    </div>
  );
}
