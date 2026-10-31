import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate, applyBps, roundDiv, toPaise, toRupeeString } from "@/lib/money";
import { computeTotals, discountIneligibility, type DiscountRule, type LineInput } from "@/lib/billing/calc";
import { addInterval, addMonthsUTC, parseDateInput } from "@/lib/dates";

const gst = [
  { name: "CGST 9%", type: "CGST", rateBps: 900 },
  { name: "SGST 9%", type: "SGST", rateBps: 900 },
];
const line = (over: Partial<LineInput> = {}): LineInput => ({ product: "p1", productName: "Business Management Software", quantity: 1, unitPrice: 200000, taxes: gst, ...over });

test("money helpers are integer-exact", () => {
  assert.equal(toPaise("1,234.5"), 123450);
  assert.equal(toPaise("0.1"), 10);
  assert.equal(toPaise(2560), 256000);
  assert.throws(() => toPaise("12.345"));
  assert.equal(toRupeeString(123405), "1234.05");
  assert.equal(roundDiv(5, 2), 3); // half away from zero
  assert.equal(roundDiv(-5, 2), -3);
  assert.equal(applyBps(10001, 1800), 1800); // 1800.18 → 1800
  assert.equal(applyBps(25, 1800), 5); // 4.5 → 5
  const parts = allocate(100, [1, 1, 1]);
  assert.equal(parts.reduce((a, b) => a + b, 0), 100);
});

test("variant pricing example from the brief: ₹2,000 + Odoo ₹560 with 18% GST", () => {
  const t = computeTotals([line({ unitPrice: 200000 + 56000 })]);
  assert.equal(t.subtotal, 256000);
  assert.equal(t.taxTotal, 46080); // 9% + 9% of ₹2,560
  assert.equal(t.total, 302080);
  assert.deepEqual(t.taxBreakdown.map((b) => b.amount), [23040, 23040]);
});

test("percentage discount reduces the taxable amount", () => {
  const rule: DiscountRule = { _id: "d1", name: "10% off", type: "PERCENTAGE", value: 1000 };
  const t = computeTotals([line({ quantity: 2, unitPrice: 150000 })], [rule], { on: new Date() });
  assert.equal(t.subtotal, 300000);
  assert.equal(t.discountTotal, 30000);
  assert.equal(t.taxTotal, 48600); // 18% of 2,70,000 paise
  assert.equal(t.total, 318600);
});

test("discount never exceeds the eligible amount", () => {
  const huge: DiscountRule = { _id: "d1", name: "₹1L off", type: "FIXED", value: 10_000_000 };
  const t = computeTotals([line({ unitPrice: 50000 })], [huge], { on: new Date() });
  assert.equal(t.discountTotal, 50000);
  assert.equal(t.total, 0);
  // Stacked discounts are capped by what remains.
  const a: DiscountRule = { _id: "a", name: "60%", type: "PERCENTAGE", value: 6000 };
  const b: DiscountRule = { _id: "b", name: "60%", type: "PERCENTAGE", value: 6000 };
  const t2 = computeTotals([line({ unitPrice: 100000, taxes: [] })], [a, b], { on: new Date() });
  assert.equal(t2.discountTotal, 84000); // 60% then 60% of the remaining 40%
  assert.ok(t2.total >= 0);
});

test("discount eligibility: dates, usage limit, minimums, products", () => {
  const on = parseDateInput("2026-06-15");
  const base: DiscountRule = { _id: "d", name: "x", type: "FIXED", value: 1000 };
  const lines = [line({ quantity: 3, unitPrice: 100000 })];
  assert.equal(discountIneligibility({ ...base, endDate: parseDateInput("2026-06-01") }, lines, { on }), "Discount has expired");
  assert.equal(discountIneligibility({ ...base, startDate: parseDateInput("2026-07-01") }, lines, { on }), "Discount has not started");
  assert.equal(discountIneligibility({ ...base, usageLimit: 5, usageCount: 5 }, lines, { on }), "Usage limit reached");
  assert.equal(discountIneligibility({ ...base, minPurchase: 500000 }, lines, { on }), "Minimum purchase not met");
  assert.equal(discountIneligibility({ ...base, minQuantity: 10 }, lines, { on }), "Minimum quantity not met");
  assert.equal(discountIneligibility({ ...base, applicableProducts: ["other"] }, lines, { on }), "No eligible products");
  assert.equal(discountIneligibility({ ...base, applicableSubscriptions: ["s1"] }, lines, { on, subscriptionId: "s2" }), "Not applicable to this subscription");
  assert.equal(discountIneligibility(base, lines, { on }), null);
});

test("product-specific discount only touches eligible lines", () => {
  const rule: DiscountRule = { _id: "d", name: "Storage 20%", type: "PERCENTAGE", value: 2000, applicableProducts: ["storage"] };
  const t = computeTotals([line({ product: "erp", unitPrice: 100000 }), line({ product: "storage", productName: "Storage", unitPrice: 40000 })], [rule], { on: new Date() });
  assert.equal(t.lines[0].discountAmount, 0);
  assert.equal(t.lines[1].discountAmount, 8000);
});

test("billing intervals clamp month ends and keep the anchor day", () => {
  const jan31 = parseDateInput("2026-01-31");
  const feb = addInterval(jan31, "MONTHLY", 1, 31);
  assert.equal(feb.toISOString().slice(0, 10), "2026-02-28");
  assert.equal(addInterval(feb, "MONTHLY", 1, 31).toISOString().slice(0, 10), "2026-03-31");
  assert.equal(addInterval(jan31, "WEEKLY").toISOString().slice(0, 10), "2026-02-07");
  assert.equal(addInterval(jan31, "DAILY").toISOString().slice(0, 10), "2026-02-01");
  assert.equal(addMonthsUTC(parseDateInput("2024-02-29"), 12).toISOString().slice(0, 10), "2025-02-28");
});
