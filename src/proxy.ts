import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

// Optimistic route protection. Real authorization happens again on the server in every page and action.
const AUTH_PAGES = ["/login", "/register", "/forgot-password", "/reset-password"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  const home = session?.role === "CUSTOMER" ? "/portal" : "/dashboard";

  if (pathname === "/") return NextResponse.redirect(new URL(session ? home : "/login", request.url));

  if (AUTH_PAGES.some((p) => pathname.startsWith(p))) {
    return session && !pathname.startsWith("/reset-password") ? NextResponse.redirect(new URL(home, request.url)) : NextResponse.next();
  }

  if (!session) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  const isPortal = pathname.startsWith("/portal");
  if (session.role === "CUSTOMER" && !isPortal) return NextResponse.redirect(new URL("/portal", request.url));
  if (session.role !== "CUSTOMER" && isPortal) return NextResponse.redirect(new URL("/dashboard", request.url));
  return NextResponse.next();
}

export const config = {
  // Skip API routes (they authenticate themselves), Next internals and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
