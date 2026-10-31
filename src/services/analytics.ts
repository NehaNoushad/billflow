// Financial analytics. Every number is computed from MongoDB at request time and scoped to the viewer.
// Definitions used everywhere:
//   Invoiced    = Σ invoice.total for CONFIRMED + PAID invoices, by invoiceDate
//   Collected   = Σ payment.amount for COMPLETED payments, by paymentDate
//   Outstanding = Σ invoice.amountDue for CONFIRMED invoices (current balance, any date)
import { Types } from "mongoose";
import { ActivityLog, Customer, Invoice, InvoiceLine, Payment, Subscription } from "@/models";
import { addDaysUTC, addMonthsUTC, businessToday, monthKey, startOfMonthUTC } from "@/lib/dates";
import { overdueFilter } from "./invoices";
import { monthlyValue } from "./subscriptions";

type Match = Record<string, unknown>;
export type Period = { from: Date; to: Date };
export type ReportFilters = { customer?: string; product?: string; plan?: string; subscriptionStatus?: string; invoiceStatus?: string };
export type Matches = { inv: Match; pay: Match; sub: Match; cust: Match; activity: Match };

const REVENUE_STATUSES = ["CONFIRMED", "PAID"];
const oid = (id: string) => new Types.ObjectId(id);
const isId = (id?: string): id is string => !!id && Types.ObjectId.isValid(id);

/**
 * Translate the viewer's scope (from scopeFilter) plus optional report filters into
 * match stages for each collection.
 */
export async function buildMatches(scope: Match, filters: ReportFilters = {}): Promise<Matches> {
  const scoped = scope.customer as { $in: Types.ObjectId[] } | undefined;
  let customerMatch: unknown = scoped;
  if (isId(filters.customer)) {
    customerMatch = scoped ? { $in: scoped.$in.filter((id) => String(id) === filters.customer) } : oid(filters.customer);
  }
  const base: Match = customerMatch ? { customer: customerMatch } : {};
  const inv: Match = { ...base };
  const sub: Match = { ...base };

  if (isId(filters.plan)) {
    sub.plan = oid(filters.plan);
    inv.subscription = { $in: await Subscription.distinct("_id", { ...base, plan: oid(filters.plan) }) };
  }
  if (isId(filters.product)) {
    sub["lines.product"] = oid(filters.product);
    inv._id = { $in: await InvoiceLine.distinct("invoice", { product: oid(filters.product) }) };
  }
  if (filters.subscriptionStatus) sub.status = filters.subscriptionStatus;
  if (filters.invoiceStatus === "OVERDUE") Object.assign(inv, overdueFilter());
  else if (filters.invoiceStatus) inv.status = filters.invoiceStatus;

  const narrowsInvoices = isId(filters.plan) || isId(filters.product) || !!filters.invoiceStatus;
  const pay: Match = narrowsInvoices ? { invoice: { $in: await Invoice.distinct("_id", inv) } } : { ...base };
  const cust: Match = customerMatch ? { _id: customerMatch } : {};
  const activity: Match = scoped ? { customer: customerMatch } : customerMatch ? { customer: customerMatch } : {};
  return { inv, pay, sub, cust, activity };
}

/** Month keys (YYYY-MM) covering a period, capped to the most recent `max` months. */
export function monthsInPeriod(period: Period, max = 36): string[] {
  const keys: string[] = [];
  const last = startOfMonthUTC(addDaysUTC(period.to, -1));
  let d = startOfMonthUTC(period.from);
  while (d <= last) {
    keys.push(monthKey(d));
    d = addMonthsUTC(d, 1);
  }
  return keys.slice(-max);
}

/** For "all time", start the period at the first financial record instead of year 2000. */
export async function clampPeriod(period: Period, m: Matches): Promise<Period> {
  if (period.from.getUTCFullYear() > 2001) return period;
  const first = await Invoice.findOne(m.inv).sort({ invoiceDate: 1 }).select("invoiceDate").lean();
  return { from: first ? startOfMonthUTC(first.invoiceDate) : startOfMonthUTC(businessToday()), to: period.to };
}

async function sum(model: typeof Invoice | typeof Payment, match: Match, field: string): Promise<{ amount: number; count: number }> {
  const [r] = await (model as typeof Invoice).aggregate([{ $match: match }, { $group: { _id: null, amount: { $sum: `$${field}` }, count: { $sum: 1 } } }]);
  return { amount: r?.amount ?? 0, count: r?.count ?? 0 };
}

