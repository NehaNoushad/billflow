import { BillingExecution, Invoice, Subscription, SubscriptionRequest } from "@/models";
import { addDaysUTC, businessToday, formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { scopeFilter, type CurrentUser } from "@/lib/auth/guard";
import type { Notification } from "@/components/app/app-shell";
import { overdueFilter } from "./invoices";

/** Live notification feed for the top bar, computed from the database on each page load. */
export async function getNotifications(user: CurrentUser): Promise<Notification[]> {
  const scope = await scopeFilter(user);
  const today = businessToday();
  const out: Notification[] = [];

  if (user.role === "CUSTOMER") {
    const [due, renewals] = await Promise.all([
      Invoice.find({ ...scope, status: "CONFIRMED", amountDue: { $gt: 0 } }).sort({ dueDate: 1 }).limit(5).lean(),
      Subscription.find({ ...scope, status: "ACTIVE", expiryDate: { $gte: today, $lte: addDaysUTC(today, 30) } }).limit(3).lean(),
    ]);
    for (const inv of due) {
      const overdue = new Date(inv.dueDate) < today;
      out.push({ id: `inv-${inv._id}`, title: `${inv.number} ${overdue ? "is overdue" : "is due"}`, description: `${formatMoney(inv.amountDue)} due ${formatDate(inv.dueDate)}`, href: `/portal/invoices/${inv._id}`, tone: overdue ? "critical" : "warning" });
    }
    for (const s of renewals) out.push({ id: `sub-${s._id}`, title: `${s.planSnapshot?.name} expires soon`, description: `Term ends ${formatDate(s.expiryDate)}`, href: `/portal/subscriptions`, tone: "info" });
    return out;
  }

  const [overdueAgg, pending, expiring, lastRun] = await Promise.all([
    Invoice.aggregate([{ $match: { ...scope, ...overdueFilter(today) } }, { $group: { _id: null, n: { $sum: 1 }, amt: { $sum: "$amountDue" } } }]),
    SubscriptionRequest.countDocuments({ ...scope, status: "PENDING" }),
    Subscription.countDocuments({ ...scope, status: "ACTIVE", expiryDate: { $gte: today, $lte: addDaysUTC(today, 7) } }),
    user.role === "ADMIN" ? BillingExecution.findOne().sort({ startedAt: -1 }).lean() : null,
  ]);
  if (overdueAgg[0]?.n) out.push({ id: "overdue", title: `${overdueAgg[0].n} overdue invoice(s)`, description: `${formatMoney(overdueAgg[0].amt)} outstanding past due date`, href: "/invoices?status=OVERDUE", tone: "critical" });
  if (pending) out.push({ id: "requests", title: `${pending} customer request(s)`, description: "Pause, cancel or plan change requests awaiting review", href: "/subscriptions?requests=pending", tone: "warning" });
  if (expiring) out.push({ id: "expiring", title: `${expiring} subscription(s) expiring in 7 days`, description: "Contact customers about renewal", href: "/subscriptions?expiring=7", tone: "warning" });
  if (lastRun && lastRun.failed > 0) out.push({ id: "billing", title: "Last billing run had failures", description: `${lastRun.failed} failed operation(s)`, href: `/billing/${lastRun._id}`, tone: "critical" });
  if (lastRun && lastRun.status !== "RUNNING" && lastRun.failed === 0) out.push({ id: "billing-ok", title: "Last billing run succeeded", description: `${lastRun.generated} invoice(s) · ${formatMoney(lastRun.totalValue)}`, href: `/billing/${lastRun._id}`, tone: "info" });
  return out;
}
