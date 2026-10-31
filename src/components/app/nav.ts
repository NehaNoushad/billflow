import type { Role } from "@/lib/constants";

export type NavItem = { href: string; label: string; icon: string; roles: Role[]; group: string };

// Icons are referenced by name so this list can be shared by server and client components.
export const APP_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", roles: ["ADMIN", "STAFF"], group: "Overview" },
  { href: "/revenue-guard", label: "Revenue Guard", icon: "ShieldCheck", roles: ["ADMIN", "STAFF"], group: "Overview" },
  { href: "/reports", label: "Reports", icon: "BarChart3", roles: ["ADMIN", "STAFF"], group: "Overview" },
  { href: "/customers", label: "Customers", icon: "Users", roles: ["ADMIN", "STAFF"], group: "Sales" },
  { href: "/quotations", label: "Quotations", icon: "FileText", roles: ["ADMIN", "STAFF"], group: "Sales" },
  { href: "/subscriptions", label: "Subscriptions", icon: "Repeat", roles: ["ADMIN", "STAFF"], group: "Sales" },
  { href: "/invoices", label: "Invoices", icon: "Receipt", roles: ["ADMIN", "STAFF"], group: "Billing" },
  { href: "/payments", label: "Payments", icon: "Wallet", roles: ["ADMIN", "STAFF"], group: "Billing" },
  { href: "/billing", label: "Billing Runs", icon: "PlayCircle", roles: ["ADMIN"], group: "Billing" },
  { href: "/products", label: "Products", icon: "Package", roles: ["ADMIN", "STAFF"], group: "Catalogue" },
  { href: "/plans", label: "Plans", icon: "Layers", roles: ["ADMIN", "STAFF"], group: "Catalogue" },
  { href: "/taxes", label: "Taxes", icon: "Percent", roles: ["ADMIN", "STAFF"], group: "Catalogue" },
  { href: "/discounts", label: "Discounts", icon: "Tag", roles: ["ADMIN", "STAFF"], group: "Catalogue" },
  { href: "/staff", label: "Staff", icon: "UserCog", roles: ["ADMIN"], group: "Admin" },
  { href: "/settings", label: "Settings", icon: "Settings", roles: ["ADMIN"], group: "Admin" },
];

export const PORTAL_NAV: NavItem[] = [
  { href: "/portal", label: "Overview", icon: "LayoutDashboard", roles: ["CUSTOMER"], group: "My account" },
  { href: "/portal/subscriptions", label: "My Subscriptions", icon: "Repeat", roles: ["CUSTOMER"], group: "My account" },
  { href: "/portal/invoices", label: "My Invoices", icon: "Receipt", roles: ["CUSTOMER"], group: "My account" },
  { href: "/portal/payments", label: "Payment History", icon: "Wallet", roles: ["CUSTOMER"], group: "My account" },
  { href: "/portal/profile", label: "Profile", icon: "UserCircle", roles: ["CUSTOMER"], group: "My account" },
];