export async function getKpis(m: Matches, period: Period) {
  const length = period.to.getTime() - period.from.getTime();
  const prev = { from: new Date(period.from.getTime() - length), to: period.from };
  const [collected, prevCollected, invoiced, outstanding, overdue, activeSubs, customers] = await Promise.all([
    sum(Payment, { ...m.pay, status: "COMPLETED", paymentDate: { $gte: period.from, $lt: period.to } }, "amount"),
    sum(Payment, { ...m.pay, status: "COMPLETED", paymentDate: { $gte: prev.from, $lt: prev.to } }, "amount"),
    sum(Invoice, { ...m.inv, status: { $in: REVENUE_STATUSES }, invoiceDate: { $gte: period.from, $lt: period.to } }, "total"),
    sum(Invoice, { ...m.inv, status: "CONFIRMED", amountDue: { $gt: 0 } }, "amountDue"),
    sum(Invoice, { ...m.inv, ...overdueFilter() }, "amountDue"),
    Subscription.find({ ...m.sub, status: "ACTIVE" }).select("subtotal discountTotal billingInterval").lean(),
    Customer.countDocuments({ ...m.cust, status: "ACTIVE" }),
  ]);
  const mrr = activeSubs.reduce((s, sub) => s + monthlyValue(sub), 0);
  const growth = prevCollected.amount > 0 ? ((collected.amount - prevCollected.amount) / prevCollected.amount) * 100 : null;
  return {
    collected: collected.amount,
    paymentsCount: collected.count,
    previousCollected: prevCollected.amount,
    invoiced: invoiced.amount,
    invoicesCount: invoiced.count,
    outstanding: outstanding.amount,
    outstandingCount: outstanding.count,
    overdue: overdue.amount,
    overdueCount: overdue.count,
    mrr,
    arr: mrr * 12,
    activeSubscriptions: activeSubs.length,
    customers,
    growth,
  };
}

const monthExpr = (field: string) => ({ $dateToString: { format: "%Y-%m", date: `$${field}`, timezone: "UTC" } });

