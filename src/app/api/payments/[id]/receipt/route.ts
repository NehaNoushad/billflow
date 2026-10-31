import { Invoice, Payment } from "@/models";
import { receiptPdf } from "@/lib/pdf";
import { getSettings } from "@/lib/utils-server";
import { authorizePdf, denyUnlessAccess, notFound, pdfResponse } from "../../../invoices/pdf-response";

export const runtime = "nodejs";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizePdf(id);
  if ("error" in auth) return auth.error;
  const payment = await Payment.findById(id).lean();
  if (!payment) return notFound();
  const denied = await denyUnlessAccess(auth.user, payment.customer);
  if (denied) return denied;
  const invoice = await Invoice.findById(payment.invoice).lean();
  if (!invoice) return notFound();
  return pdfResponse(receiptPdf(payment as never, invoice as never, await getSettings()), `Receipt-${payment.number}`, request);
}
