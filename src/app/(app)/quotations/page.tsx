import Link from "next/link";
import { FileText, LayoutTemplate, Plus } from "lucide-react";
import { connectDB } from "@/lib/db";
import { Quotation } from "@/models";
import { requirePage, scopeFilter } from "@/lib/auth/guard";
import { escapeRegex, pageParam, sp } from "@/lib/utils-server";
import { PAGE_SIZE, QUOTATION_STATUSES, humanize } from "@/lib/constants";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { expireQuotations } from "@/services/quotations";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/app/filters";
import { EmptyState, PageHeader, Pagination, StatusBadge, tableCls } from "@/components/app/ui-bits";

export const metadata = { title: "Quotations" };

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("quotations.manage");
  const params = await searchParams;
  await connectDB();
  await expireQuotations();
  const page = pageParam(params);
  const q = sp(params, "q");
  const status = sp(params, "status");
  const filter: Record<string, unknown> = { ...(await scopeFilter(user)) };
  if (status) filter.status = status;
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ number: rx }, { "customerSnapshot.name": rx }, { "customerSnapshot.companyName": rx }];
  }
  const [total, quotes] = await Promise.all([
    Quotation.countDocuments(filter),
    Quotation.find(filter).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
  ]);

  return (
    <>
      <PageHeader
        title="Quotations"
        description="Price proposals that convert into subscriptions once accepted"
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link href="/quotations/templates" />}>
              <LayoutTemplate className="size-4" /> Templates
            </Button>
            <Button nativeButton={false} render={<Link href="/quotations/new" />}>
              <Plus className="size-4" /> New quotation
            </Button>
          </>
        }
      />
      <div className="rounded-xl border bg-card shadow-xs">
        <FilterBar searchPlaceholder="Search number or customer…" filters={[{ name: "status", label: "Statuses", options: QUOTATION_STATUSES.map((s) => ({ value: s, label: humanize(s) })) }]} />
        {quotes.length === 0 ? (
          <EmptyState icon={FileText} title="No quotations found" description={q || status ? "Try a different filter." : "Create a quotation to propose pricing to a customer."} />
        ) : (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead className={tableCls.thead}>
                <tr>
                  <th className={tableCls.th}>Number</th>
                  <th className={tableCls.th}>Customer</th>
                  <th className={tableCls.th}>Plan</th>
                  <th className={tableCls.th}>Date</th>
                  <th className={tableCls.th}>Expires</th>
                  <th className={`${tableCls.th} text-right`}>Total</th>
                  <th className={tableCls.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((qt) => (
                  <tr key={String(qt._id)} className={tableCls.tr}>
                    <td className={tableCls.td}>
                      <Link href={`/quotations/${qt._id}`} className="font-medium text-primary hover:underline">
                        {qt.number}
                      </Link>
                    </td>
                    <td className={tableCls.td}>
                      {qt.customerSnapshot?.name}
                      <div className="text-xs text-muted-foreground">{qt.customerSnapshot?.companyName}</div>
                    </td>
                    <td className={tableCls.td}>{qt.planSnapshot?.name ?? "—"}</td>
                    <td className={tableCls.td}>{formatDate(qt.quotationDate)}</td>
                    <td className={tableCls.td}>{formatDate(qt.expiryDate)}</td>
                    <td className={tableCls.num}>{formatMoney(qt.total)}</td>
                    <td className={tableCls.td}>
                      <StatusBadge status={qt.status} />
                      {qt.subscription && <span className="ml-1.5 text-xs text-muted-foreground">converted</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} basePath="/quotations" params={params} />
      </div>
    </>
  );
}
