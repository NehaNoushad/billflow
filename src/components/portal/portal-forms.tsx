"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, NativeSelect } from "@/components/app/form-bits";
import { changePasswordSchema, profileSchema, type ChangePasswordInput, type ProfileInput } from "@/validators/portal";
import { changePasswordAction, submitSubscriptionRequestAction, updateProfileAction } from "@/actions/portal";

type RequestType = "PAUSE" | "CANCEL" | "PLAN_CHANGE" | "RESUME";
const COPY: Record<RequestType, { button: string; title: string; description: string }> = {
  PAUSE: { button: "Request pause", title: "Request a pause", description: "While paused you are not billed. Billing resumes, and your term is extended, when the subscription is resumed." },
  RESUME: { button: "Request resume", title: "Resume subscription", description: "Ask us to resume billing and service for this subscription." },
  CANCEL: { button: "Request cancellation", title: "Request cancellation", description: "Our team will confirm the cancellation. Invoices already issued remain payable." },
  PLAN_CHANGE: { button: "Change plan", title: "Request a plan change", description: "Choose the plan you'd like to move to. We'll confirm pricing before switching." },
};

/** Opens a dialog to submit a pause / resume / cancel / plan-change request for one subscription. */
export function RequestButton({ subscriptionId, type, plans = [], variant = "outline" }: { subscriptionId: string; type: RequestType; plans?: { value: string; label: string }[]; variant?: "outline" | "ghost" | "destructive" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [targetPlan, setTargetPlan] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const copy = COPY[type];

  const submit = () =>
    start(async () => {
      setError(undefined);
      const res = await submitSubscriptionRequestAction({ subscriptionId, type, targetPlan: targetPlan || undefined, message });
      if (!res.ok) return setError(res.error);
      toast.success(res.message);
      setOpen(false);
      setMessage("");
      router.refresh();
    });

  return (
    <>
      <Button type="button" size="sm" variant={variant} onClick={() => setOpen(true)}>
        {copy.button}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
            {type === "PLAN_CHANGE" && (
              <Field label="New plan" htmlFor="target-plan" required>
                <NativeSelect id="target-plan" value={targetPlan} onChange={(e) => setTargetPlan(e.target.value)}>
                  <option value="">Select a plan…</option>
                  {plans.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <Field label="Message (optional)" htmlFor="req-message">
              <Textarea id="req-message" rows={3} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Anything we should know?" />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending || (type === "PLAN_CHANGE" && !targetPlan)}>
              {pending && <Loader2 className="size-4 animate-spin" />} Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ProfileForm({ defaults }: { defaults: ProfileInput }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const form = useForm({ resolver: zodResolver(profileSchema), defaultValues: defaults });
  const e = form.formState.errors;
  const onSubmit = form.handleSubmit((values) =>
    start(async () => {
      const res = await updateProfileAction(values);
      if (!res.ok) {
        for (const [k, msg] of Object.entries(res.fieldErrors ?? {})) form.setError(k as keyof ProfileInput, { message: msg });
        return void toast.error(res.error);
      }
      toast.success(res.message);
      router.refresh();
    })
  );
  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
      <Field label="Full name" htmlFor="name" error={e.name?.message} required>
        <Input id="name" {...form.register("name")} aria-invalid={!!e.name} />
      </Field>
      <Field label="Phone" htmlFor="phone" error={e.phone?.message}>
        <Input id="phone" {...form.register("phone")} aria-invalid={!!e.phone} />
      </Field>
      <Field label="Company name" htmlFor="companyName" error={e.companyName?.message}>
        <Input id="companyName" {...form.register("companyName")} />
      </Field>
      <Field label="GSTIN (optional)" htmlFor="taxId" error={e.taxId?.message}>
        <Input id="taxId" {...form.register("taxId")} aria-invalid={!!e.taxId} placeholder="32AAACL1234F1Z2" />
      </Field>
      <Field label="Address line 1" htmlFor="line1" className="sm:col-span-2">
        <Input id="line1" {...form.register("billingAddress.line1")} />
      </Field>
      <Field label="Address line 2" htmlFor="line2" className="sm:col-span-2">
        <Input id="line2" {...form.register("billingAddress.line2")} />
      </Field>
      <Field label="City" htmlFor="city">
        <Input id="city" {...form.register("billingAddress.city")} />
      </Field>
      <Field label="State" htmlFor="state">
        <Input id="state" {...form.register("billingAddress.state")} />
      </Field>
      <Field label="PIN code" htmlFor="postalCode" error={e.billingAddress?.postalCode?.message}>
        <Input id="postalCode" inputMode="numeric" {...form.register("billingAddress.postalCode")} aria-invalid={!!e.billingAddress?.postalCode} />
      </Field>
      <Field label="Country" htmlFor="country">
        <Input id="country" {...form.register("billingAddress.country")} />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />} Save changes
        </Button>
      </div>
    </form>
  );
}

export function PasswordForm() {
  const [pending, start] = useTransition();
  const form = useForm<ChangePasswordInput>({ resolver: zodResolver(changePasswordSchema), defaultValues: { currentPassword: "", password: "", confirmPassword: "" } });
  const e = form.formState.errors;
  const onSubmit = form.handleSubmit((values) =>
    start(async () => {
      const res = await changePasswordAction(values);
      if (!res.ok) {
        for (const [k, msg] of Object.entries(res.fieldErrors ?? {})) form.setError(k as keyof ChangePasswordInput, { message: msg });
        return void toast.error(res.error);
      }
      toast.success(res.message);
      form.reset();
    })
  );
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field label="Current password" htmlFor="currentPassword" error={e.currentPassword?.message}>
        <Input id="currentPassword" type="password" autoComplete="current-password" {...form.register("currentPassword")} />
      </Field>
      <Field label="New password" htmlFor="newPassword" error={e.password?.message} hint="More than 8 characters, with upper & lower case letters and a special character.">
        <Input id="newPassword" type="password" autoComplete="new-password" {...form.register("password")} />
      </Field>
      <Field label="Confirm new password" htmlFor="confirmNewPassword" error={e.confirmPassword?.message}>
        <Input id="confirmNewPassword" type="password" autoComplete="new-password" {...form.register("confirmPassword")} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />} Change password
      </Button>
    </form>
  );
}
