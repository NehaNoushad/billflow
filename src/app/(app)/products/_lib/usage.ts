import { InvoiceLine, Quotation, QuotationTemplate, Subscription, SubscriptionPlan } from "@/models";

/** Count every place a product is referenced. Snapshots still reference the product id. */
export async function productUsage(productId: string) {
  const [plans, subscriptions, quotations, templates, invoiceLines] = await Promise.all([
    SubscriptionPlan.countDocuments({ products: productId }),
    Subscription.countDocuments({ "lines.product": productId }),
    Quotation.countDocuments({ "lines.product": productId }),
    QuotationTemplate.countDocuments({ "lines.product": productId }),
    InvoiceLine.countDocuments({ product: productId }),
  ]);
  return { plans, subscriptions, quotations, templates, invoiceLines, total: plans + subscriptions + quotations + templates + invoiceLines };
}
