// All money is stored and calculated as integer paise (1 INR = 100 paise).
// Percentages are stored as basis points (18% = 1800) so no floats touch money.

/** Round half away from zero for a rational number numerator/denominator, returning an integer. */
export function roundDiv(numerator: number, denominator: number): number {
  if (denominator === 0) throw new Error("Division by zero");
  const sign = Math.sign(numerator) * Math.sign(denominator);
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  const q = Math.floor(n / d);
  const r = n - q * d;
  return sign * (r * 2 >= d ? q + 1 : q);
}

/** Apply a basis-point rate to a paise amount, e.g. applyBps(10000, 1800) = 1800 (18% of ₹100). */
export function applyBps(amountPaise: number, bps: number): number {
  return roundDiv(amountPaise * bps, 10000);
}

/** Parse a user-entered rupee string/number ("1,234.50") into integer paise. */
export function toPaise(value: string | number): number {
  const str = String(value).replace(/[,\s₹]/g, "").trim();
  if (str === "") return 0;
  if (!/^-?\d+(\.\d{0,2})?$/.test(str)) throw new Error(`Invalid amount: ${value}`);
  const negative = str.startsWith("-");
  const [whole, frac = ""] = str.replace("-", "").split(".");
  const paise = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return negative ? -paise : paise;
}

/** Paise to a plain rupee string for form inputs ("1234.50"). */
export function toRupeeString(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  return `${negative ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });
const inrCompact = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", notation: "compact", maximumFractionDigits: 1 });

/** Display paise as "₹1,234.50". Division here is display-only, never used for calculation. */
export function formatMoney(paise: number | null | undefined): string {
  return inr.format((paise ?? 0) / 100);
}

export function formatMoneyCompact(paise: number | null | undefined): string {
  return inrCompact.format((paise ?? 0) / 100);
}

/** PDF-safe money string (standard PDF fonts lack the ₹ glyph). */
export function formatMoneyPlain(paise: number): string {
  const s = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100);
  return `INR ${s}`;
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

/** Split `total` across weights so the parts sum exactly to total (largest remainder method). */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const floors = raw.map(Math.floor);
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return floors;
}
