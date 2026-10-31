import { Suspense } from "react";
import { RegisterForm } from "../auth-forms";

export const metadata = { title: "Create account" };

export default function Page() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
