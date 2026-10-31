import Link from "next/link";
import { notFound } from "next/navigation";
import { FilePlus2, Pencil, Repeat } from "lucide-react";
import { connectDB } from "@/lib/db";
import { Customer, Invoice, Payment, Quotation, Subscription } from "@/models";
import { canAccessCustomer, requirePage } from "@/lib/auth/guard";
import { isObjectId } from "@/lib/utils-server";
import { formatDate, intervalLabel, type BillingInterval } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { humanize } from "@/lib/constants";
import { isOverdue, formatAddress } from "@/services/invoices";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DetailList, EmptyState, KpiCard, PageHeader, Panel, StatusBadge, tableCls } from "@/components/app/ui-bits";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("customers.view");
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  await connectDB();
  const c = await Customer.findById(id).populate("assignedStaff", "name").lean();
  if (!c || !(await canAccessCustomer(user, c._id))) notFound();

  const [subs, quotes, invoices, payments] = await Promise.all([
    Subscription.find({ customer: c._id }).sort({ createdAt: -1 }).lean(),
    Quotation.find({ customer: c._id }).sort({ createdAt: -1 }).limit(50).lean(),
    Invoice.find({ customer: c._id }).sort({ invoiceDate: -1 }).limit(100).lean(),
    Payment.find({ customer: c._id }).sort({ paymentDate: -1 }).limit(100).lean(),
  ]);
  const posted = invoices.filter((i) => ["CONFIRMED", "PAID"].includes(i.status));
  const invoiced = posted.reduce((s, i) => s + i.total, 0);
  const collected = payments.filter((p) => p.status === "COMPLETED").reduce((s, p) => s + p.amount, 0);
  const outstanding = invoices.filter((i) => i.status === "CONFIRMED").reduce((s, i) => s + i.amountDue, 0);
  const overdue = invoices.filter((i) => isOverdue(i)).length;
  const active = subs.filter((s) => ["ACTIVE", "PAUSED"].includes(s.status)).length;

  return (
    <>
      <PageHeader
        title={c.name}
        description={[c.companyName, c.email].filter(Boolean).join(" · ")}
        back={{ href: "/customers", label: "Customers" }}
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link href={`/customers/${id}/edit`} />}>
              <Pencil className="size-4" /> Edit
            </Button>
            {c.status === "ACTIVE" && (
              <>
                <Button variant="outline" nativeButton={false} render={<Link href={`/quotations/new?customer=${id}`} />}>
                  <FilePlus2 className="size-4" /> New quotation
                </Button>
                <Button nativeButton={false} render={<Link href={`/subscriptions/new?customer=${id}`} />}>
                  <Repeat className="size-4" /> New subscription
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total invoiced" value={formatMoney(invoiced)} hint={`${posted.length} posted invoice(s)`} />
        <KpiCard label="Collected" value={formatMoney(collected)} tone="green" hint="Completed payments" />
        <KpiCard label="Outstanding" value={formatMoney(outstanding)} tone={overdue ? "red" : "amber"} hint={overdue ? `${overdue} overdue` : "Nothing overdue"} />
        <KpiCard label="Active subscriptions" value={String(active)} tone="blue" hint={`${subs.length} total`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Panel title="Profile">
          <DetailList
            items={[
              { label: "Status", value: <StatusBadge status={c.status} /> },
              { label: "Phone", value: c.phone ?? "—" },
              { label: "GSTIN", value: c.taxId ?? "—" },
              { label: "Assigned staff", value: (c.assignedStaff as unknown as { name?: string } | null)?.name ?? "Unassigned" },
              { label: "Registered", value: formatDate(c.createdAt) },
              { label: "Portal login", value: c.user ? "Yes" : "No" },
            ]}
          />
          <div className="mt-4">
            <p className="text-xs text-muted-foreground">Billing address</p>
            <p className="mt-0.5 text-sm">{formatAddress(c.billingAddress) || "—"}</p>
          </div>
          {c.notes && (
            <div className="mt-4">
              <p className="text-xs text-muted-foreground">Notes</p>
              <p className="mt-0.5 text-sm whitespace-pre-wrap">{c.notes}</p>
            </div>
          )}
        </Panel>
        <div className="min-w-0 rounded-xl border bg-card shadow-xs">
          <Tabs defaultValue="subs">
            <div className="overflow-x-auto border-b px-3 pt-3">
              <TabsList variant="line">
                <TabsTrigger value="subs">Subscriptions ({subs.length})</TabsTrigger>
                <TabsTrigger value="quotes">Quotations ({quotes.length})</TabsTrigger>
                <TabsTrigger value="invoices">Invoices ({invoices.length})</TabsTrigger>
                <TabsTrigger value="payments">Payments ({payments.length})</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="subs">
              {subs.length === 0 ? (
                <EmptyState title="No subscriptions yet" />
              ) : (
                <div className={tableCls.wrap}>
                  <table className={tableCls.table}>
                    <thead className={tableCls.thead}>
                      <tr>
                        <th className={tableCls.th}>Number</th>
                        <th className={tableCls.th}>Plan</th>
                        <th className={tableCls.th}>Next billing</th>
                        <th className={tableCls.th}>Expiry</th>
                        <th className={`${tableCls.th} text-right`}>Per period</th>
                        <th className={tableCls.th}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subs.map((s) => (
                        <tr key={String(s._id)} className={tableCls.tr}>
                          <td className={tableCls.td}>
                            <Link href={`/subscriptions/${s._id}`} className="font-medium text-primary hover:underline">
                              {s.number}
                            </Link>
                          </td>
                          <td className={tableCls.td}>
                            {s.planSnapshot?.name} <span className="text-xs text-muted-foreground">· {intervalLabel(s.billingInterval as BillingInterval)}</span>
                          </td>
                          <td className={tableCls.td}>{formatDate(s.nextBillingDate)}</td>
                          <td className={tableCls.td}>{formatDate(s.expiryDate)}</td>
                          <td className={tableCls.num}>{formatMoney(s.total)}</td>
                          <td className={tableCls.td}>
                            <StatusBadge status={s.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>
            <TabsContent value="quotes">
              {quotes.length === 0 ? (
                <EmptyState title="No quotations yet" />
              ) : (
                <div className={tableCls.wrap}>
                  <table className={tableCls.table}>
                    <thead className={tableCls.thead}>
                      <tr>
                        <th className={tableCls.th}>Number</th>
                        <th className={tableCls.th}>Date</th>
                        <th className={tableCls.th}>Expires</th>
                        <th className={`${tableCls.th} text-right`}>Total</th>
                        <th className={tableCls.th}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quotes.map((q) => (
                        <tr key={String(q._id)} className={tableCls.tr}>
                          <td className={tableCls.td}>
                            <Link href={`/quotations/${q._id}`} className="font-medium text-primary hover:underline">
                              {q.number}
                            </Link>
                          </td>
                          <td className={tableCls.td}>{formatDate(q.quotationDate)}</td>
                          <td className={tableCls.td}>{formatDate(q.expiryDate)}</td>
                          <td className={tableCls.num}>{formatMoney(q.total)}</td>
                          <td className={tableCls.td}>
                            <StatusBadge status={q.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>
            <TabsContent value="invoices">
              {invoices.length === 0 ? (
                <EmptyState title="No invoices yet" />
              ) : (
                <div className={tableCls.wrap}>
                  <table className={tableCls.table}>
                    <thead className={tableCls.thead}>
                      <tr>
                        <th className={tableCls.th}>Number</th>
                        <th className={tableCls.th}>Date</th>
                        <th className={tableCls.th}>Due</th>
                        <th className={`${tableCls.th} text-right`}>Total</th>
                        <th className={`${tableCls.th} text-right`}>Outstanding</th>
                        <th className={tableCls.th}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((i) => (
                        <tr key={String(i._id)} className={tableCls.tr}>
                          <td className={tableCls.td}>
                            <Link href={`/invoices/${i._id}`} className="font-medium text-primary hover:underline">
                              {i.number}
                            </Link>
                          </td>
                          <td className={tableCls.td}>{formatDate(i.invoiceDate)}</td>
                          <td className={tableCls.td}>{formatDate(i.dueDate)}</td>
                          <td className={tableCls.num}>{formatMoney(i.total)}</td>
                          <td className={tableCls.num}>{formatMoney(i.amountDue)}</td>
                          <td className={tableCls.td}>
                            <StatusBadge status={isOverdue(i) ? "OVERDUE" : i.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>
            <TabsContent value="payments">
              {payments.length === 0 ? (
                <EmptyState title="No payments yet" />
              ) : (
                <div className={tableCls.wrap}>
                  <table className={tableCls.table}>
                    <thead className={tableCls.thead}>
                      <tr>
                        <th className={tableCls.th}>Payment</th>
                        <th className={tableCls.th}>Date</th>
                        <th className={tableCls.th}>Invoice</th>
                        <th className={tableCls.th}>Method</th>
                        <th className={`${tableCls.th} text-right`}>Amount</th>
                        <th className={tableCls.th}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={String(p._id)} className={tableCls.tr}>
                          <td className={tableCls.td}>
                            <Link href={`/invoices/${p.invoice}`} className="font-medium text-primary hover:underline">
                              {p.number}
                            </Link>
                          </td>
                          <td className={tableCls.td}>{formatDate(p.paymentDate)}</td>
                          <td className={tableCls.td}>
                            <Link href={`/invoices/${p.invoice}`} className="hover:underline">
                              {p.invoiceNumber}
                            </Link>
                          </td>
                          <td className={tableCls.td}>{humanize(p.method)}</td>
                          <td className={tableCls.num}>{formatMoney(p.amount)}</td>
                          <td className={tableCls.td}>
                            <StatusBadge status={p.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
}
