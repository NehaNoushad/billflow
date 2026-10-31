import Link from "next/link";
import { methodLabel } from "@/components/billing/labels";
import { FileDown, Plus, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { connectDB } from "@/lib/db";
import { Customer, Payment } from "@/models";
import { requirePage, scopeFilter } from "@/lib/auth/guard";
import { can } from "@/lib/auth/permissions";
import { escapeRegex, pageParam, sp } from "@/lib/utils-server";
import { PAGE_SIZE, PAYMENT_METHODS, PAYMENT_STATUSES, humanize } from "@/lib/constants";
import { addDaysUTC, formatDate, parseDateInput } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { EmptyState, PageHeader, Pagination, StatusBadge, tableCls } from "@/components/app/ui-bits";
import { FilterBar } from "@/components/app/filters";
import { ActionButton } from "@/components/app/action-button";
import { voidPaymentAction } from "@/actions/payments";

export const metadata = { title: "Payments" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("payments.record");
  const params = await searchParams;
  await connectDB();
  const page = pageParam(params);
  const filter: Record<string, unknown> = { ...(await scopeFilter(user)) };
  const q = sp(params, "q");
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    const custIds = await Customer.find({ $or: [{ name: rx }, { companyName: rx }, { email: rx }] }).distinct("_id");
    filter.$or = [{ number: rx }, { invoiceNumber: rx }, { transactionRef: rx }, { customer: { $in: custIds } }];
  }
  const method = sp(params, "method");
  if (method) filter.method = method;
  const status = sp(params, "status");
  if (status) filter.status = status;
  const range: Record<string, Date> = {};
  try {
    if (sp(params, "from")) range.$gte = parseDateInput(sp(params, "from")!);
    if (sp(params, "to")) range.$lt = addDaysUTC(parseDateInput(sp(params, "to")!), 1);
  } catch {
    /* ignore malformed dates */
  }
  if (Object.keys(range).length) filter.paymentDate = range;

  const [rows, total, sum] = await Promise.all([
    Payment.find(filter).sort({ paymentDate: -1, createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).populate("customer", "name companyName").lean(),
    Payment.countDocuments(filter),
    Payment.aggregate([{ $match: { ...filter, status: "COMPLETED" } }, { $group: { _id: null, amount: { $sum: "$amount" }, n: { $sum: 1 } } }]),
  ]);
  const isAdmin = can(user.role, "billing.run");

  return (
    <>
      <PageHeader
        title="Payments"
        description="Payments recorded against invoices. BILLFLOW records received money and simulated demo payments — no live payment gateway is connected."
        actions={
          <Button nativeButton={false} render={<Link href="/payments/new" />}>
            <Plus className="size-4" /> Record payment
          </Button>
        }
      />
      <div className="mb-4 rounded-xl border bg-card px-4 py-3 shadow-xs sm:w-80">
        <p className="text-xs font-medium text-muted-foreground">Collected (completed payments, current filter)</p>
        <p className="mt-0.5 text-xl font-semibold text-emerald-700 tabular-nums">{formatMoney(sum[0]?.amount ?? 0)}</p>
        <p className="text-[11px] text-muted-foreground">{sum[0]?.n ?? 0} payment(s)</p>
      </div>
      <div className="rounded-xl border bg-card shadow-xs">
        <FilterBar
          searchPlaceholder="Search payment, invoice, customer, reference…"
          dateRange
          filters={[
            { name: "method", label: "Methods", options: PAYMENT_METHODS.map((m) => ({ value: m, label: methodLabel(m) })) },
            { name: "status", label: "Statuses", options: PAYMENT_STATUSES.map((s) => ({ value: s, label: humanize(s) })) },
          ]}
        />
        {rows.length === 0 ? (
          <EmptyState icon={Wallet} title="No payments found" description="Record a payment against a confirmed invoice." />
        ) : (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead className={tableCls.thead}>
                <tr>
                  <th className={tableCls.th}>Payment</th>
                  <th className={tableCls.th}>Customer</th>
                  <th className={tableCls.th}>Invoice</th>
                  <th className={tableCls.th}>Date</th>
                  <th className={tableCls.th}>Method</th>
                  <th className={tableCls.th}>Status</th>
                  <th className={`${tableCls.th} text-right`}>Amount</th>
                  <th className={tableCls.th} />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const cust = p.customer as unknown as { _id: string; name: string; companyName?: string } | null;
                  return (
                    <tr key={String(p._id)} className={tableCls.tr}>
                      <td className={tableCls.td}>
                        <div className="font-medium">{p.number}</div>
                        <div className="text-xs text-muted-foreground">
                          {p.transactionRef || "—"}
                          {p.simulated ? " · simulated" : ""}
                        </div>
                      </td>
                      <td className={tableCls.td}>
                        {cust ? (
                          <Link href={`/customers/${cust._id}`} className="hover:underline">
                            {cust.name}
                          </Link>
                        ) : (
                          "—"
                        )}
                        <div className="text-xs text-muted-foreground">{cust?.companyName}</div>
                      </td>
                      <td className={tableCls.td}>
                        <Link href={`/invoices/${p.invoice}`} className="text-primary hover:underline">
                          {p.invoiceNumber}
                        </Link>
                      </td>
                      <td className={tableCls.td}>{formatDate(p.paymentDate)}</td>
                      <td className={tableCls.td}>{methodLabel(p.method)}</td>
                      <td className={tableCls.td}>
                        <StatusBadge status={p.status} />
                      </td>
                      <td className={`${tableCls.num} ${p.status !== "COMPLETED" ? "text-muted-foreground line-through" : "font-medium"}`}>{formatMoney(p.amount)}</td>
                      <td className={`${tableCls.td} text-right`}>
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon-sm" nativeButton={false} render={<a href={`/api/payments/${p._id}/receipt`} title="Download receipt" />}>
                            <FileDown className="size-4" />
                          </Button>
                          {isAdmin && p.status === "COMPLETED" && (
                            <ActionButton
                              action={voidPaymentAction.bind(null, String(p._id))}
                              variant="ghost"
                              size="xs"
                              confirm={{ title: `Void ${p.number}?`, description: `This reverses ${formatMoney(p.amount)} on ${p.invoiceNumber} and re-opens the balance. Use only to correct mistakes.`, confirmLabel: "Void payment", destructive: true, reasonLabel: "Reason", reasonRequired: true }}
                            >
                              Void
                            </ActionButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} basePath="/payments" params={params} />
      </div>
    </>
  );
}
