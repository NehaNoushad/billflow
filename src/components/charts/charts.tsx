"use client";

import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney, formatMoneyCompact } from "@/lib/money";

// Categorical slots in fixed order (validated with the dataviz palette validator, light mode).
export const SERIES = ["#4f46e5", "#1baf7a", "#eb6834", "#2a78d6", "#eda100"];
// Reserved status colours — always paired with a text label in the legend.
export const STATUS_COLORS: Record<string, string> = {
  Paid: "#0ca30c",
  "Outstanding (not due)": "#fab219",
  Overdue: "#d03b3b",
  Draft: "#9ca3af",
  Cancelled: "#d1d5db",
};

const GRID = "#e8e8ef";
const AXIS = { fontSize: 11, fill: "#6b6b80" };

type TooltipRow = { name?: string | number; value?: number | string; color?: string; dataKey?: string | number; payload?: Record<string, unknown> };

function ChartTooltip({ active, payload, label, kind = "money" }: { active?: boolean; payload?: TooltipRow[]; label?: string | number; kind?: "money" | "count" }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-white px-3 py-2 text-xs shadow-md">
      {label !== undefined && <p className="mb-1 font-medium text-foreground">{label}</p>}
      {payload.map((p) => (
        <div key={String(p.dataKey ?? p.name)} className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto pl-3 font-medium tabular-nums text-foreground">{kind === "money" ? formatMoney(Number(p.value)) : Number(p.value).toLocaleString("en-IN")}</span>
        </div>
      ))}
    </div>
  );
}

function Empty({ height }: { height: number }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground" style={{ height }}>
      No data for this period
    </div>
  );
}

const legendStyle = { fontSize: 12, paddingTop: 8 };

/** Invoiced vs collected per month (grouped bars, single ₹ axis). */
export function RevenueChart({ data, height = 280 }: { data: { label: string; invoiced: number; collected: number }[]; height?: number }) {
  if (!data.some((d) => d.invoiced || d.collected)) return <Empty height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} barGap={2} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => formatMoneyCompact(v)} width={64} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(79,70,229,0.06)" }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={legendStyle} itemSorter={null} />
        <Bar dataKey="invoiced" name="Invoiced" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={22} />
        <Bar dataKey="collected" name="Collected" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** New vs closed subscriptions per month. */
export function SubscriptionGrowthChart({ data, height = 260 }: { data: { label: string; added: number; closed: number }[]; height?: number }) {
  if (!data.some((d) => d.added || d.closed)) return <Empty height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} barGap={2} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip content={<ChartTooltip kind="count" />} cursor={{ fill: "rgba(79,70,229,0.06)" }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={legendStyle} itemSorter={null} />
        <Bar dataKey="added" name="New" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={18} />
        <Bar dataKey="closed" name="Closed" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Single-series trend line (MRR, active subscriptions, customers). */
export function TrendLine({ data, dataKey, name, kind = "money", height = 260 }: { data: Record<string, string | number>[]; dataKey: string; name: string; kind?: "money" | "count"; height?: number }) {
  if (!data.some((d) => Number(d[dataKey]))) return <Empty height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: kind === "money" ? 0 : -16, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={kind === "money" ? 64 : 40} tickFormatter={(v) => (kind === "money" ? formatMoneyCompact(v) : String(v))} />
        <Tooltip content={<ChartTooltip kind={kind} />} cursor={{ stroke: "#c7c7d4", strokeDasharray: "3 3" }} />
        <Line isAnimationActive={false} type="monotone" dataKey={dataKey} name={name} stroke={SERIES[0]} strokeWidth={2} dot={{ r: 3, fill: SERIES[0], stroke: "#fff", strokeWidth: 2 }} activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Invoice status distribution donut with a labelled legend (count + amount). */
export function StatusDonut({ data, height = 220 }: { data: { name: string; count: number; amount: number }[]; height?: number }) {
  const rows = data.filter((d) => d.count > 0);
  if (!rows.length) return <Empty height={height} />;
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative w-full sm:w-1/2" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} dataKey="count" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={1.5} stroke="#fff" strokeWidth={2}>
              {rows.map((r) => (
                <Cell key={r.name} fill={STATUS_COLORS[r.name] ?? SERIES[3]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip kind="count" />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums">{total}</span>
          <span className="text-xs text-muted-foreground">invoices</span>
        </div>
      </div>
      <ul className="w-full space-y-2 text-sm sm:w-1/2">
        {data.map((r) => (
          <li key={r.name} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: STATUS_COLORS[r.name] }} />
            <span className="text-muted-foreground">{r.name}</span>
            <span className="ml-auto text-right tabular-nums">
              <span className="font-medium">{r.count}</span>
              <span className="block text-[11px] text-muted-foreground">{formatMoney(r.amount)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal bars ranked by amount (revenue by product / plan). */
export function RankedBars({ data, height }: { data: { name: string; amount: number }[]; height?: number }) {
  const h = height ?? Math.max(160, data.length * 34 + 24);
  if (!data.length) return <Empty height={160} />;
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }} barCategoryGap={6}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => formatMoneyCompact(v)} />
        <YAxis type="category" dataKey="name" tick={AXIS} tickLine={false} axisLine={false} width={150} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(79,70,229,0.06)" }} />
        <Bar dataKey="amount" name="Net revenue" fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={20} />
      </BarChart>
    </ResponsiveContainer>
  );
}
