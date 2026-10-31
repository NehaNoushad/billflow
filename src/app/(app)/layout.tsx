import { AppShell } from "@/components/app/app-shell";
import { APP_NAV } from "@/components/app/nav";
import { requirePage } from "@/lib/auth/guard";
import { getNotifications } from "@/services/notifications";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePage("dashboard.view");
  const notifications = await getNotifications(user);
  return (
    <AppShell nav={APP_NAV.filter((n) => n.roles.includes(user.role))} user={user} notifications={notifications}>
      {children}
    </AppShell>
  );
}
