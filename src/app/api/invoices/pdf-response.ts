import { NextResponse } from "next/server";
import { canAccessCustomer, getCurrentUser, type CurrentUser } from "@/lib/auth/guard";
import { isObjectId } from "@/lib/utils-server";
import { connectDB } from "@/lib/db";

/** Shared auth + response helpers for PDF route handlers. */
export async function authorizePdf(id: string): Promise<{ user: CurrentUser } | { error: NextResponse }> {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  if (!isObjectId(id)) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  await connectDB();
  return { user };
}

export async function denyUnlessAccess(user: CurrentUser, customerId: unknown): Promise<NextResponse | null> {
  return (await canAccessCustomer(user, customerId)) ? null : NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export function pdfResponse(buffer: Buffer, filename: string, request: Request) {
  const inline = new URL(request.url).searchParams.get("inline") === "1";
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename.replace(/[^\w.-]/g, "_")}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });
