import { BillingExecution, Invoice, Subscription } from "@/models";
import { addInterval, businessToday, utcDay, type BillingInterval } from "@/lib/dates";
import { getSettings, logActivity } from "@/lib/utils-server";
import { formatMoney } from "@/lib/money";
import type { CurrentUser } from "@/lib/auth/guard";
import type { LineInput } from "@/lib/billing/calc";
import { createInvoice } from "./invoices";
import { loadAutoDiscountRules } from "./pricing";
import { transitionSubscription } from "./subscriptions";

type SnapshotTax = { tax?: unknown; name: string; type: string; rateBps: number };
type SnapshotLine = { product?: unknown; productName: string; variant?: unknown; variantName?: string | null; description?: string | null; quantity: number; unitPrice: number; costPrice?: number | null; taxes: SnapshotTax[] };

const MAX_PERIODS_PER_RUN = 36; // safety cap on catch-up billing for one subscription in one run

type RunOptions = { asOf?: Date; trigger: "CRON" | "MANUAL" | "SEED"; actor?: CurrentUser | null };

type Entry = {
  subscription: unknown;
  subscriptionNumber: string;
  outcome: "GENERATED" | "SKIPPED" | "FAILED" | "CLOSED";
  invoice?: unknown;
  invoiceNumber?: string;
  periodStart?: Date;
  amount?: number;
  message?: string;
};

/** The idempotency key for one subscription billing period. A unique index makes duplicates impossible. */
export function billingKey(subscriptionId: string, periodStart: Date) {
  return `sub:${subscriptionId}:${utcDay(periodStart).toISOString().slice(0, 10)}`;
}

/**
 * Recurring billing engine.
 * For every subscription due on or before `asOf`, generates one invoice per unbilled period
 * (catching up missed periods), advances nextBillingDate with an optimistic-concurrency check,
 * then auto-closes subscriptions whose term has ended. Safe to run repeatedly or concurrently.
 */
