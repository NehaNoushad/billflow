import { Quotation } from "@/models";
import { businessToday } from "@/lib/dates";
import { toPaise } from "@/lib/money";
import { BusinessError } from "@/lib/errors";
import type { LineInput, ManualDiscount } from "@/lib/billing/calc";
import { buildLineSnapshots, planFeeLine } from "./pricing";

type RawLine = { product: string; variant?: string; quantity: number; unitPrice?: string | number | null };

/** Rebuild line snapshots on the server from ids (+ plan fee). Client prices are only honoured as explicit overrides. */
export async function buildSalesLines(lines: RawLine[], planId: string, { allowPriceOverride = false } = {}): Promise<LineInput[]> {
  const requests = lines.map((l) => {
    let unitPrice: number | null = null;
    if (allowPriceOverride && l.unitPrice !== undefined && l.unitPrice !== null && String(l.unitPrice).trim() !== "") {
      try {
        unitPrice = toPaise(l.unitPrice);
      } catch {
        throw new BusinessError(`Invalid unit price: ${l.unitPrice}`);
      }
      if (unitPrice < 0) throw new BusinessError("Unit price cannot be negative.");
    }
    return { product: l.product, variant: l.variant ?? null, quantity: l.quantity, unitPrice };
  });
  const snapshots = await buildLineSnapshots(requests, { allowPriceOverride });
  const fee = await planFeeLine(planId);
  return fee ? [fee, ...snapshots] : snapshots;
}

/** Convert the form's manual discount (rupees or percent text) into calc input. */
export function parseManualDiscount(md: { type: "PERCENTAGE" | "FIXED"; value?: string | number; name?: string } | null | undefined): ManualDiscount | null {
  if (!md || md.value === undefined || String(md.value).trim() === "") return null;
  const name = md.name?.trim() || "Manual discount";
  if (md.type === "FIXED") {
    let v: number;
    try {
      v = toPaise(md.value);
    } catch {
      throw new BusinessError("Manual discount must be a valid amount.");
    }
    if (v < 0) throw new BusinessError("Manual discount cannot be negative.");
    return v > 0 ? { name, type: "FIXED", value: v } : null;
  }
  const s = String(md.value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s) || Number(s) > 100) throw new BusinessError("Manual discount percentage must be between 0 and 100.");
  const [w, f = ""] = s.split(".");
  const bps = Number(w) * 100 + Number((f + "00").slice(0, 2));
  return bps > 0 ? { name, type: "PERCENTAGE", value: bps } : null;
}

/** Persist expiry: DRAFT/SENT quotations past their expiry date become EXPIRED (with a history entry). */
export async function expireQuotations(filter: Record<string, unknown> = {}) {
  const today = businessToday();
  await Quotation.updateMany(
    { ...filter, status: { $in: ["DRAFT", "SENT"] }, expiryDate: { $lt: today } },
    [
      {
        $set: {
          history: { $concatArrays: ["$history", [{ from: "$status", to: "EXPIRED", at: "$$NOW", byName: "System", note: "Validity period ended" }]] },
          status: "EXPIRED",
        },
      },
    ],
    { updatePipeline: true }
  );
}
