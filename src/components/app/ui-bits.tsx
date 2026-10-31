import Link from "next/link";
import { ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { humanize } from "@/lib/constants";

export function PageHeader({ title, description, actions, back }: { title: string; description?: string; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6">
      {back && (
        <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

const TONES: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  blue: "bg-blue-50 text-blue-700 ring-blue-600/20",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/25",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  gray: "bg-slate-100 text-slate-700 ring-slate-500/20",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/20",
};

const STATUS_TONE: Record<string, keyof typeof TONES> = {
  ACTIVE: "green", PAID: "green", ACCEPTED: "green", COMPLETED: "green", PUBLISHED: "green", APPROVED: "green",
  CONFIRMED: "blue", SENT: "blue", QUOTATION: "violet",
  DRAFT: "gray", INACTIVE: "gray", ARCHIVED: "gray", CLOSED: "gray", VOIDED: "gray",
  PAUSED: "amber", PENDING: "amber", OVERDUE: "red", EXPIRED: "amber", COMPLETED_WITH_ERRORS: "amber", RUNNING: "indigo",
  CANCELLED: "red", REJECTED: "red", FAILED: "red",
  CRITICAL: "red", WARNING: "amber", INFO: "indigo",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const tone = TONES[STATUS_TONE[status] ?? "gray"];
  return <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset", tone, className)}>{humanize(status)}</span>;
}

export function Tone({ tone, children, className }: { tone: keyof typeof TONES; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TONES[tone], className)}>{children}</span>;
}

export function Panel({ title, description, actions, children, className, bodyClassName }: { title?: React.ReactNode; description?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn("rounded-xl border bg-card shadow-xs", className)}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 border-b px-5 py-3.5">
          <div>
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function EmptyState({ title, description, action, icon: Icon = Inbox }: { title: string; description?: string; action?: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function KpiCard({ label, value, hint, icon: Icon, tone = "indigo", trend }: { label: string; value: string; hint?: string; icon?: React.ComponentType<{ className?: string }>; tone?: "indigo" | "green" | "amber" | "red" | "blue" | "gray"; trend?: { value: string; positive: boolean } | null }) {
  const iconTone = { indigo: "bg-indigo-50 text-indigo-600", green: "bg-emerald-50 text-emerald-600", amber: "bg-amber-50 text-amber-600", red: "bg-red-50 text-red-600", blue: "bg-blue-50 text-blue-600", gray: "bg-slate-100 text-slate-600" }[tone];
  return (
    <div className="rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {Icon && (
          <span className={cn("flex size-8 items-center justify-center rounded-lg", iconTone)}>
            <Icon className="size-4" />
          </span>
        )}
      </div>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      <div className="mt-1 flex items-center gap-2 text-xs">
        {trend && <span className={cn("font-medium", trend.positive ? "text-emerald-600" : "text-red-600")}>{trend.value}</span>}
        {hint && <span className="text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}

/** Server-rendered pagination that preserves current filters. */
export function Pagination({ page, total, pageSize, basePath, params }: { page: number; total: number; pageSize: number; basePath: string; params: Record<string, string | string[] | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (typeof v === "string" && v && k !== "page") q.set(k, v);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        <PageLink href={href(page - 1)} disabled={page <= 1} label="Previous">
          <ChevronLeft className="size-4" />
        </PageLink>
        <span className="px-2">
          Page {Math.min(page, pages)} of {pages}
        </span>
        <PageLink href={href(page + 1)} disabled={page >= pages} label="Next">
          <ChevronRight className="size-4" />
        </PageLink>
      </div>
    </div>
  );
}

function PageLink({ href, disabled, label, children }: { href: string; disabled: boolean; label: string; children: React.ReactNode }) {
  if (disabled) return <span className="flex size-8 items-center justify-center rounded-md border opacity-40">{children}</span>;
  return (
    <Link href={href} aria-label={label} className="flex size-8 items-center justify-center rounded-md border hover:bg-muted">
      {children}
    </Link>
  );
}

/** Two-column definition list for detail pages. */
export function DetailList({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label}>
          <dt className="text-xs text-muted-foreground">{i.label}</dt>
          <dd className="mt-0.5 text-sm font-medium">{i.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Plain table styles used across list pages (server-rendered). */
export const tableCls = {
  wrap: "overflow-x-auto",
  table: "w-full text-sm",
  thead: "border-b bg-muted/40 text-left text-xs font-medium text-muted-foreground",
  th: "px-4 py-2.5 font-medium whitespace-nowrap",
  tr: "border-b last:border-0 hover:bg-muted/30",
  td: "px-4 py-3 whitespace-nowrap",
  num: "px-4 py-3 text-right tabular-nums whitespace-nowrap",
};
