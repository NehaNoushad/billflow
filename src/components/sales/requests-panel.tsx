import Link from "next/link";
import { Check, X } from "lucide-react";
import { formatDateTime } from "@/lib/dates";
import { humanize } from "@/lib/constants";
import { resolveRequestAction } from "@/actions/subscriptions";
import { ActionButton } from "@/components/app/action-button";
import { Panel, Tone } from "@/components/app/ui-bits";

export type RequestRow = {
  _id: string;
  type: string;
  message?: string;
  createdAt: string | Date;
  subscriptionId: string;
  subscriptionNumber?: string;
  customerName?: string;
  targetPlanName?: string;
};

const EFFECT: Record<string, string> = {
  PAUSE: "Approving pauses the subscription; billing stops until it is resumed.",
  RESUME: "Approving resumes billing; the next billing date shifts forward by the paused time.",
  CANCEL: "Approving closes the subscription. No further invoices are generated.",
  PLAN_CHANGE: "Approving closes this subscription and creates a confirmed one on the new plan starting today.",
};

export function RequestsPanel({ requests, showSubscription = true }: { requests: RequestRow[]; showSubscription?: boolean }) {
  if (!requests.length) return null;
  return (
    <Panel title={`Pending customer requests (${requests.length})`} className="border-amber-200" bodyClassName="p-0">
      <ul className="divide-y">
        {requests.map((r) => (
          <li key={r._id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <Tone tone="amber">{humanize(r.type)}</Tone>
                {showSubscription && (
                  <Link href={`/subscriptions/${r.subscriptionId}`} className="text-primary hover:underline">
                    {r.subscriptionNumber}
                  </Link>
                )}
                {r.customerName && <span className="text-muted-foreground">· {r.customerName}</span>}
                {r.targetPlanName && <span className="text-muted-foreground">→ {r.targetPlanName}</span>}
              </p>
              {r.message && <p className="mt-1 text-sm text-muted-foreground">“{r.message}”</p>}
              <p className="mt-0.5 text-xs text-muted-foreground">Requested {formatDateTime(r.createdAt)}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <ActionButton action={resolveRequestAction.bind(null, r._id, false)} confirm={{ title: "Reject request?", description: "The subscription stays unchanged.", destructive: true, confirmLabel: "Reject", reasonLabel: "Note to record (optional)" }}>
                <X className="size-4" /> Reject
              </ActionButton>
              <ActionButton action={resolveRequestAction.bind(null, r._id, true)} variant="default" confirm={{ title: `Approve ${humanize(r.type).toLowerCase()} request?`, description: EFFECT[r.type] ?? "", confirmLabel: "Approve", reasonLabel: "Note to record (optional)" }}>
                <Check className="size-4" /> Approve
              </ActionButton>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
