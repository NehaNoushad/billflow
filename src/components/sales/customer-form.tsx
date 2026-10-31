"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, NativeSelect } from "@/components/app/form-bits";
import { Panel } from "@/components/app/ui-bits";
import { customerSchema, type CustomerInput } from "@/validators/sales";
import { createCustomerAction, updateCustomerAction } from "@/actions/customers";

type Props = {
  customerId?: string;
  defaultValues?: Partial<CustomerInput>;
  staff?: { _id: string; name: string }[];
  canAssign: boolean;
};

export function CustomerForm({ customerId, defaultValues, staff = [], canAssign }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const form = useForm<CustomerInput>({
    resolver: zodResolver(customerSchema),
    defaultValues: { name: "", email: "", phone: "", companyName: "", line1: "", line2: "", city: "", state: "", postalCode: "", country: "India", taxId: "", status: "ACTIVE", assignedStaff: "", notes: "", ...defaultValues },
  });
  const e = form.formState.errors;

  const onSubmit = form.handleSubmit((values) =>
    start(async () => {
      const res = customerId ? await updateCustomerAction(customerId, values) : await createCustomerAction(values);
      if (!res.ok) {
        for (const [k, msg] of Object.entries(res.fieldErrors ?? {})) form.setError(k as keyof CustomerInput, { message: msg });
        if (/email/i.test(res.error)) form.setError("email", { message: res.error });
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.push(`/customers/${res.data!.id}`);
      router.refresh();
    })
  );

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <Panel title="Contact">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer name" htmlFor="name" error={e.name?.message} required>
            <Input id="name" {...form.register("name")} aria-invalid={!!e.name} />
          </Field>
          <Field label="Email" htmlFor="email" error={e.email?.message} required hint="Must be unique — used for portal login and invoices.">
            <Input id="email" type="email" {...form.register("email")} aria-invalid={!!e.email} />
          </Field>
          <Field label="Phone" htmlFor="phone" error={e.phone?.message}>
            <Input id="phone" {...form.register("phone")} />
          </Field>
          <Field label="Company name" htmlFor="companyName" error={e.companyName?.message}>
            <Input id="companyName" {...form.register("companyName")} />
          </Field>
          <Field label="GSTIN / Tax ID" htmlFor="taxId" error={e.taxId?.message} hint="Optional, 15 characters">
            <Input id="taxId" {...form.register("taxId")} className="uppercase" />
          </Field>
          <Field label="Status" htmlFor="status">
            <NativeSelect id="status" {...form.register("status")}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </NativeSelect>
          </Field>
          {canAssign && (
            <Field label="Assigned staff" htmlFor="assignedStaff" hint="Staff only see customers assigned to them.">
              <NativeSelect id="assignedStaff" {...form.register("assignedStaff")}>
                <option value="">Unassigned (admins only)</option>
                {staff.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
        </div>
      </Panel>
      <Panel title="Billing address">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Address line 1" htmlFor="line1" className="sm:col-span-2">
            <Input id="line1" {...form.register("line1")} />
          </Field>
          <Field label="Address line 2" htmlFor="line2" className="sm:col-span-2">
            <Input id="line2" {...form.register("line2")} />
          </Field>
          <Field label="City" htmlFor="city">
            <Input id="city" {...form.register("city")} />
          </Field>
          <Field label="State" htmlFor="state">
            <Input id="state" {...form.register("state")} />
          </Field>
          <Field label="Postal code" htmlFor="postalCode">
            <Input id="postalCode" {...form.register("postalCode")} />
          </Field>
          <Field label="Country" htmlFor="country">
            <Input id="country" {...form.register("country")} />
          </Field>
          <Field label="Internal notes" htmlFor="notes" className="sm:col-span-2">
            <Textarea id="notes" rows={3} {...form.register("notes")} />
          </Field>
        </div>
      </Panel>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />} {customerId ? "Save changes" : "Create customer"}
        </Button>
      </div>
    </form>
  );
}
