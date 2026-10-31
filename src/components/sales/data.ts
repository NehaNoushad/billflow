// Server-side data helpers shared by the sales pages.
import { Customer, User } from "@/models";
import { scopeFilter, type CurrentUser } from "@/lib/auth/guard";

/** Active customers the user may sell to (scoped for staff). */
export async function customerOptions(user: CurrentUser) {
  const scope = await scopeFilter(user, "_id");
  const list = await Customer.find({ ...scope, status: "ACTIVE" }).select("name companyName").sort({ name: 1 }).lean();
  return list.map((c) => ({ _id: String(c._id), name: c.name, companyName: c.companyName ?? undefined }));
}

export async function staffOptions() {
  const list = await User.find({ role: { $in: ["STAFF", "ADMIN"] }, active: true }).select("name role").sort({ role: -1, name: 1 }).lean();
  return list.map((u) => ({ _id: String(u._id), name: `${u.name}${u.role === "ADMIN" ? " (admin)" : ""}` }));
}

type Line = { product?: unknown; variant?: unknown; quantity: number; unitPrice?: number };

/** Convert stored snapshot lines back into editor rows (plan fee lines have no product and are skipped). */
export function toEditorLines(lines: Line[], withPrice = false) {
  return lines
    .filter((l) => l.product)
    .map((l) => ({
      product: String(l.product),
      variant: l.variant ? String(l.variant) : undefined,
      quantity: l.quantity,
      ...(withPrice && l.unitPrice != null ? { unitPrice: (l.unitPrice / 100).toFixed(2) } : {}),
    }));
}
