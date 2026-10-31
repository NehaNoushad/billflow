import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { connectDB } from "@/lib/db";
import { Customer, Invoice, Subscription } from "@/models";
import { requirePage, scopeFilter } from "@/lib/auth/guard";
import { escapeRegex, pageParam, sp } from "@/lib/utils-server";
import { PAGE_SIZE } from "@/lib/constants";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/app/filters";
import { EmptyState, PageHeader, Pagination, StatusBadge, tableCls } from "@/components/app/ui-bits";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("customers.view");
  const params = await searchParams;
  await connectDB();
  const page = pageParam(params);
  const q = sp(params, "q");
  const status = sp(params, "status");

  const filter: Record<string, unknown> = { ...(await scopeFilter(user, "_id")) };
  if (status) filter.status = status;
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ name: rx }, { email: rx }, { companyName: rx }];
  }
  const [total, customers] = await Promise.all([
    Customer.countDocuments(filter),
    Customer.find(filter).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).populate("assignedStaff", "name").lean(),
  ]);
  const ids = customers.map((c) => c._id);
  const [subs, dues] = await Promise.all([
    Subscription.aggregate([{ $match: { customer: { $in: ids }, status: { $in: ["ACTIVE", "PAUSED"] } } }, { $group: { _id: "$customer", n: { $sum: 1 } } }]),
    Invoice.aggregate([{ $match: { customer: { $in: ids }, status: "CONFIRMED" } }, { $group: { _id: "$customer", due: { $sum: "$amountDue" } } }]),
  ]);
  const subMap = new Map(subs.map((s) => [String(s._id), s.n as number]));
  const dueMap = new Map(dues.map((d) => [String(d._id), d.due as number]));

  return (
    <>
      <PageHeader
        title="Customers"
        description={user.role === "STAFF" ? "Customers assigned to you" : "All customer accounts"}
        actions={
          <Button nativeButton={false} render={<Link href="/customers/new" />}>
            <Plus className="size-4" /> New customer
          </Button>
        }
      />
      <div className="rounded-xl border bg-card shadow-xs">
        <FilterBar
          searchPlaceholder="Search name, email or company…"
          filters={[{ name: "status", label: "Statuses", options: [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }] }]}
        />
        {customers.length === 0 ? (
          <EmptyState icon={Users} title="No customers found" description={q || status ? "Try a different search or filter." : "Create your first customer to start quoting."} />
        ) : (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead className={tableCls.thead}>
                <tr>
                  <th className={tableCls.th}>Customer</th>
                  <th className={tableCls.th}>Company</th>
                  <th className={tableCls.th}>Phone</th>
                  <th className={tableCls.th}>Assigned to</th>
                  <th className={`${tableCls.th} text-right`}>Active subs</th>
                  <th className={`${tableCls.th} text-right`}>Outstanding</th>
                  <th className={tableCls.th}>Status</th>
                  <th className={tableCls.th}>Since</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => {
                  const due = dueMap.get(String(c._id)) ?? 0;
                  return (
                    <tr key={String(c._id)} className={tableCls.tr}>
                      <td className={tableCls.td}>
                        <Link href={`/customers/${c._id}`} className="font-medium text-primary hover:underline">
                          {c.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">{c.email}</div>
                      </td>
                      <td className={tableCls.td}>{c.companyName ?? "—"}</td>
                      <td className={tableCls.td}>{c.phone ?? "—"}</td>
                      <td className={tableCls.td}>{(c.assignedStaff as unknown as { name?: string } | null)?.name ?? <span className="text-muted-foreground">Unassigned</span>}</td>
                      <td className={tableCls.num}>{subMap.get(String(c._id)) ?? 0}</td>
                      <td className={`${tableCls.num} ${due > 0 ? "font-medium text-amber-700" : ""}`}>{formatMoney(due)}</td>
                      <td className={tableCls.td}>
                        <StatusBadge status={c.status} />
                      </td>
                      <td className={tableCls.td}>{formatDate(c.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} basePath="/customers" params={params} />
      </div>
    </>
  );
}
