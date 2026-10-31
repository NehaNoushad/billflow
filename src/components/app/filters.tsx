"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type FilterDef = { name: string; label: string; options: { value: string; label: string }[] };

/**
 * URL-driven search + filter bar. All filtering happens on the server: this only updates searchParams.
 */
export function FilterBar({ searchPlaceholder = "Search…", filters = [], dateRange = false, className }: { searchPlaceholder?: string; filters?: FilterDef[]; dateRange?: boolean; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  // Debounce typing in the search box.
  useEffect(() => {
    if ((params.get("q") ?? "") === q) return;
    const t = setTimeout(() => update({ q }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const active = ["q", "from", "to", ...filters.map((f) => f.name)].some((k) => params.get(k));

  return (
    <div className={cn("flex flex-col gap-2 border-b p-3 sm:flex-row sm:flex-wrap sm:items-center", className)}>
      <div className="relative sm:w-72">
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} className="pl-8" aria-label="Search" />
      </div>
      {filters.map((f) => (
        <select
          key={f.name}
          aria-label={f.label}
          value={params.get(f.name) ?? ""}
          onChange={(e) => update({ [f.name]: e.target.value })}
          className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
        >
          <option value="">All {f.label.toLowerCase()}</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ))}
      {dateRange && (
        <div className="flex items-center gap-1.5 text-sm">
          <input type="date" aria-label="From date" value={params.get("from") ?? ""} onChange={(e) => update({ from: e.target.value })} className="h-8 rounded-lg border border-input bg-background px-2 text-sm" />
          <span className="text-muted-foreground">to</span>
          <input type="date" aria-label="To date" value={params.get("to") ?? ""} onChange={(e) => update({ to: e.target.value })} className="h-8 rounded-lg border border-input bg-background px-2 text-sm" />
        </div>
      )}
      {active && (
        <button
          onClick={() => {
            setQ("");
            startTransition(() => router.replace(pathname, { scroll: false }));
          }}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" /> Clear
        </button>
      )}
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
    </div>
  );
}
