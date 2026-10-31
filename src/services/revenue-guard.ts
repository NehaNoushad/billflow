// AI Revenue Guard — deterministic financial checks. The AI layer (ai.ts) only explains these
// findings; it never produces numbers. Every finding cites the records that support it.
import { Discount, Invoice, Payment, Subscription } from "@/models";
import { addDaysUTC, addInterval, businessToday, daysBetween, formatDate, utcDay, type BillingInterval } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { overdueFilter } from "./invoices";
import { monthlyValue } from "./subscriptions";

export type Severity = "CRITICAL" | "WARNING" | "INFO";
export type FindingRecord = { type: string; id: string; label: string; href: string };
export type Finding = { code: string; severity: Severity; title: string; detail: string; amount?: number; records: FindingRecord[] };
export type GuardMetrics = {
  asOf: string;
  activeSubscriptions: number;
  mrr: number;
  outstanding: number;
  overdueCount: number;
  overdueAmount: number;
  expiringIn7Days: number;
  expiringIn30Days: number;
  missedBillingCount: number;
  missedBillingAmount: number;
  duplicateInvoiceCount: number;
  invoicedLast30Days: number;
  invoicedPrev90DayAvg: number;
  revenueChangePct: number | null;
  latePayerCount: number;
  leakageCount: number;
  findingCounts: Record<Severity, number>;
};

type Match = Record<string, unknown>;
const MAX_RECORDS = 12;
const subRef = (s: { _id: unknown; number: string; customerSnapshot?: { companyName?: string | null; name?: string | null } | null }): FindingRecord => ({
  type: "Subscription",
  id: String(s._id),
  label: `${s.number} · ${s.customerSnapshot?.companyName || s.customerSnapshot?.name || "Customer"}`,
  href: `/subscriptions/${s._id}`,
});
const invRef = (i: { _id: unknown; number: string; customerSnapshot?: { companyName?: string | null; name?: string | null } | null }, extra = ""): FindingRecord => ({
  type: "Invoice",
  id: String(i._id),
  label: `${i.number} · ${i.customerSnapshot?.companyName || i.customerSnapshot?.name || "Customer"}${extra}`,
  href: `/invoices/${i._id}`,
});
const plural = (n: number, word: string, pluralWord = `${word}s`) => `${n} ${n === 1 ? word : pluralWord}`;

