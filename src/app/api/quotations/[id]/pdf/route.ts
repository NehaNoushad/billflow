import { Quotation } from "@/models";
import { quotationPdf } from "@/lib/pdf";
import { getSettings } from "@/lib/utils-server";
import { authorizePdf, denyUnlessAccess, notFound, pdfResponse } from "../../../invoices/pdf-response";

export const runtime = "nodejs";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizePdf(id);
  if ("error" in auth) return auth.error;
  const quotation = await Quotation.findById(id).lean();
  if (!quotation) return notFound();
  const denied = await denyUnlessAccess(auth.user, quotation.customer);
  if (denied) return denied;
  return pdfResponse(quotationPdf(quotation as never, await getSettings()), quotation.number, request);
}
