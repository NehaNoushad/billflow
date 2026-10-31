import Link from "next/link";
import { Types } from "mongoose";
import { CalendarClock, CreditCard, Receipt, Repeat, Wallet } from "lucide-react";
import { requirePage } from "@/lib/auth/guard";
import { connectDB } from "@/lib/db";
import { businessToday, formatDate, intervalLabel, perIntervalSuffix, type BillingInterval } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Customer, Invoice, Payment, Subscription } from "@/models";
import { ActionButton } from "@/components/app/action-button";
import { EmptyState, KpiCard, PageHeader, Panel, StatusBadge, tableCls } from "@/components/app/ui-bits";
import { paySimulatedAction } from "@/actions/portal";

export const metadata = { title: "My account" };

export default async function PortalOverview() {
  const user = await requirePage("portal.access");
  await connectDB();
  const customer = user.customerId;
  const today = businessToday();
  const [profile, subs, outstanding, spent] = await Promise.all([
    Customer.findById(customer).select("name companyName").lean(),
    Subscription.find({ customer, status: { $in: ["ACTIVE", "PAUSED", "CONFIRMED"] } }).select("number planSnapshot billingInterval status nextBillingDate expiryDate total").sort({ nextBillingDate: 1 }).lean(),
    Invoice.find({ customer, status: "CONFIRMED", amountDue: { $gt: 0 } }).select("number invoiceDate dueDate total amountDue status").sort({ dueDate: 1 }).lean(),
    Payment.aggregate([{ $match: { customer: new Types.ObjectId(user.customerId), status: "COMPLETED" } }, { $group: { _id: null, t: { $sum: "$amount" }, n: { $sum: 1 } } }]),
  ]);
  const active = subs.filter((s) => s.status === "ACTIVE");
  const next = active.filter((s) => s.nextBillingDate).sort((a, b) => +new Date(a.nextBillingDate!) - +new Date(b.nextBillingDate!))[0];
  const outstandingTotal = outstanding.reduce((t, i) => t + i.amountDue, 0);
  const overdueCount = outstanding.filter((i) => new Date(i.dueDate) < today).length;

  return (
    <div className="space-y-6">
      <PageHeader title={`Welcome, ${user.name.split(" ")[0]}`} description={profile?.companyName ? `${profile.companyName} · customer account` : "Your subscriptions, invoices and payments"} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Active subscriptions" value={String(active.length)} icon={Repeat} hint={subs.length > active.length ? `${subs.length - active.length} paused or pending` : "Currently billing"} />
        <KpiCard label="Next renewal" value={next ? formatDate(next.nextBillingDate) : "—"} icon={CalendarClock} tone="blue" hint={next ? `${next.planSnapshot?.name} · ${formatMoney(next.total)}` : "No upcoming billing"} />
        <KpiCard label="Outstanding invoices" value={formatMoney(outstandingTotal)} icon={Receipt} tone={overdueCount ? "red" : "amber"} hint={`${outstanding.length} unpaid${overdueCount ? ` · ${overdueCount} overdue` : ""}`} />
        <KpiCard label="Total subscription spending" value={formatMoney(spent[0]?.t ?? 0)} icon={Wallet} tone="green" hint={`${spent[0]?.n ?? 0} payments made`} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Invoices to pay" bodyClassName="p-0" actions={<Link href="/portal/invoices" className="text-xs font-medium text-primary hover:underline">All invoices</Link>}>
          {outstanding.length === 0 ? (
            <EmptyState icon={Receipt} title="You're all paid up" description="No outstanding invoices." />
          ) : (
            <div className={tableCls.wrap}>
              <table className={tableCls.table}>
                <thead className={tableCls.thead}>
                  <tr>
                    <th className={tableCls.th}>Invoice</th>
                    <th className={tableCls.th}>Due</th>
                    <th className={`${tableCls.th} text-right`}>Balance</th>
                    <th className={tableCls.th} />
                  </tr>
                </thead>
                <tbody>
                  {outstanding.map((inv) => {
                    const overdue = new Date(inv.dueDate) < today;
                    return (
                      <tr key={String(inv._id)} className={tableCls.tr}>
                        <td className={tableCls.td}>
                          <Link href={`/portal/invoices/${inv._id}`} className="font-medium text-primary hover:underline">
                            {inv.number}
                          </Link>
                        </td>
                        <td className={tableCls.td}>
                          <span className="mr-2">{formatDate(inv.dueDate)}</span>
                          {overdue && <StatusBadge status="OVERDUE" />}
                        </td>
                        <td className={tableCls.num}>{formatMoney(inv.amountDue)}</td>
                        <td className={`${tableCls.td} text-right`}>
                          <ActionButton
                            action={paySimulatedAction.bind(null, String(inv._id))}
                            size="xs"
                            variant="default"
                            confirm={{ title: `Pay ${formatMoney(inv.amountDue)}?`, description: "Demo payment — no real money is collected. This records a simulated card payment against the invoice.", confirmLabel: "Pay (demo)" }}
                          >
                            <CreditCard className="size-3.5" /> Pay now
                          </ActionButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="My subscriptions" bodyClassName="p-0" actions={<Link href="/portal/subscriptions" className="text-xs font-medium text-primary hover:underline">Manage</Link>}>
          {subs.length === 0 ? (
            <EmptyState icon={Repeat} title="No subscriptions yet" />
          ) : (
            <ul className="divide-y text-sm">
              {subs.map((s) => (
                <li key={String(s._id)} className="flex items-center gap-3 px-5 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{s.planSnapshot?.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {s.number} · {intervalLabel(s.billingInterval as BillingInterval)} · {s.nextBillingDate ? `next bill ${formatDate(s.nextBillingDate)}` : `expires ${formatDate(s.expiryDate)}`}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block font-medium tabular-nums">
                      {formatMoney(s.total)}
                      <span className="text-xs font-normal text-muted-foreground">{perIntervalSuffix(s.billingInterval as BillingInterval)}</span>
                    </span>
                    <StatusBadge status={s.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
