import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

// Clears a session cookie that is signed but no longer valid (user deleted, deactivated,
// password reset, or demo data reset) and sends the user to the login page.
// Without this, proxy.ts and the page guard would redirect back and forth forever.
export function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
