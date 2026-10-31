import { Suspense } from "react";
import { ForgotForm } from "../auth-forms";

export const metadata = { title: "Forgot password" };

export default function Page() {
  return (
    <Suspense>
      <ForgotForm />
    </Suspense>
  );
}
