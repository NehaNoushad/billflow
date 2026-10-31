// Report definitions shared by the /reports page and the CSV export, so both show identical data.
import { businessToday, daysBetween, formatDate, intervalLabel, monthLabel, type BillingInterval } from "@/lib/dates";
import { humanize } from "@/lib/constants";
import {
  annualRevenue, customerGrowth, discountUsage, monthlyRevenue, outstandingInvoices, revenueByPlan, revenueByProduct,
  subscriptionLists, subscriptionTrends, type Matches, type Period, type ReportFilters,
} from "./analytics";

export type ColumnType = "text" | "money" | "number" | "date" | "link";
export type Column = { key: string; label: string; type?: ColumnType };
export type Row = Record<string, string | number | null | undefined>;
export type ReportResult = { title: string; description: string; columns: Column[]; rows: Row[]; totals?: Row };

export const REPORTS = [
  { key: "monthly", label: "Monthly revenue" },
  { key: "annual", label: "Annual revenue" },
  { key: "mrr", label: "MRR & ARR" },
  { key: "active", label: "Active subscriptions" },
  { key: "new", label: "New subscriptions" },
  { key: "closed", label: "Closed subscriptions" },
  { key: "product", label: "Revenue by product" },
  { key: "plan", label: "Revenue by plan" },
  { key: "outstanding", label: "Outstanding payments" },
  { key: "overdue", label: "Overdue invoices" },
  { key: "discounts", label: "Discount usage" },
  { key: "customers", label: "Customer growth" },
] as const;
export type ReportKey = (typeof REPORTS)[number]["key"];

export function isReportKey(k: string | undefined): k is ReportKey {
  return REPORTS.some((r) => r.key === k);
}

const sumOf = (rows: Row[], key: string) => rows.reduce((t, r) => t + (Number(r[key]) || 0), 0);

