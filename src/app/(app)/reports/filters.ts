import { INVOICE_STATUSES, SUBSCRIPTION_STATUSES } from "@/lib/constants";
import type { ReportFilters } from "@/services/analytics";

const pick = (v: unknown) => (typeof v === "string" && v ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : undefined);
const id = (v: unknown) => {
  const s = pick(v);
  return s && /^[a-f\d]{24}$/i.test(s) ? s : undefined;
};

/** Parse and whitelist report filters from search params (shared by page and CSV route). */
export function reportFiltersFrom(params: Record<string, unknown>): ReportFilters {
  const subStatus = pick(params.subscriptionStatus);
  const invStatus = pick(params.invoiceStatus);
  return {
    customer: id(params.customer),
    product: id(params.product),
    plan: id(params.plan),
    subscriptionStatus: subStatus && (SUBSCRIPTION_STATUSES as readonly string[]).includes(subStatus) ? subStatus : undefined,
    invoiceStatus: invStatus && ([...INVOICE_STATUSES, "OVERDUE"] as string[]).includes(invStatus) ? invStatus : undefined,
  };
}
