// Integration tests for the billing engine, payments and lifecycle rules.
// Runs against a separate database (billflow_test) so demo data is untouched.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { seedDatabase } from "@/services/seed";
import { runBilling } from "@/services/billing";
import { recordPayment } from "@/services/payments";
import { renewSubscription, transitionSubscription } from "@/services/subscriptions";
import { Invoice, Subscription } from "@/models";
import { addDaysUTC, businessToday } from "@/lib/dates";

const TEST_URI = (process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/billflow").replace(/\/[^/?]+(\?|$)/, "/billflow_test$1");

before(async () => {
  process.env.MONGODB_URI = TEST_URI;
  await mongoose.connect(TEST_URI);
  await seedDatabase();
});
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test("seeded data has no duplicate invoices per subscription period from the engine", async () => {
  const dupes = await Invoice.aggregate([
    { $match: { source: "BILLING_ENGINE" } },
    { $group: { _id: { s: "$subscription", p: "$periodStart" }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);
  assert.equal(dupes.length, 0);
});

test("billing bills missed periods once, and re-runs (even concurrent) never duplicate", async () => {
  const today = businessToday();
  const first = await runBilling({ trigger: "MANUAL", asOf: today });
  assert.ok(first!.generated >= 2, "the planted missed subscription should be caught up");
  const before = await Invoice.countDocuments();
  const [a, b] = await Promise.all([runBilling({ trigger: "MANUAL", asOf: today }), runBilling({ trigger: "MANUAL", asOf: today })]);
  assert.equal(a!.generated + b!.generated, 0);
  assert.equal(await Invoice.countDocuments(), before);
  const due = await Subscription.countDocuments({ status: "ACTIVE", nextBillingDate: { $lte: today } });
  assert.equal(due, 0, "every active subscription is billed up to date");
});

test("future-dated run bills the next periods; paused subscriptions are skipped", async () => {
  const paused = await Subscription.findOne({ status: "PAUSED" }).lean();
  const beforePaused = await Invoice.countDocuments({ subscription: paused!._id });
  const run = await runBilling({ trigger: "MANUAL", asOf: addDaysUTC(businessToday(), 10) });
  assert.ok(run!.generated > 0);
  assert.equal(await Invoice.countDocuments({ subscription: paused!._id }), beforePaused);
});

test("payments: overpayment rejected, partial then full marks PAID", async () => {
  const inv = await Invoice.findOne({ status: "CONFIRMED", amountPaid: 0, total: { $gt: 1000 } }).lean();
  assert.ok(inv);
  await assert.rejects(recordPayment({ invoiceId: String(inv!._id), amount: inv!.amountDue + 1, method: "UPI", paymentDate: new Date(), actor: null }), /exceeds/);
  const half = Math.floor(inv!.amountDue / 2);
  const r1 = await recordPayment({ invoiceId: String(inv!._id), amount: half, method: "UPI", paymentDate: new Date(), actor: null });
  assert.equal(r1.invoice.status, "CONFIRMED");
  assert.equal(r1.invoice.amountDue, inv!.amountDue - half);
  const r2 = await recordPayment({ invoiceId: String(inv!._id), amount: inv!.amountDue - half, method: "CASH", paymentDate: new Date(), actor: null });
  assert.equal(r2.invoice.status, "PAID");
  assert.equal(r2.invoice.amountDue, 0);
  await assert.rejects(recordPayment({ invoiceId: String(inv!._id), amount: 100, method: "CASH", paymentDate: new Date(), actor: null }), /already fully paid/);
});

test("concurrent payments cannot overpay an invoice", async () => {
  const inv = await Invoice.findOne({ status: "CONFIRMED", amountPaid: 0, total: { $gt: 1000 } }).lean();
  const results = await Promise.allSettled([0, 1, 2].map(() => recordPayment({ invoiceId: String(inv!._id), amount: inv!.amountDue, method: "UPI", paymentDate: new Date(), actor: null })));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const after = await Invoice.findById(inv!._id).lean();
  assert.equal(after!.amountPaid, inv!.total);
});

test("lifecycle: invalid transitions rejected; plan rules enforced; resume shifts billing", async () => {
  const draft = await Subscription.findOne({ status: "DRAFT" }).lean();
  await assert.rejects(transitionSubscription(String(draft!._id), "ACTIVE", { actor: null }), /Cannot move/);

  const annual = await Subscription.findOne({ status: "ACTIVE", "planSnapshot.allowPause": false }).lean();
  await assert.rejects(transitionSubscription(String(annual!._id), "PAUSED", { actor: null }), /does not allow pausing/);
  await assert.rejects(transitionSubscription(String(annual!._id), "CLOSED", { actor: null }), /early closure/);

  const monthly = await Subscription.findOne({ status: "ACTIVE", "planSnapshot.allowPause": true, nextBillingDate: { $ne: null } }).lean();
  const today = businessToday();
  await transitionSubscription(String(monthly!._id), "PAUSED", { actor: null, asOf: today });
  const resumed = await transitionSubscription(String(monthly!._id), "ACTIVE", { actor: null, asOf: addDaysUTC(today, 5) });
  assert.equal(new Date(resumed!.nextBillingDate!).getTime(), addDaysUTC(new Date(monthly!.nextBillingDate!), 5).getTime());

  const renewed = await renewSubscription(String(monthly!._id), null);
  assert.ok(new Date(renewed!.expiryDate!).getTime() > new Date(monthly!.expiryDate!).getTime());
});
