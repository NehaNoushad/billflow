// Demo data generator. Used by `npm run seed` and the admin "Reset demo data" button.
// Invoices are produced by the real billing engine so demo data obeys the same rules as live data.
import mongoose from "mongoose";
import {
  ActivityLog, BillingExecution, Counter, Customer, Discount, Invoice, InvoiceLine, PasswordResetToken, Payment, Product,
  ProductVariant, Quotation, QuotationTemplate, RateLimit, RevenueInsight, Setting, Subscription, SubscriptionPlan,
  SubscriptionRequest, Tax, User,
} from "@/models";
import { hashPassword } from "@/lib/auth/password";
import { addDaysUTC, addInterval, addMonthsUTC, businessToday, type BillingInterval } from "@/lib/dates";
import { computeTotals } from "@/lib/billing/calc";
import { nextNumber } from "@/lib/utils-server";
import { buildLineSnapshots, planFeeLine } from "./pricing";
import { createSubscription } from "./subscriptions";
import { runBilling } from "./billing";
import { createInvoice } from "./invoices";
import { recordPayment } from "./payments";

export const DEMO_PASSWORD = "Demo@12345";
const rs = (rupees: number) => Math.round(rupees * 100);

export async function seedDatabase(log: (msg: string) => void = () => {}) {
  const today = businessToday();
  log("Clearing collections…");
  await Promise.all(
    [ActivityLog, BillingExecution, Counter, Customer, Discount, Invoice, InvoiceLine, PasswordResetToken, Payment, Product, ProductVariant, Quotation, QuotationTemplate, RateLimit, RevenueInsight, Setting, Subscription, SubscriptionPlan, SubscriptionRequest, Tax, User].map(
      (m) => (m as mongoose.Model<unknown>).deleteMany({})
    )
  );
  await Promise.all([User, Customer, Invoice, Subscription, Quotation, Payment, Tax, Product, ProductVariant, SubscriptionPlan].map((m) => (m as mongoose.Model<unknown>).syncIndexes()));
  await Setting.create({ _id: "global", companyTaxId: "32AABCB1234M1Z5", companyPhone: "+91 484 400 1234" });

  /* ---------------------------------------------------------------- Users */
  log("Creating users…");
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const admin = await User.create({ name: "Anita Admin", email: "admin@billflow.demo", passwordHash, role: "ADMIN" });
  const staff = await User.create({ name: "Rahul Nair", email: "staff@billflow.demo", passwordHash, role: "STAFF" });
  const staff2 = await User.create({ name: "Divya Pillai", email: "staff2@billflow.demo", passwordHash, role: "STAFF" });
  const actor = { id: String(admin._id), name: admin.name, email: admin.email, role: "ADMIN" as const };

  /* ---------------------------------------------------------------- Taxes */
  log("Creating taxes…");
  const [cgst, sgst, igst] = await Tax.insertMany([
    { name: "CGST 9%", rateBps: 900, type: "CGST", description: "Central GST for intra-state supply (Kerala)" },
    { name: "SGST 9%", rateBps: 900, type: "SGST", description: "State GST for intra-state supply (Kerala)" },
    { name: "IGST 18%", rateBps: 1800, type: "IGST", description: "Integrated GST for inter-state supply" },
    { name: "GST 5% (Training)", rateBps: 500, type: "GST", description: "Reduced rate example for training services" },
    { name: "Service Tax 15% (legacy)", rateBps: 1500, type: "OTHER", description: "Pre-GST tax kept for historical records", active: false },
  ]);
  const gstKerala = [cgst._id, sgst._id];

  /* ------------------------------------------------------------- Products */
  log("Creating products and variants…");
  const productDefs = [
    { name: "Business Management Software", type: "SOFTWARE", salesPrice: 2000, costPrice: 700, description: "All-in-one ERP for SMBs: accounting, inventory and sales.", taxes: gstKerala, variants: [["Standard", 0], ["Odoo", 560], ["Enterprise", 1000]] },
    { name: "CRM Suite", type: "SOFTWARE", salesPrice: 1500, costPrice: 450, description: "Pipeline, contacts and sales automation.", taxes: gstKerala, variants: [["Starter", 0], ["Growth", 700], ["Scale", 1500]] },
    { name: "HR & Payroll Cloud", type: "SOFTWARE", salesPrice: 1200, costPrice: 400, description: "Payroll, attendance and statutory compliance.", taxes: gstKerala, variants: [["Up to 50 staff", 0], ["Up to 200 staff", 900]] },
    { name: "Analytics Pro", type: "SOFTWARE", salesPrice: 2500, costPrice: 900, description: "Dashboards and BI on top of your business data.", taxes: [igst._id], variants: [] },
    { name: "Cloud Storage 1 TB", type: "ADD_ON", salesPrice: 400, costPrice: 180, description: "Additional encrypted storage.", taxes: gstKerala, variants: [] },
    { name: "Premium Support", type: "SUPPORT", salesPrice: 3000, costPrice: 1400, description: "Priority support with a named engineer.", taxes: gstKerala, variants: [["Business hours", 0], ["24×7", 2000]] },
    { name: "Onboarding & Training", type: "SERVICE", salesPrice: 15000, costPrice: 6000, description: "Guided implementation and team training.", taxes: [], variants: [] },
    { name: "API Access", type: "ADD_ON", salesPrice: 800, costPrice: 100, description: "REST API and webhooks for integrations.", taxes: gstKerala, variants: [] },
  ];
  const products: Record<string, { _id: mongoose.Types.ObjectId; variants: Record<string, mongoose.Types.ObjectId> }> = {};
  for (const def of productDefs) {
    const p = await Product.create({ name: def.name, type: def.type, salesPrice: rs(def.salesPrice), costPrice: rs(def.costPrice), description: def.description, taxes: def.taxes });
    const variants: Record<string, mongoose.Types.ObjectId> = {};
    for (const [vName, extra] of def.variants) {
      const v = await ProductVariant.create({ product: p._id, name: vName, extraPrice: rs(extra as number) });
      variants[vName as string] = v._id;
    }
    products[def.name] = { _id: p._id, variants };
  }
  const P = (name: string) => String(products[name]._id);
  const V = (name: string, variant: string) => String(products[name].variants[variant]);

  /* ---------------------------------------------------------------- Plans */
  log("Creating plans…");
  const planDefs = [
    { name: "Starter Monthly", billingInterval: "MONTHLY", basePrice: 0, termLength: 12, description: "Pay monthly, cancel anytime.", products: ["CRM Suite", "Cloud Storage 1 TB"], allowPause: true, allowEarlyClose: true },
    { name: "Growth Monthly", billingInterval: "MONTHLY", basePrice: 500, termLength: 12, description: "Monthly plan with platform fee and add-ons.", products: ["Business Management Software", "CRM Suite", "API Access"], allowPause: true, allowEarlyClose: true },
    { name: "Business Annual", billingInterval: "YEARLY", basePrice: 5000, termLength: 1, description: "Annual commitment with lower effective pricing.", products: ["Business Management Software", "HR & Payroll Cloud", "Analytics Pro"], allowPause: false, allowEarlyClose: false },
    { name: "Enterprise Annual", billingInterval: "YEARLY", basePrice: 20000, termLength: 2, description: "Two-year enterprise agreement with premium support.", products: ["Business Management Software", "Premium Support", "Analytics Pro"], allowPause: false, allowEarlyClose: false, minQuantity: 5 },
    { name: "Weekly Pilot", billingInterval: "WEEKLY", basePrice: 0, termLength: 8, description: "Short pilot billed weekly.", products: ["Analytics Pro"], allowPause: true, allowEarlyClose: true },
    { name: "Legacy Basic (archived)", billingInterval: "MONTHLY", basePrice: 0, termLength: 12, description: "No longer sold.", products: ["CRM Suite"], status: "ARCHIVED" },
  ];
  const plans: Record<string, string> = {};
  for (const d of planDefs) {
    const plan = await SubscriptionPlan.create({
      ...d,
      basePrice: rs(d.basePrice),
      products: d.products.map((n) => products[n]._id),
      taxes: gstKerala,
      availableFrom: addMonthsUTC(today, -24),
      status: d.status ?? "PUBLISHED",
    });
    plans[d.name] = String(plan._id);
  }

  /* ------------------------------------------------------------ Discounts */
  log("Creating discounts…");
  await Discount.insertMany([
    { name: "Annual Commitment 10%", code: "ANNUAL10", type: "PERCENTAGE", value: 1000, minPurchase: rs(20000), startDate: addMonthsUTC(today, -12), endDate: addMonthsUTC(today, 12), active: true },
    { name: "Diwali Offer ₹500 off", code: "DIWALI500", type: "FIXED", value: rs(500), minPurchase: rs(3000), startDate: addDaysUTC(today, -20), endDate: addDaysUTC(today, 5), usageLimit: 40, usageCount: 0, active: true },
    { name: "Volume 5% (10+ seats)", code: "VOLUME5", type: "PERCENTAGE", value: 500, minQuantity: 10, active: true },
    { name: "Launch Promo 15% (expired)", code: "LAUNCH15", type: "PERCENTAGE", value: 1500, startDate: addMonthsUTC(today, -14), endDate: addMonthsUTC(today, -8), active: true },
    { name: "Early Bird ₹1,000 (fully used)", code: "EARLYBIRD", type: "FIXED", value: rs(1000), usageLimit: 10, usageCount: 10, active: true },
    { name: "Storage Add-on 20%", code: "STORAGE20", type: "PERCENTAGE", value: 2000, applicableProducts: [products["Cloud Storage 1 TB"]._id], endDate: addDaysUTC(today, 4), usageLimit: 20, usageCount: 17, active: true },
  ]);

  /* ------------------------------------------------------------ Customers */
  log("Creating customers…");
  const customerDefs = [
    ["Aarav Menon", "customer@billflow.demo", "Lumen Labs Pvt Ltd", "Kochi", "Kerala", "32AAACL1234F1Z2"],
    ["Meera Krishnan", "meera@tealwave.in", "Tealwave Technologies", "Thiruvananthapuram", "Kerala", "32AABCT5678K1Z9"],
    ["Joseph Mathew", "joseph@spicetrail.co", "Spice Trail Exports", "Kozhikode", "Kerala", ""],
    ["Fathima Rahman", "fathima@nimbusmed.in", "Nimbus Medical Systems", "Kochi", "Kerala", "32AACCN4321B1Z7"],
    ["Arjun Varma", "arjun@coastalfreight.in", "Coastal Freight Lines", "Alappuzha", "Kerala", ""],
    ["Sneha Iyer", "sneha@brightpath.edu", "BrightPath Academy", "Bengaluru", "Karnataka", "29AABCB9988C1Z3"],
    ["Vikram Shetty", "vikram@ironleaf.io", "IronLeaf Robotics", "Mangaluru", "Karnataka", ""],
    ["Ananya Das", "ananya@lotuscare.in", "Lotus Care Hospitals", "Chennai", "Tamil Nadu", "33AADCL7766D1Z1"],
    ["Rohan Kapoor", "rohan@quillstack.com", "QuillStack Media", "Mumbai", "Maharashtra", ""],
    ["Lakshmi Nair", "lakshmi@greenroots.org", "GreenRoots Agritech", "Thrissur", "Kerala", ""],
    ["Kabir Singh", "kabir@urbannest.in", "UrbanNest Realty", "Pune", "Maharashtra", "27AAECU3344E1Z6"],
    ["Divya Menon", "divya@pixelforge.in", "PixelForge Studios", "Kochi", "Kerala", ""],
    ["Thomas George", "thomas@backwaterstays.com", "Backwater Stays", "Kumarakom", "Kerala", ""],
    ["Priya Raman", "priya@finchlogistics.in", "Finch Logistics", "Hyderabad", "Telangana", "36AAFCF1122G1Z4"],
    ["Nikhil Joshi", "nikhil@orbitpay.dev", "Orbit Devworks", "Ahmedabad", "Gujarat", ""],
  ];
  const customers: { _id: mongoose.Types.ObjectId; name: string }[] = [];
  for (let i = 0; i < customerDefs.length; i++) {
    const [name, email, company, city, state, gstin] = customerDefs[i];
    const c = await Customer.create({
      name,
      email,
      phone: `+91 98${String(4700000 + i * 13579).slice(0, 8)}`,
      companyName: company,
      billingAddress: { line1: `${12 + i}, ${["MG Road", "Infopark Phase 2", "Technopark", "Beach Road", "Marine Drive"][i % 5]}`, city, state, postalCode: String(682001 + i * 7), country: "India" },
      taxId: gstin || undefined,
      status: "ACTIVE",
      assignedStaff: i % 3 === 2 ? staff2._id : staff._id,
    });
    await Customer.collection.updateOne({ _id: c._id }, { $set: { createdAt: addDaysUTC(today, -(330 - i * 21)) } });
    customers.push({ _id: c._id, name });
  }
  const demoCustomerUser = await User.create({ name: "Aarav Menon", email: "customer@billflow.demo", passwordHash, role: "CUSTOMER", customer: customers[0]._id });
  await Customer.updateOne({ _id: customers[0]._id }, { $set: { user: demoCustomerUser._id } });

  /* -------------------------------------------------------- Subscriptions */
  log("Creating subscriptions…");
  type SubDef = {
    c: number;
    plan: string;
    lines: { product: string; variant?: string; quantity: number; unitPrice?: number }[];
    start: Date;
    status: "DRAFT" | "QUOTATION" | "CONFIRMED" | "ACTIVE" | "PAUSED" | "CLOSED";
    terms?: number;
  };
  const m = (n: number) => addMonthsUTC(today, -n);
  const subDefs: SubDef[] = [
    // Active monthly subscriptions (generate the bulk of invoices)
    { c: 0, plan: "Growth Monthly", lines: [{ product: P("Business Management Software"), variant: V("Business Management Software", "Odoo"), quantity: 3 }, { product: P("API Access"), quantity: 1 }], start: addDaysUTC(m(3), 4), status: "ACTIVE" },
    { c: 1, plan: "Starter Monthly", lines: [{ product: P("CRM Suite"), variant: V("CRM Suite", "Growth"), quantity: 5 }, { product: P("Cloud Storage 1 TB"), quantity: 2 }], start: addDaysUTC(m(4), 9), status: "ACTIVE" },
    { c: 2, plan: "Starter Monthly", lines: [{ product: P("CRM Suite"), variant: V("CRM Suite", "Starter"), quantity: 2 }], start: addDaysUTC(m(2), 2), status: "ACTIVE" },
    { c: 3, plan: "Growth Monthly", lines: [{ product: P("Business Management Software"), variant: V("Business Management Software", "Enterprise"), quantity: 10 }, { product: P("CRM Suite"), variant: V("CRM Suite", "Scale"), quantity: 10 }], start: addDaysUTC(m(3), 12), status: "ACTIVE" },
    { c: 4, plan: "Starter Monthly", lines: [{ product: P("CRM Suite"), variant: V("CRM Suite", "Starter"), quantity: 3 }, { product: P("Cloud Storage 1 TB"), quantity: 1 }], start: addDaysUTC(m(2), 15), status: "ACTIVE" },
    { c: 6, plan: "Growth Monthly", lines: [{ product: P("Business Management Software"), variant: V("Business Management Software", "Standard"), quantity: 4 }], start: addDaysUTC(m(1), 6), status: "ACTIVE" },
    { c: 9, plan: "Starter Monthly", lines: [{ product: P("CRM Suite"), variant: V("CRM Suite", "Growth"), quantity: 2 }], start: addDaysUTC(m(1), 10), status: "ACTIVE" },
    // Active yearly subscriptions
    { c: 5, plan: "Business Annual", lines: [{ product: P("Business Management Software"), variant: V("Business Management Software", "Enterprise"), quantity: 12 }, { product: P("HR & Payroll Cloud"), variant: V("HR & Payroll Cloud", "Up to 200 staff"), quantity: 1 }], start: addDaysUTC(m(7), 3), status: "ACTIVE" },
    { c: 7, plan: "Enterprise Annual", lines: [{ product: P("Business Management Software"), variant: V("Business Management Software", "Enterprise"), quantity: 25 }, { product: P("Premium Support"), variant: V("Premium Support", "24×7"), quantity: 5 }], start: addDaysUTC(m(10), 1), status: "ACTIVE", terms: 30 },
    { c: 10, plan: "Business Annual", lines: [{ product: P("Analytics Pro"), quantity: 6 }, { product: P("HR & Payroll Cloud"), variant: V("HR & Payroll Cloud", "Up to 50 staff"), quantity: 2 }], start: addDaysUTC(addMonthsUTC(today, -12), 5), status: "ACTIVE" }, // expires in ~5 days
    { c: 12, plan: "Business Annual", lines: [{ product: P("Business Management Software"), variant: V("Business Management Software", "Standard"), quantity: 5 }], start: addDaysUTC(m(2), 20), status: "ACTIVE" },
    // Below-cost negotiated pricing (revenue leakage for Revenue Guard)
    { c: 11, plan: "Starter Monthly", lines: [{ product: P("CRM Suite"), variant: V("CRM Suite", "Starter"), quantity: 8, unitPrice: rs(400) }], start: addDaysUTC(m(2), 8), status: "ACTIVE" },
    // Weekly pilot
    { c: 13, plan: "Weekly Pilot", lines: [{ product: P("Analytics Pro"), quantity: 1 }], start: addDaysUTC(today, -20), status: "ACTIVE" },
    // Customer 0 second subscription (for the portal)
    { c: 0, plan: "Starter Monthly", lines: [{ product: P("Cloud Storage 1 TB"), quantity: 3 }], start: addDaysUTC(m(1), 1), status: "ACTIVE" },
    { c: 8, plan: "Starter Monthly", lines: [{ product: P("CRM Suite"), variant: V("CRM Suite", "Growth"), quantity: 4 }], start: addDaysUTC(m(2), 18), status: "ACTIVE" },
    // Paused
    { c: 8, plan: "Weekly Pilot", lines: [{ product: P("Analytics Pro"), quantity: 2 }], start: addDaysUTC(today, -28), status: "PAUSED" },
    { c: 2, plan: "Starter Monthly", lines: [{ product: P("Cloud Storage 1 TB"), quantity: 5 }], start: addDaysUTC(m(1), -3), status: "PAUSED" },
    // Pipeline stages
    { c: 9, plan: "Growth Monthly", lines: [{ product: P("Business Management Software"), variant: V("Business Management Software", "Odoo"), quantity: 2 }], start: addDaysUTC(today, 7), status: "DRAFT" },
    { c: 13, plan: "Business Annual", lines: [{ product: P("HR & Payroll Cloud"), variant: V("HR & Payroll Cloud", "Up to 200 staff"), quantity: 1 }], start: addDaysUTC(today, 14), status: "DRAFT" },
    { c: 6, plan: "Business Annual", lines: [{ product: P("Analytics Pro"), quantity: 3 }], start: addDaysUTC(today, 10), status: "QUOTATION" },
    { c: 11, plan: "Growth Monthly", lines: [{ product: P("CRM Suite"), variant: V("CRM Suite", "Scale"), quantity: 6 }], start: addDaysUTC(today, 5), status: "QUOTATION" },
    { c: 1, plan: "Business Annual", lines: [{ product: P("Analytics Pro"), quantity: 2 }], start: addDaysUTC(today, 3), status: "CONFIRMED" },
    { c: 12, plan: "Starter Monthly", lines: [{ product: P("API Access"), quantity: 2 }], start: addDaysUTC(today, 1), status: "CONFIRMED" },
    // Closed
    { c: 3, plan: "Starter Monthly", lines: [{ product: P("CRM Suite"), variant: V("CRM Suite", "Starter"), quantity: 2 }], start: m(9), status: "CLOSED" },
    { c: 14, plan: "Starter Monthly", lines: [{ product: P("CRM Suite"), variant: V("CRM Suite", "Starter"), quantity: 1 }], start: m(8), status: "CLOSED" },
  ];

  const subIds: string[] = [];
  for (const d of subDefs) {
    const lines = await buildLineSnapshots(d.lines, { allowPriceOverride: true });
    const fee = await planFeeLine(plans[d.plan]);
    const sub = await createSubscription({
      customerId: String(customers[d.c]._id),
      planId: plans[d.plan],
      lines: fee ? [fee, ...lines] : lines,
      startDate: d.start,
      paymentTermsDays: d.terms ?? 15,
      status: d.status === "DRAFT" || d.status === "QUOTATION" ? d.status : "CONFIRMED",
      actor,
      skipAvailabilityCheck: true,
    });
    subIds.push(String(sub._id));
    if (["ACTIVE", "PAUSED", "CLOSED"].includes(d.status)) {
      await Subscription.updateOne(
        { _id: sub._id },
        { $set: { status: "ACTIVE", activatedAt: d.start }, $push: { history: { from: "CONFIRMED", to: "ACTIVE", at: d.start, byName: admin.name } } }
      );
    }
  }

  /* -------------------------------------------- Historical closed subscriptions */
  // Bill the closed ones for a few months, then close them in the past.
  log("Running the billing engine for historical periods…");
  const closedIdx = subDefs.map((d, i) => (d.status === "CLOSED" ? i : -1)).filter((i) => i >= 0);
  const otherActive = subDefs.map((d, i) => (d.status !== "CLOSED" && ["ACTIVE", "PAUSED"].includes(d.status) ? i : -1)).filter((i) => i >= 0);
  // Temporarily park the others so the historical run only touches the closed subscriptions.
  await Subscription.updateMany({ _id: { $in: otherActive.map((i) => subIds[i]) } }, { $set: { status: "CONFIRMED" } });
  await runBilling({ asOf: m(6), trigger: "SEED", actor });
  for (const i of closedIdx) {
    await Subscription.updateOne(
      { _id: subIds[i] },
      { $set: { status: "CLOSED", closedAt: m(6), closeReason: i === closedIdx[0] ? "Customer upgraded to Growth Monthly" : "Customer churned", nextBillingDate: null }, $push: { history: { from: "ACTIVE", to: "CLOSED", at: m(6), byName: admin.name, note: "Closed early" } } }
    );
  }
  await Subscription.updateMany({ _id: { $in: otherActive.map((i) => subIds[i]) } }, { $set: { status: "ACTIVE" } });

  // Paused subscriptions: bill up to their pause date, then pause.
  const pausedIdx = subDefs.map((d, i) => (d.status === "PAUSED" ? i : -1)).filter((i) => i >= 0);
  const pausedAt = addDaysUTC(today, -9);
  await Subscription.updateMany({ _id: { $in: otherActive.filter((i) => !pausedIdx.includes(i)).map((i) => subIds[i]) } }, { $set: { status: "CONFIRMED" } });
  await runBilling({ asOf: pausedAt, trigger: "SEED", actor });
  for (const i of pausedIdx) {
    await Subscription.updateOne({ _id: subIds[i] }, { $set: { status: "PAUSED", pausedAt }, $push: { history: { from: "ACTIVE", to: "PAUSED", at: pausedAt, byName: admin.name, note: "Customer requested a pause" } } });
  }
  await Subscription.updateMany({ _id: { $in: otherActive.filter((i) => !pausedIdx.includes(i)).map((i) => subIds[i]) } }, { $set: { status: "ACTIVE" } });

  // Everything active: bill up to today.
  await runBilling({ asOf: today, trigger: "SEED", actor });

  /* -------------------------------------------------------------- Payments */
  log("Recording payments…");
  const latePayers = new Set([String(customers[4]._id), String(customers[11]._id)]);
  const invoices = await Invoice.find({ status: "CONFIRMED" }).sort({ invoiceDate: 1 }).lean();
  let k = 0;
  for (const inv of invoices) {
    k++;
    const age = Math.round((today.getTime() - new Date(inv.invoiceDate).getTime()) / 86400000);
    const late = latePayers.has(String(inv.customer));
    const methods = ["BANK_TRANSFER", "UPI", "CARD", "BANK_TRANSFER", "UPI", "CASH"] as const;
    const method = methods[k % methods.length];
    if (late) {
      // Late payers: older invoices paid well after the due date; recent ones left overdue.
      if (age > 40) {
        await recordPayment({ invoiceId: String(inv._id), amount: inv.amountDue, method, paymentDate: addDaysUTC(new Date(inv.dueDate), 12 + (k % 9)), transactionRef: `TXN${100000 + k}`, actor });
      }
      continue;
    }
    if (age > 25) {
      if (k % 7 === 0) continue; // a few genuinely overdue invoices
      await recordPayment({ invoiceId: String(inv._id), amount: inv.amountDue, method, paymentDate: addDaysUTC(new Date(inv.invoiceDate), 3 + (k % 10)), transactionRef: `TXN${100000 + k}`, actor });
    } else if (age > 8 && k % 3 === 0) {
      // Partial payment example
      const part = Math.floor(inv.amountDue / 2);
      await recordPayment({ invoiceId: String(inv._id), amount: part, method: "UPI", paymentDate: addDaysUTC(new Date(inv.invoiceDate), 4), transactionRef: `UPI${200000 + k}`, notes: "First instalment", actor });
    }
  }

  /* --------------------------------------------------- Planted revenue issues */
  log("Planting revenue issues for Revenue Guard…");
  // 1) Active subscription that missed billing (nextBillingDate in the past, never billed).
  const missed = await buildLineSnapshots([{ product: P("HR & Payroll Cloud"), variant: V("HR & Payroll Cloud", "Up to 200 staff"), quantity: 3 }]);
  const missedSub = await createSubscription({ customerId: String(customers[9]._id), planId: plans["Starter Monthly"], lines: missed, startDate: addDaysUTC(today, -38), paymentTermsDays: 15, status: "CONFIRMED", actor, skipAvailabilityCheck: true });
  await Subscription.updateOne({ _id: missedSub._id }, { $set: { status: "ACTIVE", activatedAt: addDaysUTC(today, -38) }, $push: { history: { from: "CONFIRMED", to: "ACTIVE", at: addDaysUTC(today, -38), byName: admin.name } } });

  // 2) Manual duplicate of an engine invoice (same subscription & period, entered by hand).
  const original = await Invoice.findOne({ source: "BILLING_ENGINE", customer: customers[1]._id }).sort({ invoiceDate: -1 }).lean();
  if (original) {
    const lines = await InvoiceLine.find({ invoice: original._id }).sort({ position: 1 }).lean();
    await createInvoice({
      customerId: String(original.customer),
      lines: lines.map((l) => ({ product: l.product ? String(l.product) : undefined, productName: l.productName, variant: l.variant ? String(l.variant) : undefined, variantName: l.variantName ?? undefined, quantity: l.quantity, unitPrice: l.unitPrice, taxes: (l.taxes ?? []).map((t: { tax?: unknown; name?: string | null; type?: string | null; rateBps?: number | null }) => ({ tax: t.tax ? String(t.tax) : undefined, name: t.name!, type: t.type!, rateBps: t.rateBps! })) })),
      invoiceDate: addDaysUTC(new Date(original.invoiceDate), 1),
      paymentTermsDays: 15,
      status: "CONFIRMED",
      source: "MANUAL",
      subscription: { id: String(original.subscription), number: original.subscriptionNumber! },
      periodStart: original.periodStart!,
      periodEnd: original.periodEnd!,
      notes: "Entered manually",
      actor: { id: String(staff._id), name: staff.name, email: staff.email, role: "STAFF" },
    });
  }

  /* ----------------------------------------------- Quotations & templates */
  log("Creating quotations and templates…");
  const tpl1 = await QuotationTemplate.create({ name: "SMB Growth Bundle", description: "ERP + CRM + API for growing teams", plan: plans["Growth Monthly"], validityDays: 30, lines: [{ product: P("Business Management Software"), variant: V("Business Management Software", "Odoo"), quantity: 5 }, { product: P("CRM Suite"), variant: V("CRM Suite", "Growth"), quantity: 5 }, { product: P("API Access"), quantity: 1 }], notes: "Includes free onboarding call." });
  await QuotationTemplate.create({ name: "Enterprise Annual Package", description: "Enterprise ERP with 24×7 support", plan: plans["Enterprise Annual"], validityDays: 45, lines: [{ product: P("Business Management Software"), variant: V("Business Management Software", "Enterprise"), quantity: 20 }, { product: P("Premium Support"), variant: V("Premium Support", "24×7"), quantity: 5 }] });

  const quoteDefs: { c: number; plan: string; lines: { product: string; variant?: string; quantity: number }[]; date: Date; status: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED"; subIndex?: number; template?: boolean }[] = [
    { c: 1, plan: "Business Annual", lines: [{ product: P("Analytics Pro"), quantity: 2 }], date: addDaysUTC(today, -12), status: "ACCEPTED", subIndex: 21 },
    { c: 6, plan: "Business Annual", lines: [{ product: P("Analytics Pro"), quantity: 3 }], date: addDaysUTC(today, -6), status: "SENT" },
    { c: 12, plan: "Growth Monthly", lines: [{ product: P("Business Management Software"), variant: V("Business Management Software", "Odoo"), quantity: 5 }, { product: P("CRM Suite"), variant: V("CRM Suite", "Growth"), quantity: 5 }, { product: P("API Access"), quantity: 1 }], date: addDaysUTC(today, -3), status: "SENT", template: true },
    { c: 7, plan: "Enterprise Annual", lines: [{ product: P("Premium Support"), variant: V("Premium Support", "24×7"), quantity: 10 }], date: addDaysUTC(today, -1), status: "DRAFT" },
    { c: 10, plan: "Growth Monthly", lines: [{ product: P("CRM Suite"), variant: V("CRM Suite", "Scale"), quantity: 12 }], date: addDaysUTC(today, -20), status: "REJECTED" },
    { c: 4, plan: "Starter Monthly", lines: [{ product: P("CRM Suite"), variant: V("CRM Suite", "Growth"), quantity: 6 }], date: addDaysUTC(today, -50), status: "EXPIRED" },
  ];
  for (const q of quoteDefs) {
    const fee = await planFeeLine(plans[q.plan]);
    const lines = await buildLineSnapshots(q.lines);
    const totals = computeTotals(fee ? [fee, ...lines] : lines);
    const plan = await SubscriptionPlan.findById(plans[q.plan]).lean();
    const customer = await Customer.findById(customers[q.c]._id).lean();
    const quote = await Quotation.create({
      number: await nextNumber("QT"),
      customer: customer!._id,
      customerSnapshot: { name: customer!.name, email: customer!.email, companyName: customer!.companyName },
      plan: plan!._id,
      planSnapshot: { name: plan!.name, billingInterval: plan!.billingInterval, basePrice: plan!.basePrice, termLength: plan!.termLength },
      template: q.template ? tpl1._id : undefined,
      quotationDate: q.date,
      validityDays: 30,
      expiryDate: addDaysUTC(q.date, 30),
      lines: totals.lines,
      discounts: totals.discounts,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      taxTotal: totals.taxTotal,
      total: totals.total,
      status: q.status,
      subscription: q.subIndex != null ? subIds[q.subIndex] : undefined,
      history: [{ to: "DRAFT", at: q.date, byName: staff.name }, ...(q.status !== "DRAFT" ? [{ from: "DRAFT", to: q.status, at: addDaysUTC(q.date, 1), byName: staff.name }] : [])],
      createdBy: staff._id,
    });
    if (q.subIndex != null) await Subscription.updateOne({ _id: subIds[q.subIndex] }, { $set: { quotation: quote._id } });
  }

  await Customer.updateOne({ _id: customers[14]._id }, { $set: { status: "INACTIVE" } }); // churned customer

  /* --------------------------------------------------- Customer requests */
  await SubscriptionRequest.create({ subscription: subIds[13], customer: customers[0]._id, type: "PAUSE", message: "We are moving offices next month — please pause storage for 30 days." });

  const counts = {
    customers: await Customer.countDocuments(),
    products: await Product.countDocuments(),
    variants: await ProductVariant.countDocuments(),
    plans: await SubscriptionPlan.countDocuments(),
    subscriptions: await Subscription.countDocuments(),
    invoices: await Invoice.countDocuments(),
    payments: await Payment.countDocuments(),
    quotations: await Quotation.countDocuments(),
  };
  log(`Done: ${JSON.stringify(counts)}`);
  return counts;
}

/** Helper for interval math in seed scenarios (exported for tests). */
export function periodsBetween(start: Date, end: Date, interval: BillingInterval) {
  let n = 0;
  for (let d = start; d <= end; d = addInterval(d, interval)) n++;
  return n;
}
