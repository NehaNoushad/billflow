import { formatDateTime } from "@/lib/dates";
import { humanize } from "@/lib/constants";

type Entry = { from?: string | null; to: string; at?: Date | string | null; byName?: string | null; note?: string | null };

export function HistoryTimeline({ entries }: { entries: Entry[] }) {
  if (!entries.length) return <p className="text-sm text-muted-foreground">No history yet.</p>;
  return (
    <ol className="relative space-y-4 border-l pl-5">
      {[...entries].reverse().map((h, i) => (
        <li key={i} className="relative">
          <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-white bg-primary ring-1 ring-primary/30" />
          <p className="text-sm font-medium">
            {h.from && h.from !== h.to ? `${humanize(h.from)} → ${humanize(h.to)}` : humanize(h.to)}
          </p>
          {h.note && <p className="text-sm text-muted-foreground">{h.note}</p>}
          <p className="text-xs text-muted-foreground">
            {formatDateTime(h.at)} · {h.byName ?? "System"}
          </p>
        </li>
      ))}
    </ol>
  );
}
