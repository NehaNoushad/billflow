"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/app/form-bits";
import { forgotSchema, loginSchema, registerSchema, resetSchema } from "@/validators/auth";
import { forgotPasswordAction, loginAction, registerAction, resetPasswordAction } from "@/actions/auth";

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{message}</div>;
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const form = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  const onSubmit = form.handleSubmit((values) =>
    start(async () => {
      setError(undefined);
      const res = await loginAction(values);
      if (!res.ok) return setError(res.error);
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : res.data!.redirectTo);
      router.refresh();
    })
  );

  const fillDemo = (email: string) => {
    form.setValue("email", email);
    form.setValue("password", "Demo@12345");
  };

  return (
    <>
      <Header title="Sign in" subtitle="Welcome back to BILLFLOW." />
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError message={error} />
        <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" {...form.register("email")} aria-invalid={!!form.formState.errors.email} />
        </Field>
        <Field label="Password" htmlFor="password" error={form.formState.errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" {...form.register("password")} aria-invalid={!!form.formState.errors.password} />
        </Field>
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-sm text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="h-9 w-full" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />} Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        New customer?{" "}
        <Link href="/register" className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
      <div className="mt-8 rounded-lg border border-dashed p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Demo accounts (password Demo@12345)</p>
        <div className="flex flex-wrap gap-2">
          {[
            ["Admin", "admin@billflow.demo"],
            ["Staff", "staff@billflow.demo"],
            ["Customer", "customer@billflow.demo"],
          ].map(([label, email]) => (
            <Button key={email} type="button" variant="outline" size="xs" onClick={() => fillDemo(email)}>
              {label}
            </Button>
          ))}
        </div>
      </div>
    </>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const form = useForm({ resolver: zodResolver(registerSchema), defaultValues: { name: "", email: "", password: "", confirmPassword: "" }, mode: "onTouched" });
  const e = form.formState.errors;

  const onSubmit = form.handleSubmit((values) =>
    start(async () => {
      setError(undefined);
      const res = await registerAction(values);
      if (!res.ok) {
        for (const [k, msg] of Object.entries(res.fieldErrors ?? {})) form.setError(k as keyof typeof values, { message: msg });
        return setError(res.error);
      }
      toast.success("Welcome to BILLFLOW!");
      router.replace(res.data!.redirectTo);
      router.refresh();
    })
  );

  return (
    <>
      <Header title="Create your account" subtitle="Manage your subscriptions, invoices and payments." />
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError message={error} />
        <Field label="Full name" htmlFor="name" error={e.name?.message}>
          <Input id="name" autoComplete="name" {...form.register("name")} aria-invalid={!!e.name} />
        </Field>
        <Field label="Email" htmlFor="email" error={e.email?.message}>
          <Input id="email" type="email" autoComplete="email" {...form.register("email")} aria-invalid={!!e.email} />
        </Field>
        <Field label="Password" htmlFor="password" error={e.password?.message} hint="More than 8 characters, with upper & lower case letters and a special character.">
          <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} aria-invalid={!!e.password} />
        </Field>
        <Field label="Confirm password" htmlFor="confirmPassword" error={e.confirmPassword?.message}>
          <Input id="confirmPassword" type="password" autoComplete="new-password" {...form.register("confirmPassword")} aria-invalid={!!e.confirmPassword} />
        </Field>
        <Button type="submit" className="h-9 w-full" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />} Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}

export function ForgotForm() {
  const [done, setDone] = useState(false);
  const [devLink, setDevLink] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const form = useForm({ resolver: zodResolver(forgotSchema), defaultValues: { email: "" } });

  const onSubmit = form.handleSubmit((values) =>
    start(async () => {
      setError(undefined);
      const res = await forgotPasswordAction(values);
      if (!res.ok) return setError(res.error);
      setDevLink(res.data?.devLink);
      setDone(true);
    })
  );

  return (
    <>
      <Header title="Reset your password" subtitle="We'll email you a secure link that expires in 30 minutes." />
      {done ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">If an account exists for that email, a reset link has been sent.</div>
          {devLink && (
            <div className="rounded-lg border border-dashed p-3 text-xs">
              <p className="mb-1 font-medium">Development mode — email (SMTP) is not configured, so here is the link:</p>
              <Link href={devLink} className="break-all text-primary hover:underline">
                {devLink}
              </Link>
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormError message={error} />
          <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
            <Input id="email" type="email" {...form.register("email")} />
          </Field>
          <Button type="submit" className="h-9 w-full" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />} Send reset link
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <Link href="/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}

export function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const form = useForm({ resolver: zodResolver(resetSchema), defaultValues: { token: params.get("token") ?? "", password: "", confirmPassword: "" } });
  const e = form.formState.errors;

  const onSubmit = form.handleSubmit((values) =>
    start(async () => {
      setError(undefined);
      const res = await resetPasswordAction(values);
      if (!res.ok) return setError(res.error);
      toast.success(res.message);
      router.replace("/login");
    })
  );

  if (!params.get("token")) {
    return (
      <>
        <Header title="Invalid link" subtitle="This password reset link is missing its token." />
        <Link href="/forgot-password" className="text-sm text-primary hover:underline">
          Request a new link
        </Link>
      </>
    );
  }

  return (
    <>
      <Header title="Choose a new password" subtitle="Your new password must be different and secure." />
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError message={error} />
        <Field label="New password" htmlFor="password" error={e.password?.message} hint="More than 8 characters, with upper & lower case letters and a special character.">
          <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} />
        </Field>
        <Field label="Confirm password" htmlFor="confirmPassword" error={e.confirmPassword?.message}>
          <Input id="confirmPassword" type="password" autoComplete="new-password" {...form.register("confirmPassword")} />
        </Field>
        <Button type="submit" className="h-9 w-full" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />} Update password
        </Button>
      </form>
    </>
  );
}
