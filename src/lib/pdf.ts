import { jsPDF } from "jspdf";
import { methodLabel } from "@/components/billing/labels";
import { autoTable } from "jspdf-autotable";
import { formatMoneyPlain, formatBps } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/constants";

// Server-side PDF generation. Standard PDF fonts have no ₹ glyph, so amounts render as "INR 1,234.00".

type Settings = {
  companyName?: string | null;
  companyEmail?: string | null;
  companyPhone?: string | null;
  companyAddress?: string | null;
  companyTaxId?: string | null;
  invoiceFooter?: string | null;
};

type Party = { name?: string | null; email?: string | null; companyName?: string | null; taxId?: string | null; address?: string | null };

type PdfLine = {
  productName: string;
  variantName?: string | null;
  quantity: number;
  unitPrice: number;
  discountAmount?: number | null;
  taxAmount?: number | null;
  total: number;
  subtotal?: number;
};

type Discount = { name: string; type: string; value: number; amount: number };
type TaxRow = { name?: string | null; amount?: number | null };

const INDIGO: [number, number, number] = [79, 70, 229];
const MUTED: [number, number, number] = [100, 106, 120];
const DARK: [number, number, number] = [24, 28, 45];

function finalY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 0;
}

function header(doc: jsPDF, settings: Settings, title: string, meta: [string, string][]) {
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(...INDIGO);
  doc.rect(0, 0, w, 4, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...DARK);
  doc.text(settings.companyName ?? "BILLFLOW", 14, 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  const lines = [settings.companyAddress, [settings.companyEmail, settings.companyPhone].filter(Boolean).join("  ·  "), settings.companyTaxId ? `GSTIN: ${settings.companyTaxId}` : null].filter(Boolean) as string[];
  lines.forEach((l, i) => doc.text(doc.splitTextToSize(l, 100), 14, 24 + i * 4.5));

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...INDIGO);
  doc.text(title, w - 14, 18, { align: "right" });
  doc.setFontSize(8.5);
  meta.forEach(([k, v], i) => {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(k, w - 60, 26 + i * 5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...DARK);
    doc.text(v, w - 14, 26 + i * 5, { align: "right" });
  });
  return Math.max(24 + lines.length * 4.5, 26 + meta.length * 5) + 6;
}

function party(doc: jsPDF, label: string, p: Party, y: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(label.toUpperCase(), 14, y);
  doc.setFontSize(10.5);
  doc.setTextColor(...DARK);
  doc.text(p.companyName || p.name || "—", 14, y + 5.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  const rows = [p.companyName ? p.name : null, p.email, p.address, p.taxId ? `GSTIN: ${p.taxId}` : null].filter(Boolean) as string[];
  let yy = y + 10.5;
  for (const r of rows) {
    const wrapped = doc.splitTextToSize(r, 110);
    doc.text(wrapped, 14, yy);
    yy += wrapped.length * 4.2;
  }
  return yy + 4;
}

function linesTable(doc: jsPDF, lines: PdfLine[], y: number) {
  autoTable(doc, {
    startY: y,
    head: [["#", "Product", "Variant", "Qty", "Unit price", "Discount", "Tax", "Amount"]],
    body: lines.map((l, i) => [
      String(i + 1),
      l.productName,
      l.variantName || "—",
      String(l.quantity),
      formatMoneyPlain(l.unitPrice),
      l.discountAmount ? `-${formatMoneyPlain(l.discountAmount)}` : "—",
      formatMoneyPlain(l.taxAmount ?? 0),
      formatMoneyPlain(l.total),
    ]),
    theme: "striped",
    styles: { fontSize: 8, cellPadding: 2.2, textColor: DARK },
    headStyles: { fillColor: INDIGO, textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 8 }, 3: { halign: "right", cellWidth: 12 }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right", fontStyle: "bold" } },
    margin: { left: 14, right: 14 },
  });
  return finalY(doc) + 6;
}

function totalsBlock(doc: jsPDF, rows: [string, string, boolean?][], y: number) {
  const w = doc.internal.pageSize.getWidth();
  let yy = y;
  for (const [label, value, strong] of rows) {
    if (strong) {
      doc.setDrawColor(220, 222, 230);
      doc.line(w - 90, yy - 3.5, w - 14, yy - 3.5);
    }
    doc.setFont("helvetica", strong ? "bold" : "normal");
    doc.setFontSize(strong ? 10.5 : 9);
    doc.setTextColor(...(strong ? DARK : MUTED));
    doc.text(label, w - 90, yy);
    doc.setTextColor(...DARK);
    doc.text(value, w - 14, yy, { align: "right" });
    yy += strong ? 7 : 5.5;
  }
  return yy;
}

function footer(doc: jsPDF, settings: Settings, note?: string) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  if (note) doc.text(doc.splitTextToSize(note, w - 28), 14, h - 22);
  doc.text(settings.invoiceFooter ?? "Thank you for your business.", w / 2, h - 12, { align: "center" });
  doc.text("Generated by BILLFLOW", w / 2, h - 8, { align: "center" });
}

function notesBlock(doc: jsPDF, notes: string | null | undefined, y: number) {
  if (!notes) return y;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("NOTES", 14, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...DARK);
  const wrapped = doc.splitTextToSize(notes, 100);
  doc.text(wrapped, 14, y + 5);
  return y + 5 + wrapped.length * 4;
}

function toBuffer(doc: jsPDF): Buffer {
  return Buffer.from(doc.output("arraybuffer"));
}

function discountTaxRows(discounts: Discount[], taxes: TaxRow[]): [string, string][] {
  return [
    ...discounts.map((d) => [`${d.name}${d.type === "PERCENTAGE" ? ` (${formatBps(d.value)})` : ""}`, `-${formatMoneyPlain(d.amount)}`] as [string, string]),
    ...taxes.map((t) => [t.name ?? "Tax", formatMoneyPlain(t.amount ?? 0)] as [string, string]),
  ];
}

export function invoicePdf(
  invoice: {
    number: string;
    status: string;
    invoiceDate: Date | string;
    dueDate: Date | string;
    periodStart?: Date | string | null;
    periodEnd?: Date | string | null;
    subscriptionNumber?: string | null;
    paymentTermsDays?: number | null;
    customerSnapshot?: Party | null;
    discounts?: Discount[];
    taxBreakdown?: TaxRow[];
    subtotal: number;
    discountTotal?: number | null;
    taxTotal?: number | null;
    total: number;
    amountPaid?: number | null;
    amountDue?: number | null;
    notes?: string | null;
  },
  lines: PdfLine[],
  payments: { number: string; paymentDate: Date | string; method: string; amount: number; status: string }[],
  settings: Settings
): Buffer {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const meta: [string, string][] = [
    ["Invoice no.", invoice.number],
    ["Invoice date", formatDate(invoice.invoiceDate)],
    ["Due date", formatDate(invoice.dueDate)],
    ["Status", humanize(invoice.status)],
  ];
  if (invoice.periodStart) meta.push(["Billing period", `${formatDate(invoice.periodStart)} - ${formatDate(invoice.periodEnd)}`]);
  if (invoice.subscriptionNumber) meta.push(["Subscription", invoice.subscriptionNumber]);
  let y = header(doc, settings, "TAX INVOICE", meta);
  y = party(doc, "Bill to", invoice.customerSnapshot ?? {}, y);
  y = linesTable(doc, lines, y);
  const totalsY = totalsBlock(
    doc,
    [
      ["Subtotal", formatMoneyPlain(invoice.subtotal)],
      ...discountTaxRows(invoice.discounts ?? [], invoice.taxBreakdown ?? []),
      ["Total", formatMoneyPlain(invoice.total), true],
      ["Amount paid", formatMoneyPlain(invoice.amountPaid ?? 0)],
      ["Balance due", formatMoneyPlain(invoice.status === "CANCELLED" ? 0 : invoice.amountDue ?? 0), true],
    ],
    y
  );
  let leftY = notesBlock(doc, invoice.notes, y);
  const completed = payments.filter((p) => p.status === "COMPLETED");
  if (completed.length) {
    autoTable(doc, {
      startY: Math.max(totalsY, leftY) + 4,
      head: [["Payment", "Date", "Method", "Amount"]],
      body: completed.map((p) => [p.number, formatDate(p.paymentDate), methodLabel(p.method), formatMoneyPlain(p.amount)]),
      theme: "plain",
      styles: { fontSize: 8, textColor: DARK },
      headStyles: { textColor: MUTED, fontStyle: "bold" },
      columnStyles: { 3: { halign: "right" } },
      margin: { left: 14, right: 14 },
    });
    leftY = finalY(doc);
  }
  footer(doc, settings, `Payment terms: ${invoice.paymentTermsDays ?? 0} days from invoice date. Please quote ${invoice.number} with your payment.`);
  return toBuffer(doc);
}

