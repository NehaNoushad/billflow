import { UserCog } from "lucide-react";
import { requirePage } from "@/lib/auth/guard";
import { connectDB } from "@/lib/db";
import { Customer, User } from "@/models";
import { formatDateTime } from "@/lib/dates";
import { serialize } from "@/lib/utils-server";
import { EmptyState, PageHeader, Panel, StatusBadge, tableCls } from "@/components/app/ui-bits";
import { ActionButton } from "@/components/app/action-button";
import { setStaffActiveAction } from "@/actions/admin";
import { NewStaffDialog } from "./staff-client";

export const metadata = { title: "Staff" };

export default async function StaffPage() {
  const me = await requirePage("staff.manage");
  await connectDB();
  const [users, counts] = await Promise.all([
    User.find({ role: { $in: ["ADMIN", "STAFF"] } }).sort({ role: 1, name: 1 }).lean(),
    Customer.aggregate<{ _id: unknown; n: number }>([{ $match: { assignedStaff: { $ne: null } } }, { $group: { _id: "$assignedStaff", n: { $sum: 1 } } }]),
  ]);
  const team = serialize(users);
  const assigned = new Map(counts.map((c) => [String(c._id), c.n]));

  return (
    <div className="space-y-6">
      <PageHeader title="Staff" description="Team members who can manage customers, subscriptions and billing." actions={<NewStaffDialog />} />
      <Panel bodyClassName="p-0">
        {team.length === 0 ? (
          <EmptyState icon={UserCog} title="No team members yet" />
        ) : (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead className={tableCls.thead}>
                <tr>
                  <th className={tableCls.th}>Name</th>
                  <th className={tableCls.th}>Email</th>
                  <th className={tableCls.th}>Role</th>
                  <th className={tableCls.th}>Assigned customers</th>
                  <th className={tableCls.th}>Last sign-in</th>
                  <th className={tableCls.th}>Status</th>
                  <th className={tableCls.th} />
                </tr>
              </thead>
              <tbody>
                {team.map((u) => (
                  <tr key={String(u._id)} className={tableCls.tr}>
                    <td className={tableCls.td + " font-medium"}>
                      {u.name} {String(u._id) === me.id && <span className="text-xs text-muted-foreground">(you)</span>}
                    </td>
                    <td className={tableCls.td}>{u.email}</td>
                    <td className={tableCls.td}>
                      <span className="text-sm">{u.role === "ADMIN" ? "Admin" : "Staff"}</span>
                    </td>
                    <td className={tableCls.td}>{u.role === "STAFF" ? assigned.get(String(u._id)) ?? 0 : "All"}</td>
                    <td className={tableCls.td}>{formatDateTime(u.lastLoginAt)}</td>
                    <td className={tableCls.td}>
                      <StatusBadge status={u.active ? "ACTIVE" : "INACTIVE"} />
                    </td>
                    <td className={tableCls.td + " text-right"}>
                      {String(u._id) !== me.id &&
                        (u.active ? (
                          <ActionButton
                            action={setStaffActiveAction.bind(null, String(u._id), false)}
                            confirm={{ title: `Deactivate ${u.name}?`, description: "They will be signed out immediately and their customers will be unassigned.", confirmLabel: "Deactivate", destructive: true }}
                          >
                            Deactivate
                          </ActionButton>
                        ) : (
                          <ActionButton action={setStaffActiveAction.bind(null, String(u._id), true)}>Activate</ActionButton>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
