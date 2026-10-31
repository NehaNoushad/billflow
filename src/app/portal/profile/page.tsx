import { requirePage } from "@/lib/auth/guard";
import { connectDB } from "@/lib/db";
import { Customer } from "@/models";
import { PageHeader, Panel } from "@/components/app/ui-bits";
import { PasswordForm, ProfileForm } from "@/components/portal/portal-forms";

export const metadata = { title: "Profile" };

export default async function PortalProfile() {
  const user = await requirePage("portal.access");
  await connectDB();
  const c = await Customer.findById(user.customerId).lean();
  const a = c?.billingAddress ?? {};

  return (
    <div className="space-y-6">
      <PageHeader title="Profile" description="Keep your contact and billing details up to date. They appear on future invoices." />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel title="Company & billing details" description={`Signed in as ${user.email} (email cannot be changed here)`} className="xl:col-span-2">
          <ProfileForm
            defaults={{
              name: c?.name ?? user.name,
              phone: c?.phone ?? "",
              companyName: c?.companyName ?? "",
              taxId: c?.taxId ?? "",
              billingAddress: { line1: a.line1 ?? "", line2: a.line2 ?? "", city: a.city ?? "", state: a.state ?? "", postalCode: a.postalCode ?? "", country: a.country ?? "India" },
            }}
          />
        </Panel>
        <Panel title="Change password">
          <PasswordForm />
        </Panel>
      </div>
    </div>
  );
}
