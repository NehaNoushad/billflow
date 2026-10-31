"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const PRESETS = [
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "12m", label: "12 months" },
  { value: "ytd", label: "Year to date" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom" },
];

/** Reporting period control: presets plus a custom from/to range, stored in the URL. */
export function PeriodSelect({ current }: { current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const go = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-lg border bg-white p-0.5" role="group" aria-label="Reporting period">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => go({ period: p.value, ...(p.value !== "custom" ? { from: null, to: null } : {}) })}
            className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors", current === p.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
          >
            {p.label}
          </button>
        ))}
      </div>
      {current === "custom" && (
        <div className="flex items-center gap-1.5 text-sm">
          <input type="date" aria-label="From date" defaultValue={params.get("from") ?? ""} onChange={(e) => e.target.value && go({ from: e.target.value })} className="h-8 rounded-lg border bg-white px-2 text-sm" />
          <span className="text-muted-foreground">to</span>
          <input type="date" aria-label="To date" defaultValue={params.get("to") ?? ""} onChange={(e) => e.target.value && go({ to: e.target.value })} className="h-8 rounded-lg border bg-white px-2 text-sm" />
        </div>
      )}
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
    </div>
  );
}
