// Billing dates are stored as UTC-midnight Date objects so period math is timezone-stable.
// Display uses the business timezone (Asia/Kolkata by default).

export const BUSINESS_TZ = process.env.NEXT_PUBLIC_BUSINESS_TZ || "Asia/Kolkata";

export type BillingInterval = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export const BILLING_INTERVALS: BillingInterval[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];

/** The calendar date "today" in the business timezone, as a UTC-midnight Date. */
export function businessToday(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new Date(`${parts}T00:00:00.000Z`);
}

/** Normalise any date to UTC midnight of the same UTC calendar day. */
export function utcDay(d: Date | string): Date {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Parse "YYYY-MM-DD" from a form into UTC midnight. */
export function parseDateInput(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid date: ${value}`);
  return new Date(`${value}T00:00:00.000Z`);
}

export function toDateInput(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

export function addDaysUTC(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

/** Add months, clamping to month end (31 Jan + 1 month = 28/29 Feb), anchored on the original day. */
export function addMonthsUTC(d: Date, months: number, anchorDay = d.getUTCDate()): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(anchorDay, lastDay)));
}

export function addInterval(d: Date, interval: BillingInterval, count = 1, anchorDay?: number): Date {
  switch (interval) {
    case "DAILY":
      return addDaysUTC(d, count);
    case "WEEKLY":
      return addDaysUTC(d, 7 * count);
    case "MONTHLY":
      return addMonthsUTC(d, count, anchorDay);
    case "YEARLY":
      return addMonthsUTC(d, 12 * count, anchorDay);
  }
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((utcDay(b).getTime() - utcDay(a).getTime()) / 86400000);
}

export function intervalLabel(interval: BillingInterval): string {
  return { DAILY: "Daily", WEEKLY: "Weekly", MONTHLY: "Monthly", YEARLY: "Yearly" }[interval];
}

export function perIntervalSuffix(interval: BillingInterval): string {
  return { DAILY: "/day", WEEKLY: "/week", MONTHLY: "/month", YEARLY: "/year" }[interval];
}

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: BUSINESS_TZ });

/** Format a billing date (UTC midnight) for display. */
export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return dateFmt.format(new Date(d));
}

/** Format a timestamp (createdAt etc.) in the business timezone. */
export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return dateTimeFmt.format(new Date(d));
}

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Resolve dashboard/report period presets into [from, to) UTC dates. */
export function resolvePeriod(preset: string | undefined, from?: string, to?: string): { from: Date; to: Date; label: string; preset: string } {
  const today = businessToday();
  const tomorrow = addDaysUTC(today, 1);
  if (preset === "custom" && from && to) {
    try {
      return { from: parseDateInput(from), to: addDaysUTC(parseDateInput(to), 1), label: `${from} → ${to}`, preset };
    } catch {
      /* fall through to default */
    }
  }
  switch (preset) {
    case "30d":
      return { from: addDaysUTC(today, -29), to: tomorrow, label: "Last 30 days", preset };
    case "90d":
      return { from: addDaysUTC(today, -89), to: tomorrow, label: "Last 90 days", preset };
    case "ytd":
      return { from: new Date(Date.UTC(today.getUTCFullYear(), 0, 1)), to: tomorrow, label: "Year to date", preset };
    case "all":
      return { from: new Date(Date.UTC(2000, 0, 1)), to: tomorrow, label: "All time", preset };
    default:
      return { from: addMonthsUTC(startOfMonthUTC(today), -11), to: tomorrow, label: "Last 12 months", preset: "12m" };
  }
}