export function quotationPdf(
  quotation: {
    number: string;
    status: string;
    quotationDate: Date | string;
    expiryDate: Date | string;
    customerSnapshot?: Party | null;
    planSnapshot?: { name?: string | null; billingInterval?: string | null } | null;
    lines: PdfLine[];
    discounts?: Discount[];
    subtotal: number;
    taxTotal?: number | null;
    total: number;
    notes?: string | null;
  },
  settings: Settings
): Buffer {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const meta: [string, string][] = [
    ["Quotation no.", quotation.number],
    ["Date", formatDate(quotation.quotationDate)],
    ["Valid until", formatDate(quotation.expiryDate)],
    ["Status", humanize(quotation.status)],
  ];
  if (quotation.planSnapshot?.name) meta.push(["Plan", `${quotation.planSnapshot.name}${quotation.planSnapshot.billingInterval ? ` (${humanize(quotation.planSnapshot.billingInterval)})` : ""}`]);
  let y = header(doc, settings, "QUOTATION", meta);
  y = party(doc, "Prepared for", quotation.customerSnapshot ?? {}, y);
  y = linesTable(doc, quotation.lines, y);
  // Aggregate taxes across lines for the breakdown.
  const taxMap = new Map<string, number>();
  for (const l of quotation.lines as (PdfLine & { taxes?: { name: string; amount?: number }[] })[]) for (const t of l.taxes ?? []) taxMap.set(t.name, (taxMap.get(t.name) ?? 0) + (t.amount ?? 0));
  totalsBlock(
    doc,
    [
      ["Subtotal", formatMoneyPlain(quotation.subtotal)],
      ...discountTaxRows(quotation.discounts ?? [], [...taxMap].map(([name, amount]) => ({ name, amount }))),
      [quotation.planSnapshot?.billingInterval ? "Total per billing period" : "Total", formatMoneyPlain(quotation.total), true],
    ],
    y
  );
  notesBlock(doc, quotation.notes, y);
  footer(doc, settings, `This quotation is valid until ${formatDate(quotation.expiryDate)}. Prices are recurring per billing period and exclude any taxes not listed.`);
  return toBuffer(doc);
}

export function receiptPdf(
  payment: { number: string; paymentDate: Date | string; method: string; amount: number; transactionRef?: string | null; status: string; simulated?: boolean | null; notes?: string | null },
  invoice: { number: string; total: number; amountPaid?: number | null; amountDue?: number | null; customerSnapshot?: Party | null },
  settings: Settings
): Buffer {
  const doc = new jsPDF({ unit: "mm", format: "a5" });
  let y = header(doc, settings, "RECEIPT", [
    ["Receipt no.", payment.number],
    ["Date", formatDate(payment.paymentDate)],
    ["Status", humanize(payment.status)],
  ]);
  y = party(doc, "Received from", invoice.customerSnapshot ?? {}, y);
  autoTable(doc, {
    startY: y,
    body: [
      ["Invoice", invoice.number],
      ["Payment method", methodLabel(payment.method)],
      ["Transaction reference", payment.transactionRef || "—"],
      ["Amount received", formatMoneyPlain(payment.amount)],
      ["Invoice total", formatMoneyPlain(invoice.total)],
      ["Balance remaining", formatMoneyPlain(invoice.amountDue ?? 0)],
    ],
    theme: "grid",
    styles: { fontSize: 8.5, textColor: DARK },
    columnStyles: { 0: { textColor: MUTED, cellWidth: 50 }, 1: { halign: "right", fontStyle: "bold" } },
    margin: { left: 14, right: 14 },
  });
  const note = [
    payment.status === "VOIDED" ? "This payment has been VOIDED and is no longer applied to the invoice." : null,
    payment.simulated ? "Simulated online payment recorded in demo mode - no real funds were transferred." : null,
  ]
    .filter(Boolean)
    .join(" ");
  footer(doc, settings, note || undefined);
  return toBuffer(doc);
}