/** Invoiced vs collected per month. */
export async function monthlyRevenue(m: Matches, period: Period) {
  const months = monthsInPeriod(period);
  const [inv, pay] = await Promise.all([
    Invoice.aggregate([
      { $match: { ...m.inv, status: { $in: REVENUE_STATUSES }, invoiceDate: { $gte: period.from, $lt: period.to } } },
      { $group: { _id: monthExpr("invoiceDate"), invoiced: { $sum: "$total" }, net: { $sum: { $subtract: ["$subtotal", "$discountTotal"] } }, tax: { $sum: "$taxTotal" }, count: { $sum: 1 } } },
    ]),
    Payment.aggregate([
      { $match: { ...m.pay, status: "COMPLETED", paymentDate: { $gte: period.from, $lt: period.to } } },
      { $group: { _id: monthExpr("paymentDate"), collected: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
  ]);
  return months.map((month) => {
    const i = inv.find((x) => x._id === month);
    const p = pay.find((x) => x._id === month);
    return { month, invoiced: i?.invoiced ?? 0, net: i?.net ?? 0, tax: i?.tax ?? 0, invoiceCount: i?.count ?? 0, collected: p?.collected ?? 0, paymentCount: p?.count ?? 0 };
  });
}

/** Invoiced vs collected per calendar year (all time). */
export async function annualRevenue(m: Matches) {
  const yearExpr = (f: string) => ({ $year: `$${f}` });
  const [inv, pay] = await Promise.all([
    Invoice.aggregate([{ $match: { ...m.inv, status: { $in: REVENUE_STATUSES } } }, { $group: { _id: yearExpr("invoiceDate"), invoiced: { $sum: "$total" }, count: { $sum: 1 } } }]),
    Payment.aggregate([{ $match: { ...m.pay, status: "COMPLETED" } }, { $group: { _id: yearExpr("paymentDate"), collected: { $sum: "$amount" } } }]),
  ]);
  const years = [...new Set([...inv.map((x) => x._id), ...pay.map((x) => x._id)])].sort();
  return years.map((year: number) => ({
    year,
    invoiced: inv.find((x) => x._id === year)?.invoiced ?? 0,
    invoiceCount: inv.find((x) => x._id === year)?.count ?? 0,
    collected: pay.find((x) => x._id === year)?.collected ?? 0,
  }));
}

type SubLite = { status: string; startDate: Date; activatedAt?: Date | null; closedAt?: Date | null; pausedAt?: Date | null; subtotal: number; discountTotal: number; billingInterval: string };

/** Month-end snapshots of active subscriptions, MRR, plus new/closed counts per month. */
export async function subscriptionTrends(m: Matches, period: Period) {
  const months = monthsInPeriod(period);
  const subs = (await Subscription.find({ ...m.sub, $or: [{ activatedAt: { $ne: null } }, { status: { $in: ["ACTIVE", "PAUSED", "CLOSED"] } }] })
    .select("status startDate activatedAt closedAt pausedAt subtotal discountTotal billingInterval")
    .lean()) as unknown as SubLite[];
  const today = businessToday();
  return months.map((month) => {
    const [y, mo] = month.split("-").map(Number);
    const monthStart = new Date(Date.UTC(y, mo - 1, 1));
    const nextMonth = new Date(Date.UTC(y, mo, 1));
    const cutoff = nextMonth > today ? addDaysUTC(today, 1) : nextMonth; // current month: as of today
    let active = 0;
    let mrr = 0;
    let added = 0;
    let closed = 0;
    for (const s of subs) {
      const began = new Date(s.activatedAt && s.activatedAt < s.startDate ? s.activatedAt : s.startDate);
      const ended = s.closedAt ? new Date(s.closedAt) : null;
      if (began >= monthStart && began < nextMonth) added++;
      if (ended && ended >= monthStart && ended < nextMonth) closed++;
      // Paused subscriptions are not billed, so they don't count towards MRR (matches the MRR KPI).
      const pausedNow = s.status === "PAUSED" && s.pausedAt && new Date(s.pausedAt) < cutoff;
      if (began < cutoff && (!ended || ended >= cutoff) && !pausedNow) {
        active++;
        mrr += monthlyValue(s as Parameters<typeof monthlyValue>[0]);
      }
    }
    return { month, active, mrr, added, closed };
  });
}

/** Invoice counts and amounts by payment state for invoices dated in the period. */
export async function statusDistribution(m: Matches, period: Period) {
  const today = businessToday();
  const rows = await Invoice.aggregate([
    { $match: { ...m.inv, invoiceDate: { $gte: period.from, $lt: period.to } } },
    {
      $group: {
        _id: {
          $switch: {
            branches: [
              { case: { $eq: ["$status", "PAID"] }, then: "Paid" },
              { case: { $eq: ["$status", "CANCELLED"] }, then: "Cancelled" },
              { case: { $eq: ["$status", "DRAFT"] }, then: "Draft" },
              { case: { $and: [{ $eq: ["$status", "CONFIRMED"] }, { $lt: ["$dueDate", today] }, { $gt: ["$amountDue", 0] }] }, then: "Overdue" },
            ],
            default: "Outstanding (not due)",
          },
        },
        count: { $sum: 1 },
        amount: { $sum: { $cond: [{ $eq: ["$status", "PAID"] }, "$total", { $cond: [{ $eq: ["$status", "CONFIRMED"] }, "$amountDue", "$total"] }] } },
      },
    },
  ]);
  const order = ["Paid", "Outstanding (not due)", "Overdue", "Draft", "Cancelled"];
  return order.map((name) => ({ name, count: rows.find((r) => r._id === name)?.count ?? 0, amount: rows.find((r) => r._id === name)?.amount ?? 0 }));
}

/** Net revenue (excl. tax, after discounts) per product from invoice lines of revenue invoices. */
export async function revenueByProduct(m: Matches, period: Period, product?: string) {
  const rows = await Invoice.aggregate([
    { $match: { ...m.inv, status: { $in: REVENUE_STATUSES }, invoiceDate: { $gte: period.from, $lt: period.to } } },
    { $lookup: { from: "invoicelines", localField: "_id", foreignField: "invoice", as: "line" } },
    { $unwind: "$line" },
    ...(isId(product) ? [{ $match: { "line.product": oid(product) } }] : []),
    {
      $group: {
        _id: { $cond: [{ $ifNull: ["$line.product", false] }, "$line.productName", "Plan fees"] },
        amount: { $sum: { $subtract: ["$line.subtotal", "$line.discountAmount"] } },
        quantity: { $sum: "$line.quantity" },
        invoices: { $addToSet: "$_id" },
      },
    },
    { $project: { _id: 0, name: "$_id", amount: 1, quantity: 1, invoices: { $size: "$invoices" } } },
    { $sort: { amount: -1 } },
  ]);
  return rows as { name: string; amount: number; quantity: number; invoices: number }[];
}

/** Net revenue per subscription plan (manual invoices without a subscription grouped separately). */
export async function revenueByPlan(m: Matches, period: Period) {
  const rows = await Invoice.aggregate([
    { $match: { ...m.inv, status: { $in: REVENUE_STATUSES }, invoiceDate: { $gte: period.from, $lt: period.to } } },
    { $lookup: { from: "subscriptions", localField: "subscription", foreignField: "_id", as: "sub", pipeline: [{ $project: { "planSnapshot.name": 1 } }] } },
    { $group: { _id: { $ifNull: [{ $first: "$sub.planSnapshot.name" }, "No plan (manual invoices)"] }, net: { $sum: { $subtract: ["$subtotal", "$discountTotal"] } }, invoiced: { $sum: "$total" }, count: { $sum: 1 } } },
    { $project: { _id: 0, name: "$_id", net: 1, invoiced: 1, count: 1 } },
    { $sort: { net: -1 } },
  ]);
  return rows as { name: string; net: number; invoiced: number; count: number }[];
}

/** How much each discount rule gave away, from invoice discount snapshots. */
export async function discountUsage(m: Matches, period: Period) {
  const rows = await Invoice.aggregate([
    { $match: { ...m.inv, status: { $ne: "CANCELLED" }, invoiceDate: { $gte: period.from, $lt: period.to } } },
    { $unwind: "$discounts" },
    { $group: { _id: "$discounts.name", type: { $first: "$discounts.type" }, uses: { $sum: 1 }, amount: { $sum: "$discounts.amount" } } },
    { $project: { _id: 0, name: "$_id", type: 1, uses: 1, amount: 1 } },
    { $sort: { amount: -1 } },
  ]);
  return rows as { name: string; type: string; uses: number; amount: number }[];
}

/** New customers per month and cumulative total at each month end. */
export async function customerGrowth(m: Matches, period: Period) {
  const months = monthsInPeriod(period);
  const [rows, before] = await Promise.all([
    Customer.aggregate([{ $match: { ...m.cust, createdAt: { $gte: startOfMonthUTC(period.from), $lt: period.to } } }, { $group: { _id: monthExpr("createdAt"), count: { $sum: 1 } } }]),
    Customer.countDocuments({ ...m.cust, createdAt: { $lt: monthsInPeriod(period).length ? new Date(`${months[0]}-01T00:00:00.000Z`) : period.from } }),
  ]);
  let total = before;
  return months.map((month) => {
    const added = rows.find((r) => r._id === month)?.count ?? 0;
    total += added;
    return { month, added, total };
  });
}

export async function subscriptionLists(m: Matches, period: Period) {
  const fields = "number customerSnapshot planSnapshot billingInterval status startDate expiryDate nextBillingDate closedAt closeReason subtotal discountTotal total";
  const [active, added, closed] = await Promise.all([
    Subscription.find({ ...m.sub, status: "ACTIVE" }).select(fields).sort({ startDate: -1 }).limit(500).lean(),
    Subscription.find({ ...m.sub, status: { $in: ["ACTIVE", "PAUSED", "CLOSED"] }, startDate: { $gte: period.from, $lt: period.to } }).select(fields).sort({ startDate: -1 }).limit(500).lean(),
    Subscription.find({ ...m.sub, status: "CLOSED", closedAt: { $gte: period.from, $lt: period.to } }).select(fields).sort({ closedAt: -1 }).limit(500).lean(),
  ]);
  const withMrr = <T extends { subtotal: number; discountTotal: number; billingInterval: string }>(list: T[]) => list.map((s) => ({ ...s, mrr: monthlyValue(s as Parameters<typeof monthlyValue>[0]) }));
  return { active: withMrr(active), added: withMrr(added), closed: withMrr(closed) };
}

export async function outstandingInvoices(m: Matches, overdueOnly = false) {
  const match = overdueOnly ? { ...m.inv, ...overdueFilter() } : { ...m.inv, status: "CONFIRMED", amountDue: { $gt: 0 } };
  return Invoice.find(match).select("number customer customerSnapshot invoiceDate dueDate total amountPaid amountDue status").sort({ dueDate: 1 }).limit(500).lean();
}

export async function upcomingRenewals(m: Matches) {
  const today = businessToday();
  const [expiring, billing] = await Promise.all([
    Subscription.find({ ...m.sub, status: "ACTIVE", expiryDate: { $gte: today, $lte: addDaysUTC(today, 30) } })
      .select("number customerSnapshot planSnapshot expiryDate total billingInterval")
      .sort({ expiryDate: 1 })
      .limit(8)
      .lean(),
    Subscription.find({ ...m.sub, status: "ACTIVE", nextBillingDate: { $gte: today, $lte: addDaysUTC(today, 7) } })
      .select("number customerSnapshot planSnapshot nextBillingDate total billingInterval")
      .sort({ nextBillingDate: 1 })
      .limit(8)
      .lean(),
  ]);
  return { expiring, billing };
}

export async function recentInvoices(m: Matches, limit = 8) {
  return Invoice.find(m.inv).select("number customerSnapshot invoiceDate dueDate total amountDue status").sort({ invoiceDate: -1, createdAt: -1 }).limit(limit).lean();
}

export async function recentActivity(m: Matches, limit = 10) {
  return ActivityLog.find(m.activity).sort({ createdAt: -1 }).limit(limit).lean();
}
