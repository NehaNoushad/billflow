"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/utils-server";

type Props = {
  action: (input?: string) => Promise<ActionResult<unknown>>;
  children: React.ReactNode;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
  /** If set, shows a confirmation dialog first. */
  confirm?: { title: string; description: string; confirmLabel?: string; destructive?: boolean; reasonLabel?: string; reasonRequired?: boolean };
  successMessage?: string;
  redirectTo?: string;
  disabled?: boolean;
  title?: string;
};

/**
 * Calls a server action with loading state, optional confirmation (and optional reason text),
 * toast feedback, and a refresh so server components show the new data.
 */
export function ActionButton({ action, children, variant = "outline", size = "sm", className, confirm, successMessage, redirectTo, disabled, title }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const run = () => {
    startTransition(async () => {
      const res = await action(confirm?.reasonLabel ? reason : undefined);
      if (res.ok) {
        toast.success(res.message ?? successMessage ?? "Done");
        setOpen(false);
        setReason("");
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} disabled={disabled || pending} title={title} onClick={() => (confirm ? setOpen(true) : run())}>
        {pending && !confirm ? <Loader2 className="size-4 animate-spin" /> : null}
        {children}
      </Button>
      {confirm && (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirm.title}</AlertDialogTitle>
              <AlertDialogDescription>{confirm.description}</AlertDialogDescription>
            </AlertDialogHeader>
            {confirm.reasonLabel && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="action-reason">
                  {confirm.reasonLabel}
                </label>
                <Textarea id="action-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <Button variant={confirm.destructive ? "destructive" : "default"} onClick={run} disabled={pending || (!!confirm.reasonRequired && reason.trim().length < 3)}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                {confirm.confirmLabel ?? "Confirm"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