export async function buildReport(key: ReportKey, m: Matches, period: Period, filters: ReportFilters): Promise<ReportResult> {
  switch (key) {
    case "monthly": {
      const data = await monthlyRevenue(m, period);
      const rows = data.map((d) => ({ month: monthLabel(d.month), invoiceCount: d.invoiceCount, invoiced: d.invoiced, net: d.net, tax: d.tax, collected: d.collected, paymentCount: d.paymentCount }));
      return {
        title: "Monthly revenue",
        description: "Invoiced = confirmed + paid invoices by invoice date. Collected = completed payments by payment date.",
        columns: [
          { key: "month", label: "Month" },
          { key: "invoiceCount", label: "Invoices", type: "number" },
          { key: "invoiced", label: "Invoiced (incl. tax)", type: "money" },
          { key: "net", label: "Net (excl. tax)", type: "money" },
          { key: "tax", label: "Tax", type: "money" },
          { key: "collected", label: "Collected", type: "money" },
          { key: "paymentCount", label: "Payments", type: "number" },
        ],
        rows,
        totals: { month: "Total", invoiceCount: sumOf(rows, "invoiceCount"), invoiced: sumOf(rows, "invoiced"), net: sumOf(rows, "net"), tax: sumOf(rows, "tax"), collected: sumOf(rows, "collected"), paymentCount: sumOf(rows, "paymentCount") },
      };
    }
    case "annual": {
      const rows = (await annualRevenue(m)).map((y) => ({ year: String(y.year), invoiceCount: y.invoiceCount, invoiced: y.invoiced, collected: y.collected, gap: y.invoiced - y.collected }));
      return {
        title: "Annual revenue",
        description: "All-time, by calendar year (date filters do not apply).",
        columns: [
          { key: "year", label: "Year" },
          { key: "invoiceCount", label: "Invoices", type: "number" },
          { key: "invoiced", label: "Invoiced", type: "money" },
          { key: "collected", label: "Collected", type: "money" },
          { key: "gap", label: "Invoiced − collected", type: "money" },
        ],
        rows,
        totals: { year: "Total", invoiceCount: sumOf(rows, "invoiceCount"), invoiced: sumOf(rows, "invoiced"), collected: sumOf(rows, "collected"), gap: sumOf(rows, "gap") },
      };
    }
    case "mrr": {
      const rows = (await subscriptionTrends(m, period)).map((t) => ({ month: monthLabel(t.month), active: t.active, added: t.added, closed: t.closed, mrr: t.mrr, arr: t.mrr * 12 }));
      return {
        title: "MRR & ARR",
        description: "Recurring revenue (net of discounts, excl. tax) from subscriptions active at each month end. ARR = MRR × 12.",
        columns: [
          { key: "month", label: "Month" },
          { key: "active", label: "Active subscriptions", type: "number" },
          { key: "added", label: "New", type: "number" },
          { key: "closed", label: "Closed", type: "number" },
          { key: "mrr", label: "MRR", type: "money" },
          { key: "arr", label: "ARR", type: "money" },
        ],
        rows,
      };
    }
    case "active":
    case "new":
    case "closed": {
      const lists = await subscriptionLists(m, period);
      const list = key === "active" ? lists.active : key === "new" ? lists.added : lists.closed;
      const rows = list.map((s) => ({
        number: s.number,
        href: `/subscriptions/${s._id}`,
        customer: s.customerSnapshot?.companyName || s.customerSnapshot?.name,
        plan: s.planSnapshot?.name,
        interval: intervalLabel(s.billingInterval as BillingInterval),
        status: humanize(s.status),
        start: formatDate(s.startDate),
        end: key === "closed" ? formatDate(s.closedAt) : formatDate(s.expiryDate),
        reason: s.closeReason ?? "",
        total: s.total,
        mrr: s.mrr,
      }));
      const columns: Column[] = [
        { key: "number", label: "Subscription", type: "link" },
        { key: "customer", label: "Customer" },
        { key: "plan", label: "Plan" },
        { key: "interval", label: "Interval" },
        { key: "status", label: "Status" },
        { key: "start", label: "Start" },
        { key: "end", label: key === "closed" ? "Closed" : "Expires" },
        ...(key === "closed" ? [{ key: "reason", label: "Reason" }] : []),
        { key: "total", label: "Per period (incl. tax)", type: "money" },
        { key: "mrr", label: "MRR", type: "money" },
      ];
      const titles = { active: "Active subscriptions", new: "New subscriptions", closed: "Closed subscriptions" };
      return {
        title: titles[key],
        description: key === "active" ? "Currently active and billing (date filters do not apply)." : key === "new" ? "Subscriptions that started in the selected period." : "Subscriptions closed in the selected period.",
        columns,
        rows,
        totals: { number: `${rows.length} subscriptions`, total: sumOf(rows, "total"), mrr: sumOf(rows, "mrr") },
      };
    }
    case "product": {
      const rows = (await revenueByProduct(m, period, filters.product)).map((p) => ({ name: p.name, quantity: p.quantity, invoices: p.invoices, amount: p.amount }));
      return {
        title: "Revenue by product",
        description: "Net revenue from invoice lines (after discounts, excl. tax) on confirmed and paid invoices.",
        columns: [
          { key: "name", label: "Product" },
          { key: "quantity", label: "Units billed", type: "number" },
          { key: "invoices", label: "Invoices", type: "number" },
          { key: "amount", label: "Net revenue", type: "money" },
        ],
        rows,
        totals: { name: "Total", quantity: sumOf(rows, "quantity"), amount: sumOf(rows, "amount") },
      };
    }
    case "plan": {
      const rows = (await revenueByPlan(m, period)).map((p) => ({ name: p.name, count: p.count, net: p.net, invoiced: p.invoiced }));
      return {
        title: "Revenue by plan",
        description: "Confirmed and paid invoices grouped by the subscription plan they bill.",
        columns: [
          { key: "name", label: "Plan" },
          { key: "count", label: "Invoices", type: "number" },
          { key: "net", label: "Net revenue (excl. tax)", type: "money" },
          { key: "invoiced", label: "Invoiced (incl. tax)", type: "money" },
        ],
        rows,
        totals: { name: "Total", count: sumOf(rows, "count"), net: sumOf(rows, "net"), invoiced: sumOf(rows, "invoiced") },
      };
    }
    case "outstanding":
    case "overdue": {
      const today = businessToday();
      const rows = (await outstandingInvoices(m, key === "overdue")).map((i) => {
        const late = daysBetween(i.dueDate, today);
        return {
          number: i.number,
          href: `/invoices/${i._id}`,
          customer: i.customerSnapshot?.companyName || i.customerSnapshot?.name,
          invoiceDate: formatDate(i.invoiceDate),
          dueDate: formatDate(i.dueDate),
          daysLate: late > 0 ? late : 0,
          total: i.total,
          amountPaid: i.amountPaid,
          amountDue: i.amountDue,
        };
      });
      return {
        title: key === "overdue" ? "Overdue invoices" : "Outstanding payments",
        description: key === "overdue" ? "Confirmed invoices with a balance past their due date (current state)." : "All confirmed invoices with an unpaid balance (current state).",
        columns: [
          { key: "number", label: "Invoice", type: "link" },
          { key: "customer", label: "Customer" },
          { key: "invoiceDate", label: "Invoice date" },
          { key: "dueDate", label: "Due date" },
          { key: "daysLate", label: "Days overdue", type: "number" },
          { key: "total", label: "Total", type: "money" },
          { key: "amountPaid", label: "Paid", type: "money" },
          { key: "amountDue", label: "Outstanding", type: "money" },
        ],
        rows,
        totals: { number: `${rows.length} invoices`, total: sumOf(rows, "total"), amountPaid: sumOf(rows, "amountPaid"), amountDue: sumOf(rows, "amountDue") },
      };
    }
    case "discounts": {
      const rows = (await discountUsage(m, period)).map((d) => ({ name: d.name, type: humanize(d.type), uses: d.uses, amount: d.amount }));
      return {
        title: "Discount usage",
        description: "Discounts applied on non-cancelled invoices in the period, from invoice discount snapshots.",
        columns: [
          { key: "name", label: "Discount" },
          { key: "type", label: "Type" },
          { key: "uses", label: "Invoices", type: "number" },
          { key: "amount", label: "Amount given", type: "money" },
        ],
        rows,
        totals: { name: "Total", uses: sumOf(rows, "uses"), amount: sumOf(rows, "amount") },
      };
    }
    case "customers": {
      const rows = (await customerGrowth(m, period)).map((c) => ({ month: monthLabel(c.month), added: c.added, total: c.total }));
      return {
        title: "Customer growth",
        description: "New customer accounts per month and cumulative total at month end.",
        columns: [
          { key: "month", label: "Month" },
          { key: "added", label: "New customers", type: "number" },
          { key: "total", label: "Total customers", type: "number" },
        ],
        rows,
        totals: { month: "Total", added: sumOf(rows, "added") },
      };
    }
  }
}

/** RFC 4180 CSV. Money columns are exported as rupees with 2 decimals (no currency symbol). */
export function toCsv(report: ReportResult): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Neutralise spreadsheet formula injection and quote when needed.
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const fmt = (c: Column, v: unknown) => {
    if (c.type === "money") {
      const n = Number(v) || 0;
      const neg = n < 0;
      const a = Math.abs(Math.trunc(n));
      return `${neg ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
    }
    return v;
  };
  const header = report.columns.map((c) => esc(c.type === "money" ? `${c.label} (INR)` : c.label)).join(",");
  const lines = report.rows.map((r) => report.columns.map((c) => esc(fmt(c, r[c.key]))).join(","));
  if (report.totals) lines.push(report.columns.map((c) => esc(report.totals![c.key] === undefined ? "" : fmt(c, report.totals![c.key]))).join(","));
  return "﻿" + [header, ...lines].join("\r\n") + "\r\n";
}