/** Run every check for the given customer scope (from scopeFilter). */
export async function runRevenueChecks(scope: Match): Promise<{ findings: Finding[]; metrics: GuardMetrics }> {
  const today = businessToday();
  const findings: Finding[] = [];

  /* 1. Active subscriptions without expected invoices ------------------------------ */
  const activeSubs = await Subscription.find({ ...scope, status: "ACTIVE" })
    .select("number customer customerSnapshot planSnapshot billingInterval billingAnchorDay startDate expiryDate nextBillingDate lines subtotal discountTotal total lastBilledAt")
    .lean();
  const behind = activeSubs.filter((s) => s.nextBillingDate && utcDay(s.nextBillingDate) < today);
  const missed: { sub: (typeof activeSubs)[number]; periods: number; amount: number }[] = [];
  for (const s of behind) {
    const start = utcDay(s.nextBillingDate!);
    const exists = await Invoice.exists({ subscription: s._id, periodStart: start, status: { $ne: "CANCELLED" } });
    if (exists) continue;
    let periods = 0;
    for (let d = start; d < today && periods < 36; d = addInterval(d, s.billingInterval as BillingInterval, 1, s.billingAnchorDay ?? undefined)) {
      if (s.expiryDate && d >= utcDay(s.expiryDate)) break;
      periods++;
    }
    if (periods > 0) missed.push({ sub: s, periods, amount: periods * s.total });
  }
  const missedAmount = missed.reduce((t, m) => t + m.amount, 0);
  if (missed.length) {
    findings.push({
      code: "MISSING_INVOICES",
      severity: "CRITICAL",
      title: `${plural(missed.length, "active subscription")} missing expected invoices`,
      detail: `${missed.map((m) => `${m.sub.number} has ${plural(m.periods, "unbilled period")} since ${formatDate(m.sub.nextBillingDate)}`).slice(0, 4).join("; ")}. Estimated unbilled value ${formatMoney(missedAmount)} — run billing to generate them.`,
      amount: missedAmount,
      records: missed.slice(0, MAX_RECORDS).map((m) => subRef(m.sub)),
    });
  }

  /* 2. Duplicate invoices ---------------------------------------------------------- */
  const dupGroups = await Invoice.aggregate([
    { $match: { ...scope, status: { $ne: "CANCELLED" }, subscription: { $ne: null }, periodStart: { $ne: null } } },
    { $group: { _id: { s: "$subscription", p: "$periodStart" }, ids: { $push: "$_id" }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);
  const dupIds = new Set<string>(dupGroups.flatMap((g) => g.ids.map(String)));
  // Same customer, same total, within 3 days (catches manual double entry without a subscription).
  const recent = await Invoice.find({ ...scope, status: { $ne: "CANCELLED" }, invoiceDate: { $gte: addDaysUTC(today, -365) } })
    .select("number customer customerSnapshot total invoiceDate subscription periodStart")
    .sort({ customer: 1, invoiceDate: 1 })
    .lean();
  for (let i = 1; i < recent.length; i++) {
    const a = recent[i - 1];
    const b = recent[i];
    if (String(a.customer) === String(b.customer) && a.total === b.total && a.total > 0 && Math.abs(daysBetween(a.invoiceDate, b.invoiceDate)) <= 3) {
      dupIds.add(String(a._id));
      dupIds.add(String(b._id));
    }
  }
  const dupInvoices = recent.filter((r) => dupIds.has(String(r._id)));
  if (dupInvoices.length) {
    // The duplicate value at risk is every copy beyond the first in each cluster.
    const byCustomerTotal = new Map<string, number[]>();
    for (const d of dupInvoices) {
      const key = `${d.customer}|${d.total}`;
      byCustomerTotal.set(key, [...(byCustomerTotal.get(key) ?? []), d.total]);
    }
    const atRisk = [...byCustomerTotal.values()].reduce((t, list) => t + list.slice(1).reduce((a, b) => a + b, 0), 0);
    findings.push({
      code: "DUPLICATE_INVOICES",
      severity: "CRITICAL",
      title: `${plural(dupInvoices.length, "invoice")} look like duplicates`,
      detail: `Invoices billing the same subscription period, or the same customer for the same amount within 3 days. Up to ${formatMoney(atRisk)} may be double-billed — review and cancel the extra copy.`,
      amount: atRisk,
      records: dupInvoices.slice(0, MAX_RECORDS).map((d) => invRef(d, ` · ${formatMoney(d.total)} · ${formatDate(d.invoiceDate)}`)),
    });
  }

  /* 3. Overdue invoices ------------------------------------------------------------ */
  const overdue = await Invoice.find({ ...scope, ...overdueFilter(today) }).select("number customer customerSnapshot dueDate amountDue").sort({ dueDate: 1 }).lean();
  const overdueAmount = overdue.reduce((t, i) => t + i.amountDue, 0);
  if (overdue.length) {
    const severe = overdue.filter((i) => daysBetween(i.dueDate, today) > 30);
    findings.push({
      code: "OVERDUE_INVOICES",
      severity: severe.length ? "CRITICAL" : "WARNING",
      title: `${plural(overdue.length, "invoice")} overdue · ${formatMoney(overdueAmount)}`,
      detail: `${severe.length ? `${plural(severe.length, "invoice")} more than 30 days past due. ` : ""}Oldest is ${overdue[0].number}, due ${formatDate(overdue[0].dueDate)} (${daysBetween(overdue[0].dueDate, today)} days ago).`,
      amount: overdueAmount,
      records: overdue.slice(0, MAX_RECORDS).map((i) => invRef(i, ` · ${formatMoney(i.amountDue)} · ${daysBetween(i.dueDate, today)}d late`)),
    });
  }

  /* 4. Unusual revenue change (last 30 days vs average of previous three 30-day windows) */
  const windowSum = async (from: Date, to: Date) => {
    const [r] = await Invoice.aggregate([{ $match: { ...scope, status: { $in: ["CONFIRMED", "PAID"] }, invoiceDate: { $gte: from, $lt: to } } }, { $group: { _id: null, t: { $sum: "$total" } } }]);
    return r?.t ?? 0;
  };
  const end = addDaysUTC(today, 1);
  const last30 = await windowSum(addDaysUTC(end, -30), end);
  const prev = await Promise.all([1, 2, 3].map((k) => windowSum(addDaysUTC(end, -30 * (k + 1)), addDaysUTC(end, -30 * k))));
  const prevAvg = Math.round(prev.reduce((a, b) => a + b, 0) / 3);
  const changePct = prevAvg > 0 ? ((last30 - prevAvg) / prevAvg) * 100 : null;
  if (changePct !== null && Math.abs(changePct) > 30) {
    findings.push({
      code: "REVENUE_CHANGE",
      severity: changePct < 0 ? "WARNING" : "INFO",
      title: `Invoiced revenue ${changePct < 0 ? "dropped" : "rose"} ${Math.abs(changePct).toFixed(0)}% vs the 90-day average`,
      detail: `Last 30 days invoiced ${formatMoney(last30)} against an average of ${formatMoney(prevAvg)} per 30 days over the previous 90 days (${prev.map((p) => formatMoney(p)).join(", ")}).`,
      amount: last30 - prevAvg,
      records: [{ type: "Report", id: "monthly-revenue", label: "Monthly revenue report", href: "/reports?tab=monthly" }],
    });
  }

  /* 5. Expiring subscriptions ------------------------------------------------------ */
  const exp7 = activeSubs.filter((s) => s.expiryDate && utcDay(s.expiryDate) >= today && utcDay(s.expiryDate) <= addDaysUTC(today, 7));
  const exp30 = activeSubs.filter((s) => s.expiryDate && utcDay(s.expiryDate) > addDaysUTC(today, 7) && utcDay(s.expiryDate) <= addDaysUTC(today, 30));
  if (exp7.length) {
    const mrrAtRisk = exp7.reduce((t, s) => t + monthlyValue(s), 0);
    findings.push({
      code: "EXPIRING_7D",
      severity: "WARNING",
      title: `${plural(exp7.length, "subscription")} ${exp7.length === 1 ? "expires" : "expire"} within 7 days`,
      detail: `${formatMoney(mrrAtRisk)} of MRR ends unless renewed: ${exp7.map((s) => `${s.number} on ${formatDate(s.expiryDate)}`).join(", ")}.`,
      amount: mrrAtRisk,
      records: exp7.map(subRef),
    });
  }
  if (exp30.length) {
    findings.push({
      code: "EXPIRING_30D",
      severity: "INFO",
      title: `${plural(exp30.length, "subscription")} ${exp30.length === 1 ? "expires" : "expire"} in 8–30 days`,
      detail: `Plan renewal conversations now: ${exp30.map((s) => `${s.number} on ${formatDate(s.expiryDate)}`).join(", ")}.`,
      amount: exp30.reduce((t, s) => t + monthlyValue(s), 0),
      records: exp30.map(subRef),
    });
  }

  /* 6. Discounts approaching expiry or usage limit --------------------------------- */
  const discounts = await Discount.find({ active: true }).lean();
  const discountIssues = discounts
    .map((d) => {
      const reasons: string[] = [];
      if (d.endDate && utcDay(d.endDate) >= today && utcDay(d.endDate) <= addDaysUTC(today, 7)) reasons.push(`expires ${formatDate(d.endDate)}`);
      if (d.usageLimit && d.usageLimit > 0 && (d.usageCount ?? 0) / d.usageLimit >= 0.8) reasons.push(`${d.usageCount}/${d.usageLimit} uses consumed`);
      return reasons.length ? { d, reasons } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  if (discountIssues.length) {
    findings.push({
      code: "DISCOUNT_LIMITS",
      severity: "WARNING",
      title: `${plural(discountIssues.length, "discount rule")} near expiry or usage limit`,
      detail: discountIssues.map((x) => `${x.d.name}: ${x.reasons.join(", ")}`).join("; ") + ". Invoices will stop receiving these discounts automatically — confirm that is intended.",
      records: discountIssues.map((x) => ({ type: "Discount", id: String(x.d._id), label: `${x.d.name} · ${x.reasons.join(", ")}`, href: "/discounts" })),
    });
  }

  /* 7. Revenue leakage ------------------------------------------------------------- */
  const pricedSubs = await Subscription.find({ ...scope, status: { $in: ["ACTIVE", "PAUSED", "CONFIRMED"] } }).select("number customerSnapshot status lines subtotal discountTotal total").lean();
  type Line = { productName: string; quantity: number; unitPrice: number; costPrice?: number | null };
  const belowCost = pricedSubs
    .map((s) => {
      const lines = (s.lines as Line[]).filter((l) => (l.costPrice ?? 0) > 0 && l.unitPrice < (l.costPrice ?? 0));
      const loss = lines.reduce((t, l) => t + ((l.costPrice ?? 0) - l.unitPrice) * l.quantity, 0);
      return lines.length ? { s, lines, loss } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  if (belowCost.length) {
    const loss = belowCost.reduce((t, x) => t + x.loss, 0);
    findings.push({
      code: "BELOW_COST",
      severity: "WARNING",
      title: `${plural(belowCost.length, "subscription")} priced below product cost`,
      detail: `${belowCost.map((x) => `${x.s.number}: ${x.lines.map((l) => `${l.productName} at ${formatMoney(l.unitPrice)} vs cost ${formatMoney(l.costPrice ?? 0)}`).join(", ")}`).join("; ")}. Loss of ${formatMoney(loss)} every billing period.`,
      amount: loss,
      records: belowCost.map((x) => subRef(x.s)),
    });
  }
  const zeroTotal = pricedSubs.filter((s) => s.total === 0);
  if (zeroTotal.length) {
    findings.push({ code: "ZERO_TOTAL", severity: "WARNING", title: `${plural(zeroTotal.length, "subscription")} bill ₹0 per period`, detail: "These subscriptions generate no revenue. Confirm they are intentional (e.g. free pilots) or correct their pricing.", records: zeroTotal.map(subRef) });
  }
  const heavyDiscount = pricedSubs.filter((s) => s.subtotal > 0 && s.discountTotal * 2 > s.subtotal);
  const heavyInvoices = await Invoice.find({ ...scope, status: { $ne: "CANCELLED" }, invoiceDate: { $gte: addDaysUTC(today, -90) }, $expr: { $gt: [{ $multiply: ["$discountTotal", 2] }, "$subtotal"] } })
    .select("number customerSnapshot discountTotal subtotal")
    .limit(MAX_RECORDS)
    .lean();
  if (heavyDiscount.length || heavyInvoices.length) {
    findings.push({
      code: "HEAVY_DISCOUNT",
      severity: "WARNING",
      title: "Discounts above 50% of the subtotal",
      detail: `${plural(heavyDiscount.length, "subscription")} and ${plural(heavyInvoices.length, "recent invoice")} have discounts larger than half their value.`,
      records: [...heavyDiscount.map(subRef), ...heavyInvoices.map((i) => invRef(i, ` · −${formatMoney(i.discountTotal)} of ${formatMoney(i.subtotal)}`))].slice(0, MAX_RECORDS),
    });
  }

  /* 8. Customers with repeated late payments --------------------------------------- */
  const latePaid = await Payment.aggregate([
    { $match: { ...scope, status: "COMPLETED" } },
    { $group: { _id: "$invoice", lastPayment: { $max: "$paymentDate" }, customer: { $first: "$customer" } } },
    { $lookup: { from: "invoices", localField: "_id", foreignField: "_id", as: "inv", pipeline: [{ $project: { dueDate: 1, status: 1, customerSnapshot: 1 } }] } },
    { $unwind: "$inv" },
    { $match: { "inv.status": "PAID", $expr: { $gt: ["$lastPayment", "$inv.dueDate"] } } },
    { $group: { _id: "$customer", late: { $sum: 1 }, name: { $first: { $ifNull: ["$inv.customerSnapshot.companyName", "$inv.customerSnapshot.name"] } } } },
  ]);
  const lateMap = new Map<string, { name: string; paidLate: number; overdue: number; overdueAmount: number }>();
  for (const r of latePaid) lateMap.set(String(r._id), { name: r.name, paidLate: r.late, overdue: 0, overdueAmount: 0 });
  for (const i of overdue) {
    const key = String(i.customer);
    const cur = lateMap.get(key) ?? { name: i.customerSnapshot?.companyName || i.customerSnapshot?.name || "Customer", paidLate: 0, overdue: 0, overdueAmount: 0 };
    cur.overdue += 1;
    cur.overdueAmount += i.amountDue;
    lateMap.set(key, cur);
  }
  const latePayers = [...lateMap.entries()].filter(([, v]) => v.paidLate + v.overdue >= 2).sort((a, b) => b[1].paidLate + b[1].overdue - (a[1].paidLate + a[1].overdue));
  if (latePayers.length) {
    findings.push({
      code: "LATE_PAYERS",
      severity: "WARNING",
      title: `${plural(latePayers.length, "customer")} with repeated late payments`,
      detail: latePayers.map(([, v]) => `${v.name}: ${v.paidLate} paid late, ${v.overdue} overdue${v.overdueAmount ? ` (${formatMoney(v.overdueAmount)})` : ""}`).join("; ") + ". Consider shorter payment terms or proactive reminders.",
      amount: latePayers.reduce((t, [, v]) => t + v.overdueAmount, 0),
      records: latePayers.slice(0, MAX_RECORDS).map(([id, v]) => ({ type: "Customer", id, label: `${v.name} · ${v.paidLate + v.overdue} late`, href: `/customers/${id}` })),
    });
  }

  const order: Record<Severity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const outstandingAgg = await Invoice.aggregate([{ $match: { ...scope, status: "CONFIRMED" } }, { $group: { _id: null, t: { $sum: "$amountDue" } } }]);

  const metrics: GuardMetrics = {
    asOf: today.toISOString().slice(0, 10),
    activeSubscriptions: activeSubs.length,
    mrr: activeSubs.reduce((t, s) => t + monthlyValue(s), 0),
    outstanding: outstandingAgg[0]?.t ?? 0,
    overdueCount: overdue.length,
    overdueAmount,
    expiringIn7Days: exp7.length,
    expiringIn30Days: exp7.length + exp30.length,
    missedBillingCount: missed.length,
    missedBillingAmount: missedAmount,
    duplicateInvoiceCount: dupInvoices.length,
    invoicedLast30Days: last30,
    invoicedPrev90DayAvg: prevAvg,
    revenueChangePct: changePct === null ? null : Math.round(changePct * 10) / 10,
    latePayerCount: latePayers.length,
    leakageCount: belowCost.length + zeroTotal.length + heavyDiscount.length + heavyInvoices.length,
    findingCounts: {
      CRITICAL: findings.filter((f) => f.severity === "CRITICAL").length,
      WARNING: findings.filter((f) => f.severity === "WARNING").length,
      INFO: findings.filter((f) => f.severity === "INFO").length,
    },
  };
  return { findings, metrics };
}
