import { SettingsView } from "@/components/settings/settings-view";
import { loadRoleAccess } from "@/lib/access/queries";
import { listAudit } from "@/lib/audit/record";
import { can, requireSection } from "@/lib/auth/session";
import { googlePickerApiKey, googlePickerAppId } from "@/lib/env";
import { loadConnection } from "@/lib/google/connection";
import { listMembers } from "@/lib/members/queries";
import { loadPeriodConfiguration } from "@/lib/periods/ensure";
import { loadReferenceData } from "@/lib/reference/queries";
import { loadDeadlineRules } from "@/lib/reports/deadlines-queries";
import { loadReportSettings } from "@/lib/reports/queries";

export const metadata = { title: "Settings" };

/** Everything the company tabs render, or null when the role may not see them. */
async function companyTabs(tenantId: string, canEditDeadlines: boolean) {
  const [data, reports, periods, connection] = await Promise.all([
    loadReferenceData(tenantId),
    loadReportSettings(tenantId),
    loadPeriodConfiguration(tenantId),
    loadConnection(tenantId),
  ]);

  return {
    data,
    reports,
    schedule: periods.schedule,
    connection,
    pickerApiKey: googlePickerApiKey(),
    pickerAppId: googlePickerAppId(),
    deadlineRules: await loadDeadlineRules(tenantId, reports),
    canEditDeadlines,
  };
}

export default async function SettingsPage() {
  // Settings is one screen over several sections; any of them is a reason to
  // let someone in, and each tab checks its own below.
  const user = await requireSection(["settings_company", "team", "activity"]);

  // Nothing a role cannot open is loaded, let alone rendered: a hidden tab
  // whose figures still travel in the payload is not access control.
  const [company, team, audit] = await Promise.all([
    can(user, "settings_company", "view")
      ? companyTabs(user.tenantId, can(user, "settings_deadlines", "edit"))
      : null,
    can(user, "team", "view")
      ? Promise.all([listMembers(user.tenantId), loadRoleAccess(user.tenantId)]).then(
          ([members, roleAccess]) => ({ members, roleAccess }),
        )
      : null,
    can(user, "activity", "view") ? listAudit(user.tenantId) : null,
  ]);

  // No PageHeader here on purpose: the app bar already says Settings, and a
  // page that opens with a greeting does not introduce itself twice.
  return (
    <SettingsView
      company={company}
      team={team}
      audit={audit}
      selfEmail={user.email}
      // What each tab may do is the owner's decision now, held in
      // role_permissions rather than in a role name written into the page.
      canEdit={can(user, "settings_company", "edit")}
      isOwner={user.role === "owner"}
    />
  );
}
