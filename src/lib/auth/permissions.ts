import type { Role } from "@/lib/constants";

// Single source of truth for what each role may do. Checked on the server in every action.
export const PERMISSIONS = {
  "dashboard.view": ["ADMIN", "STAFF"],
  "catalog.view": ["ADMIN", "STAFF"], // products, plans, taxes, discounts (read)
  "catalog.manage": ["ADMIN"], // create/edit/delete products, plans, taxes, discounts
  "customers.view": ["ADMIN", "STAFF"],
  "customers.manage": ["ADMIN", "STAFF"],
  "customers.assign": ["ADMIN"],
  "quotations.manage": ["ADMIN", "STAFF"],
  "subscriptions.manage": ["ADMIN", "STAFF"],
  "invoices.manage": ["ADMIN", "STAFF"],
  "payments.record": ["ADMIN", "STAFF"],
  "billing.run": ["ADMIN"],
  "reports.view": ["ADMIN", "STAFF"],
  "revenueGuard.view": ["ADMIN", "STAFF"],
  "settings.manage": ["ADMIN"],
  "staff.manage": ["ADMIN"],
  "demo.reset": ["ADMIN"],
  "portal.access": ["CUSTOMER"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | undefined, permission: Permission): boolean {
  return !!role && (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
