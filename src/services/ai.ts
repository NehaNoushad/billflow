// Turns deterministic Revenue Guard findings into a plain-English summary.
// Only computed facts are sent to the model; if no provider is configured or the call fails,
// a rule-based summary is produced from the same facts, so the feature always works.
import { formatMoney } from "@/lib/money";
import type { Finding, GuardMetrics } from "./revenue-guard";

export type Narrative = { provider: "gemini" | "openai" | "rules"; summary: string; recommendations: string[]; error?: string };

const TIMEOUT_MS = 15000;

function buildPrompt(metrics: GuardMetrics, findings: Finding[]) {
  const facts = {
    currency: "INR (all amounts are in paise; divide by 100 for rupees)",
    metrics,
    findings: findings.map((f) => ({ code: f.code, severity: f.severity, title: f.title, detail: f.detail, amount: f.amount ?? null, recordCount: f.records.length })),
  };
  return [
    "You are a revenue operations analyst for a B2B SaaS company using a billing platform.",
    "Write a short executive summary (3-5 sentences) and 3-6 concrete, prioritised recommendations based ONLY on the JSON facts below.",
    "Rules: use only numbers present in the facts; never invent customers, amounts, dates or percentages; format money in Indian rupees (e.g. ₹42,500) after converting from paise; mention severity where useful.",
    'Respond with JSON only, exactly: {"summary": string, "recommendations": string[]}',
    "FACTS:",
    JSON.stringify(facts),
  ].join("\n");
}

function parseModelJson(text: string): { summary: string; recommendations: string[] } {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const obj = JSON.parse(cleaned.slice(start, end + 1));
  if (typeof obj.summary !== "string" || !Array.isArray(obj.recommendations)) throw new Error("Unexpected AI response shape");
  return { summary: obj.summary.trim(), recommendations: obj.recommendations.map(String).filter(Boolean).slice(0, 8) };
}

async function callGemini(prompt: string) {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: "application/json" } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Gemini API ${res.status}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  return parseModelJson(text);
}

async function callOpenAI(prompt: string) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`OpenAI API ${res.status}`);
  const data = await res.json();
  return parseModelJson(data?.choices?.[0]?.message?.content ?? "");
}

/** Deterministic summary from the same facts — used when no AI provider is available. */
export function ruleBasedNarrative(metrics: GuardMetrics, findings: Finding[]): Omit<Narrative, "provider"> {
  const parts: string[] = [`Your business has ${metrics.activeSubscriptions} active subscription${metrics.activeSubscriptions === 1 ? "" : "s"} generating ${formatMoney(metrics.mrr)} in monthly recurring revenue.`];
  if (metrics.overdueCount) parts.push(`${metrics.overdueCount} invoice${metrics.overdueCount === 1 ? " is" : "s are"} overdue, representing ${formatMoney(metrics.overdueAmount)} of the ${formatMoney(metrics.outstanding)} outstanding.`);
  else parts.push(`No invoices are overdue; ${formatMoney(metrics.outstanding)} is outstanding and not yet due.`);
  if (metrics.missedBillingCount) parts.push(`${metrics.missedBillingCount} active subscription${metrics.missedBillingCount === 1 ? " has" : "s have"} not been invoiced on schedule (about ${formatMoney(metrics.missedBillingAmount)} unbilled).`);
  if (metrics.duplicateInvoiceCount) parts.push(`${metrics.duplicateInvoiceCount} invoices look like duplicates.`);
  if (metrics.expiringIn7Days) parts.push(`${metrics.expiringIn7Days} subscription${metrics.expiringIn7Days === 1 ? " is" : "s are"} approaching expiry within seven days.`);
  if (metrics.revenueChangePct !== null && Math.abs(metrics.revenueChangePct) > 30) parts.push(`Invoiced revenue over the last 30 days is ${metrics.revenueChangePct > 0 ? "up" : "down"} ${Math.abs(metrics.revenueChangePct)}% against the prior 90-day average.`);

  const recs: string[] = [];
  const has = (code: string) => findings.some((f) => f.code === code);
  if (has("MISSING_INVOICES")) recs.push("Run the billing engine now and review the subscriptions that missed their billing date.");
  if (has("DUPLICATE_INVOICES")) recs.push("Review the suspected duplicate invoices and cancel the extra copies before customers pay twice.");
  if (has("OVERDUE_INVOICES")) recs.push(`Follow up with overdue customers, starting with the oldest balances (${formatMoney(metrics.overdueAmount)} overdue).`);
  if (has("LATE_PAYERS")) recs.push("Tighten payment terms or send earlier reminders to customers with repeated late payments.");
  if (has("EXPIRING_7D") || has("EXPIRING_30D")) recs.push("Contact customers whose subscriptions are approaching expiry to secure renewals.");
  if (has("BELOW_COST") || has("HEAVY_DISCOUNT") || has("ZERO_TOTAL")) recs.push("Review pricing on subscriptions sold below cost or with discounts above 50%.");
  if (has("DISCOUNT_LIMITS")) recs.push("Review discount rules nearing expiry or their usage limit and extend or retire them deliberately.");
  if (has("REVENUE_CHANGE")) recs.push("Investigate the unexpected change in invoiced revenue against recent months.");
  if (!recs.length) recs.push("No action needed — billing, collections and pricing look healthy.");
  return { summary: parts.join(" "), recommendations: recs };
}

export async function generateNarrative(metrics: GuardMetrics, findings: Finding[]): Promise<Narrative> {
  const prompt = buildPrompt(metrics, findings);
  try {
    if (process.env.GEMINI_API_KEY) return { provider: "gemini", ...(await callGemini(prompt)) };
    if (process.env.OPENAI_API_KEY) return { provider: "openai", ...(await callOpenAI(prompt)) };
  } catch (err) {
    console.error("AI narrative failed, using rule-based fallback:", err);
    return { provider: "rules", ...ruleBasedNarrative(metrics, findings), error: err instanceof Error ? err.message : "AI request failed" };
  }
  return { provider: "rules", ...ruleBasedNarrative(metrics, findings) };
}
