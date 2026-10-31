import { redirect } from "next/navigation";

// proxy.ts redirects "/" based on the session; this is a fallback.
export default function Home() {
  redirect("/login");
}
