"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, NativeSelect } from "@/components/app/form-bits";
import { staffSchema } from "@/validators/auth";
import { createStaffAction } from "@/actions/admin";

export function NewStaffDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const form = useForm({ resolver: zodResolver(staffSchema), defaultValues: { name: "", email: "", password: "", role: "STAFF" as const } });
  const e = form.formState.errors;

  const onSubmit = form.handleSubmit((values) =>
    start(async () => {
      const res = await createStaffAction(values);
      if (!res.ok) {
        for (const [k, msg] of Object.entries(res.fieldErrors ?? {})) form.setError(k as keyof typeof values, { message: msg });
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      form.reset();
      setOpen(false);
      router.refresh();
    })
  );

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Add team member
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add team member</DialogTitle>
            <DialogDescription>Share the temporary password with them securely; they can reset it via “Forgot password”.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <Field label="Full name" htmlFor="s-name" error={e.name?.message} required>
              <Input id="s-name" {...form.register("name")} />
            </Field>
            <Field label="Email" htmlFor="s-email" error={e.email?.message} required>
              <Input id="s-email" type="email" {...form.register("email")} />
            </Field>
            <Field label="Temporary password" htmlFor="s-pass" error={e.password?.message} hint="More than 8 characters, upper & lower case and a special character." required>
              <Input id="s-pass" type="password" autoComplete="new-password" {...form.register("password")} />
            </Field>
            <Field label="Role" htmlFor="s-role">
              <NativeSelect id="s-role" {...form.register("role")}>
                <option value="STAFF">Staff — operations, no admin settings</option>
                <option value="ADMIN">Admin — full access</option>
              </NativeSelect>
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" />} Create account
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