export async function runBilling({ asOf = businessToday(), trigger, actor = null }: RunOptions) {
  const runDate = utcDay(asOf);
  const settings = await getSettings();
  const execution = await BillingExecution.create({ trigger, triggeredBy: actor?.id, triggeredByName: actor?.name ?? (trigger === "CRON" ? "Scheduler" : "System"), asOf: runDate });
  const entries: Entry[] = [];
  const invoiceIds: unknown[] = [];
  let totalValue = 0;
  const processedSubs = new Set<string>();

  try {
    const rules = await loadAutoDiscountRules();
    const billableStatuses = settings.chargeDuringPause ? ["ACTIVE", "PAUSED"] : ["ACTIVE"];
    const due = await Subscription.find({ status: { $in: billableStatuses }, nextBillingDate: { $ne: null, $lte: runDate } })
      .sort({ nextBillingDate: 1 })
      .lean();

    for (const sub of due) {
      const subId = String(sub._id);
      processedSubs.add(subId);
      const interval = sub.billingInterval as BillingInterval;
      let periodStart = utcDay(sub.nextBillingDate!);

      for (let i = 0; i < MAX_PERIODS_PER_RUN && periodStart <= runDate; i++) {
        // Never bill a period that starts on/after the subscription's expiry.
        if (sub.expiryDate && periodStart >= utcDay(sub.expiryDate)) break;
        const periodEnd = addInterval(periodStart, interval, 1, sub.billingAnchorDay ?? undefined);
        const key = billingKey(subId, periodStart);
        try {
          // Cheap pre-check (keeps invoice numbers gap-free); the unique index is the real guarantee.
          if (await Invoice.exists({ idempotencyKey: key })) throw Object.assign(new Error("duplicate"), { code: 11000 });
          const invoice = await createInvoice({
            customerId: String(sub.customer),
            lines: (sub.lines as SnapshotLine[]).map((l) => ({
              product: l.product ? String(l.product) : undefined,
              productName: l.productName,
              variant: l.variant ? String(l.variant) : undefined,
              variantName: l.variantName ?? undefined,
              description: l.description ?? undefined,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              costPrice: l.costPrice ?? 0,
              taxes: l.taxes.map((t: SnapshotTax) => ({ tax: t.tax ? String(t.tax) : undefined, name: t.name, type: t.type, rateBps: t.rateBps })),
            })) as LineInput[],
            discountRules: rules,
            manualDiscount: sub.manualDiscount?.amount
              ? { name: sub.manualDiscount.name, type: "FIXED", value: sub.manualDiscount.amount }
              : null,
            invoiceDate: periodStart,
            paymentTermsDays: sub.paymentTermsDays ?? settings.defaultPaymentTermsDays,
            status: settings.autoConfirmInvoices ? "CONFIRMED" : "DRAFT",
            source: "BILLING_ENGINE",
            subscription: { id: subId, number: sub.number },
            periodStart,
            periodEnd,
            idempotencyKey: key,
            billingExecution: String(execution._id),
            actor,
          });
          invoiceIds.push(invoice._id);
          totalValue += invoice.total;
          entries.push({ subscription: sub._id, subscriptionNumber: sub.number, outcome: "GENERATED", invoice: invoice._id, invoiceNumber: invoice.number, periodStart, amount: invoice.total });
          // Keep the in-memory rule usage counts current so limits hold within this run.
          for (const d of invoice.discounts) {
            const r = rules.find((x) => x._id === String(d.discount));
            if (r) r.usageCount = (r.usageCount ?? 0) + 1;
          }
        } catch (err) {
          if (isDuplicateKey(err)) {
            entries.push({ subscription: sub._id, subscriptionNumber: sub.number, outcome: "SKIPPED", periodStart, message: "Invoice for this period already exists" });
          } else {
            entries.push({ subscription: sub._id, subscriptionNumber: sub.number, outcome: "FAILED", periodStart, message: err instanceof Error ? err.message : String(err) });
            break; // leave nextBillingDate untouched so the period is retried next run
          }
        }
        // Advance only if nobody else already advanced it (optimistic concurrency).
        const advanced = await Subscription.updateOne(
          { _id: sub._id, nextBillingDate: periodStart },
          { $set: { nextBillingDate: periodEnd, lastBilledAt: new Date() } }
        );
        if (advanced.modifiedCount === 0) break;
        periodStart = periodEnd;
      }
    }

    // Auto-close subscriptions whose term has ended (after their final period was billed above).
    const expiring = await Subscription.find({ status: { $in: ["ACTIVE", "PAUSED"] }, "planSnapshot.autoClose": true, expiryDate: { $lte: runDate } }).lean();
    for (const sub of expiring) {
      try {
        await transitionSubscription(String(sub._id), "CLOSED", { actor: null, note: "Auto-closed at end of term", asOf: runDate, force: true });
        entries.push({ subscription: sub._id, subscriptionNumber: sub.number, outcome: "CLOSED", message: "Auto-closed at end of term" });
      } catch (err) {
        entries.push({ subscription: sub._id, subscriptionNumber: sub.number, outcome: "FAILED", message: `Auto-close failed: ${err instanceof Error ? err.message : err}` });
      }
    }

    const count = (o: Entry["outcome"]) => entries.filter((e) => e.outcome === o).length;
    const failed = count("FAILED");
    await BillingExecution.updateOne(
      { _id: execution._id },
      {
        $set: {
          status: failed ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
          finishedAt: new Date(),
          processed: processedSubs.size,
          generated: count("GENERATED"),
          skipped: count("SKIPPED"),
          failed,
          autoClosed: count("CLOSED"),
          totalValue,
          invoices: invoiceIds,
          entries,
        },
      }
    );
    await logActivity({
      actor,
      action: "billing.run",
      entityType: "BillingExecution",
      entityId: execution._id,
      message: `Billing run (${trigger.toLowerCase()}) as of ${runDate.toISOString().slice(0, 10)}: ${count("GENERATED")} invoice(s), ${formatMoney(totalValue)}, ${count("SKIPPED")} skipped, ${failed} failed`,
    });
  } catch (err) {
    await BillingExecution.updateOne(
      { _id: execution._id },
      { $set: { status: "FAILED", finishedAt: new Date(), entries: [...entries, { subscriptionNumber: "—", outcome: "FAILED", message: err instanceof Error ? err.message : String(err) }] } }
    );
    throw err;
  }
  return BillingExecution.findById(execution._id).lean();
}

function isDuplicateKey(err: unknown) {
  return !!err && typeof err === "object" && "code" in err && (err as { code: number }).code === 11000;
}
