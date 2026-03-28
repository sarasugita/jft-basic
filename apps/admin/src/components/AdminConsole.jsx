"use client";

import { usePathname } from "next/navigation";
import AdminConsoleShellFrame from "./AdminConsoleShellFrame";
import {
  ADMIN_CONSOLE_IMPORT_TIMEOUT_MS,
  getLoadedAdminConsoleCore,
  loadAdminConsoleCore,
} from "./adminConsoleLoader";
import LoadableAdminModule from "./LoadableAdminModule";

const DIRECT_ADMIN_CORE_TIMEOUT_MS = 30000;

function buildShellLoadingFallback({
  activeTab,
  activeSchoolName,
  changeSchoolHref,
  displayName,
  homeHref,
}) {
  return (
    <AdminConsoleShellFrame
      activeTab={activeTab}
      schoolName={activeSchoolName}
      displayName={displayName}
      changeSchoolHref={changeSchoolHref}
      onChangeSchool={() => {
        window.location.assign(changeSchoolHref || homeHref || "/");
      }}
    >
      <div className="admin-help" style={{ marginTop: 16 }}>
        Loading admin console...
      </div>
    </AdminConsoleShellFrame>
  );
}

export default function AdminConsole(props) {
  const pathname = usePathname();
  const {
    forcedSchoolScope = null,
    changeSchoolHref = null,
    homeHref = "/",
    homeLabel = "Admin Home",
    managedSession = undefined,
    managedProfile = undefined,
    initialAdminTab = "announcements",
    initialAttendanceSubTab = "sheet",
    initialModelSubTab = "results",
    initialDailySubTab = "results",
  } = props;

  const session = managedSession ?? null;
  const profile = managedProfile ?? null;
  const activeSchoolId = forcedSchoolScope?.id ?? profile?.school_id ?? null;
  const activeSchoolName = forcedSchoolScope?.name ?? activeSchoolId ?? "";
  const displayName = profile?.display_name?.trim() || session?.user?.email || "Loading user...";

  return (
    <LoadableAdminModule
      importTarget="AdminConsoleCore"
      loadModule={loadAdminConsoleCore}
      getLoadedModule={getLoadedAdminConsoleCore}
      context={{
        pathname,
        role: profile?.role ?? null,
        userId: session?.user?.id ?? null,
        schoolId: activeSchoolId,
        activeSchoolId,
        managedAuth: managedSession !== undefined || managedProfile !== undefined,
        source: "admin-console-direct-core",
        adminTab: initialAdminTab,
        attendanceSubTab: initialAttendanceSubTab,
        modelSubTab: initialModelSubTab,
        dailySubTab: initialDailySubTab,
      }}
      timeoutMs={Math.max(ADMIN_CONSOLE_IMPORT_TIMEOUT_MS, DIRECT_ADMIN_CORE_TIMEOUT_MS)}
      loadingFallback={buildShellLoadingFallback({
        activeTab: initialAdminTab,
        activeSchoolName,
        changeSchoolHref,
        displayName,
        homeHref,
      })}
      errorMessage="Failed to load the admin console. Retry or go back and try again."
      backLabel={changeSchoolHref ? "BACK TO SCHOOLS" : homeLabel}
      onBack={() => {
        window.location.assign(changeSchoolHref || homeHref || "/");
      }}
      diagnosticsExtra={{
        adminTab: initialAdminTab,
        attendanceSubTab: initialAttendanceSubTab,
        modelSubTab: initialModelSubTab,
        dailySubTab: initialDailySubTab,
      }}
      moduleProps={props}
    />
  );
}
