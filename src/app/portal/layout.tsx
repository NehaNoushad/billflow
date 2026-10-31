import { AppShell } from "@/components/app/app-shell";
import { PORTAL_NAV } from "@/components/app/nav";
import { requirePage } from "@/lib/auth/guard";
import { getNotifications } from "@/services/notifications";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePage("portal.access");
  const notifications = await getNotifications(user);
  return (
    <AppShell nav={PORTAL_NAV} user={user} notifications={notifications}>
      {children}
    </AppShell>
  );
}
