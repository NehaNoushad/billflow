import { Suspense } from "react";
import { LoginForm } from "../auth-forms";

export const metadata = { title: "Sign in" };

export default function Page() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
