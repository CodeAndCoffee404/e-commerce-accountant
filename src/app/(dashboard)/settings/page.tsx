import { SettingsView } from "@/components/settings/settings-view";
import { loadRoleAccess } from "@/lib/access/queries";
import { listAudit } from "@/lib/audit/record";
import { requireSection } from "@/lib/auth/session";
import { googlePickerApiKey, googlePickerAppId } from "@/lib/env";
import { loadConnection } from "@/lib/google/connection";
import { listMembers } from "@/lib/members/queries";
import { loadPeriodConfiguration } from "@/lib/periods/ensure";
import { loadReferenceData } from "@/lib/reference/queries";
import { loadDeadlineRules } from "@/lib/reports/deadlines-queries";
import { loadReportSettings } from "@/lib/reports/queries";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  // Settings is one screen over several sections; any of them is a reason to
  // let someone in, and each tab checks its own below.
  const user = await requireSection([
    "settings_company",
    "settings_deadlines",
    "team",
    "activity",
  ]);
  const [data, reports, periods, connection, members, audit, roleAccess] = await Promise.all([
    loadReferenceData(user.tenantId),
    loadReportSettings(user.tenantId),
    loadPeriodConfiguration(user.tenantId),
    loadConnection(user.tenantId),
    listMembers(user.tenantId),
    listAudit(user.tenantId),
    loadRoleAccess(user.tenantId),
  ]);
  const deadlineRules = await loadDeadlineRules(user.tenantId, reports);

  // No PageHeader here on purpose: the app bar already says Settings, and a
  // page that opens with a greeting does not introduce itself twice.
  return (
    <>
      <SettingsView
        data={data}
        reports={reports}
        deadlineRules={deadlineRules}
        schedule={periods.schedule}
        connection={connection}
        pickerApiKey={googlePickerApiKey()}
        pickerAppId={googlePickerAppId()}
        members={members}
        selfEmail={user.email}
        audit={audit}
        roleAccess={roleAccess}
        // What each tab may do is the owner's decision now, held in
        // role_permissions rather than in a role name written into the page.
        canEdit={user.can("settings_company", "edit")}
        canViewCompany={user.can("settings_company", "view")}
        canEditDeadlines={user.can("settings_deadlines", "edit")}
        canViewDeadlines={user.can("settings_deadlines", "view")}
        canViewTeam={user.can("team", "view")}
        canViewActivity={user.can("activity", "view")}
        isOwner={user.role === "owner"}
      />
    </>
  );
}
