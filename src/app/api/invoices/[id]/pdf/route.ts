import { Invoice, InvoiceLine, Payment } from "@/models";
import { invoicePdf } from "@/lib/pdf";
import { getSettings } from "@/lib/utils-server";
import { authorizePdf, denyUnlessAccess, notFound, pdfResponse } from "../../pdf-response";

export const runtime = "nodejs";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizePdf(id);
  if ("error" in auth) return auth.error;
  const invoice = await Invoice.findById(id).lean();
  if (!invoice) return notFound();
  const denied = await denyUnlessAccess(auth.user, invoice.customer);
  if (denied) return denied;
  // Customers never see unfinalised drafts.
  if (auth.user.role === "CUSTOMER" && invoice.status === "DRAFT") return notFound();
  const [lines, payments, settings] = await Promise.all([
    InvoiceLine.find({ invoice: invoice._id }).sort({ position: 1 }).lean(),
    Payment.find({ invoice: invoice._id }).sort({ paymentDate: 1 }).lean(),
    getSettings(),
  ]);
  return pdfResponse(invoicePdf(invoice as never, lines as never, payments as never, settings), invoice.number, request);
}
