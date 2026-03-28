"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { buildScopedAdminHref } from "../lib/adminConsoleRoute";
import AdminConsoleShellFrame from "./AdminConsoleShellFrame";
import {
  ADMIN_CONSOLE_IMPORT_TIMEOUT_MS,
  getLoadedAdminConsoleAnnouncementsStartup,
  getLoadedAdminConsoleAttendanceStartup,
  getLoadedAdminConsoleCore,
  getLoadedAdminConsoleDailyRecordStartup,
  getLoadedAdminConsoleRankingStartup,
  getLoadedAdminConsoleStudentsStartup,
  loadAdminConsoleAnnouncementsStartup,
  loadAdminConsoleAttendanceStartup,
  loadAdminConsoleCore,
  loadAdminConsoleDailyRecordStartup,
  loadAdminConsoleRankingStartup,
  loadAdminConsoleStudentsStartup,
} from "./adminConsoleLoader";
import LoadableAdminModule from "./LoadableAdminModule";
import LoadableAdminWorkspace from "./LoadableAdminWorkspace";

const DIRECT_ADMIN_CORE_TIMEOUT_MS = 30000;
const DIRECT_ADMIN_WORKSPACE_TIMEOUT_MS = 20000;

const DIRECT_TAB_CONFIG = {
  announcements: {
    importTarget: "AdminConsoleAnnouncementsStartup",
    loadModule: loadAdminConsoleAnnouncementsStartup,
    getLoadedModule: getLoadedAdminConsoleAnnouncementsStartup,
  },
  students: {
    importTarget: "AdminConsoleStudentsStartup",
    loadModule: loadAdminConsoleStudentsStartup,
    getLoadedModule: getLoadedAdminConsoleStudentsStartup,
  },
  attendance: {
    importTarget: "AdminConsoleAttendanceStartup",
    loadModule: loadAdminConsoleAttendanceStartup,
    getLoadedModule: getLoadedAdminConsoleAttendanceStartup,
  },
  dailyRecord: {
    importTarget: "AdminConsoleDailyRecordStartup",
    loadModule: loadAdminConsoleDailyRecordStartup,
    getLoadedModule: getLoadedAdminConsoleDailyRecordStartup,
  },
  ranking: {
    importTarget: "AdminConsoleRankingStartup",
    loadModule: loadAdminConsoleRankingStartup,
    getLoadedModule: getLoadedAdminConsoleRankingStartup,
  },
};

function isDirectShellTab(activeTab, studentsFullConsole) {
  if (activeTab === "model" || activeTab === "daily") {
    return false;
  }
  if (activeTab === "students" && studentsFullConsole) {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(DIRECT_TAB_CONFIG, activeTab);
}

function buildShellLoadingFallback({
  activeTab,
  activeSchoolName,
  changeSchoolHref,
  displayName,
  homeHref,
  onSelectTab,
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
      onSelectTab={onSelectTab}
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
  const forcedSchoolId = forcedSchoolScope?.id ?? null;
  const isScopedSuperAdmin = Boolean(forcedSchoolId && profile?.role === "super_admin");

  const [activeTab, setActiveTab] = useState(initialAdminTab);
  const [attendanceSubTab, setAttendanceSubTab] = useState(initialAttendanceSubTab);
  const [modelSubTab, setModelSubTab] = useState(initialModelSubTab);
  const [dailySubTab, setDailySubTab] = useState(initialDailySubTab);
  const [studentsFullConsole, setStudentsFullConsole] = useState(false);

  useEffect(() => {
    setActiveTab(initialAdminTab);
    setAttendanceSubTab(initialAttendanceSubTab);
    setModelSubTab(initialModelSubTab);
    setDailySubTab(initialDailySubTab);
    setStudentsFullConsole(false);
  }, [
    initialAdminTab,
    initialAttendanceSubTab,
    initialDailySubTab,
    initialModelSubTab,
  ]);

  const syncScopedAdminRoute = useCallback((nextAdminTab, options = {}) => {
    if (!isScopedSuperAdmin || typeof window === "undefined") {
      return;
    }
    const href = buildScopedAdminHref(forcedSchoolId, {
      adminTab: nextAdminTab,
      attendanceSubTab: options.attendanceSubTab ?? "sheet",
      modelSubTab: options.modelSubTab ?? "results",
      dailySubTab: options.dailySubTab ?? "results",
    });
    if (window.location?.pathname === href) {
      return;
    }
    window.history.replaceState(window.history.state, "", href);
  }, [forcedSchoolId, isScopedSuperAdmin]);

  function selectAnnouncementsTab() {
    setActiveTab("announcements");
    setStudentsFullConsole(false);
    syncScopedAdminRoute("announcements");
  }

  function selectStudentsTab(options = {}) {
    const useFullConsole = Boolean(options.fullConsole);
    setActiveTab("students");
    setStudentsFullConsole(useFullConsole);
    syncScopedAdminRoute("students");
  }

  function selectAttendanceTab(nextAttendanceSubTab = "sheet") {
    setActiveTab("attendance");
    setStudentsFullConsole(false);
    setAttendanceSubTab(nextAttendanceSubTab);
    syncScopedAdminRoute("attendance", { attendanceSubTab: nextAttendanceSubTab });
  }

  function selectModelTab(nextModelSubTab = "results") {
    setActiveTab("model");
    setStudentsFullConsole(false);
    setModelSubTab(nextModelSubTab);
    syncScopedAdminRoute("model", { modelSubTab: nextModelSubTab });
  }

  function selectDailyTab(nextDailySubTab = "results") {
    setActiveTab("daily");
    setStudentsFullConsole(false);
    setDailySubTab(nextDailySubTab);
    syncScopedAdminRoute("daily", { dailySubTab: nextDailySubTab });
  }

  function selectDailyRecordTab() {
    setActiveTab("dailyRecord");
    setStudentsFullConsole(false);
    syncScopedAdminRoute("dailyRecord");
  }

  function selectRankingTab() {
    setActiveTab("ranking");
    setStudentsFullConsole(false);
    syncScopedAdminRoute("ranking");
  }

  function handleShellTabSelect(nextTab) {
    if (nextTab === "announcements") {
      selectAnnouncementsTab();
      return;
    }
    if (nextTab === "students") {
      selectStudentsTab();
      return;
    }
    if (nextTab === "attendance") {
      selectAttendanceTab("sheet");
      return;
    }
    if (nextTab === "model") {
      selectModelTab(modelSubTab || "results");
      return;
    }
    if (nextTab === "daily") {
      selectDailyTab(dailySubTab || "results");
      return;
    }
    if (nextTab === "dailyRecord") {
      selectDailyRecordTab();
      return;
    }
    if (nextTab === "ranking") {
      selectRankingTab();
    }
  }

  const shellFrameProps = {
    activeTab,
    schoolName: activeSchoolName,
    displayName,
    changeSchoolHref,
    onChangeSchool: () => {
      window.location.assign(changeSchoolHref || homeHref || "/");
    },
    onSelectTab: handleShellTabSelect,
  };

  const sharedContext = {
    pathname,
    role: profile?.role ?? null,
    userId: session?.user?.id ?? null,
    schoolId: activeSchoolId,
    activeSchoolId,
    managedAuth: managedSession !== undefined || managedProfile !== undefined,
  };

  const directTabConfig = isDirectShellTab(activeTab, studentsFullConsole)
    ? DIRECT_TAB_CONFIG[activeTab]
    : null;

  const directModuleProps = (() => {
    if (activeTab === "attendance") {
      return {
        activeSchoolId,
        initialAttendanceSubTab: attendanceSubTab,
        onSelectAttendanceSubTab: selectAttendanceTab,
      };
    }
    if (activeTab === "students") {
      return {
        activeSchoolId,
        onOpenFullConsole: () => {
          selectStudentsTab({ fullConsole: true });
        },
      };
    }
    return {
      activeSchoolId,
    };
  })();

  if (directTabConfig) {
    return (
      <AdminConsoleShellFrame {...shellFrameProps}>
        <LoadableAdminWorkspace
          key={`${activeTab}:${attendanceSubTab}:${studentsFullConsole ? "full" : "light"}`}
          importTarget={directTabConfig.importTarget}
          loadModule={directTabConfig.loadModule}
          getLoadedModule={directTabConfig.getLoadedModule}
          context={{
            ...sharedContext,
            source: `admin-console-direct-${activeTab}`,
            adminTab: activeTab,
            attendanceSubTab,
            modelSubTab,
            dailySubTab,
          }}
          timeoutMs={DIRECT_ADMIN_WORKSPACE_TIMEOUT_MS}
          loadingLabel={`Loading ${activeTab === "dailyRecord" ? "schedule & record" : activeTab}...`}
          errorMessage="Failed to load this admin tab. Retry or switch tabs and try again."
          backLabel={changeSchoolHref ? "Back to Schools" : homeLabel}
          onBack={() => {
            window.location.assign(changeSchoolHref || homeHref || "/");
          }}
          diagnosticsExtra={{
            adminTab: activeTab,
            attendanceSubTab,
            modelSubTab,
            dailySubTab,
          }}
          moduleProps={directModuleProps}
        />
      </AdminConsoleShellFrame>
    );
  }

  return (
    <LoadableAdminModule
      key={`${activeTab}:${attendanceSubTab}:${modelSubTab}:${dailySubTab}:${studentsFullConsole ? "full" : "light"}`}
      importTarget="AdminConsoleCore"
      loadModule={loadAdminConsoleCore}
      getLoadedModule={getLoadedAdminConsoleCore}
      context={{
        ...sharedContext,
        source: activeTab === "students"
          ? "admin-console-students-full-console"
          : `admin-console-heavy-${activeTab}`,
        adminTab: activeTab,
        attendanceSubTab,
        modelSubTab,
        dailySubTab,
      }}
      timeoutMs={Math.max(ADMIN_CONSOLE_IMPORT_TIMEOUT_MS, DIRECT_ADMIN_CORE_TIMEOUT_MS)}
      loadingFallback={buildShellLoadingFallback({
        activeTab,
        activeSchoolName,
        changeSchoolHref,
        displayName,
        homeHref,
        onSelectTab: handleShellTabSelect,
      })}
      errorMessage="Failed to load the admin console. Retry or go back and try again."
      backLabel={changeSchoolHref ? "BACK TO SCHOOLS" : homeLabel}
      onBack={() => {
        window.location.assign(changeSchoolHref || homeHref || "/");
      }}
      diagnosticsExtra={{
        adminTab: activeTab,
        attendanceSubTab,
        modelSubTab,
        dailySubTab,
      }}
      moduleProps={{
        ...props,
        initialAdminTab: activeTab,
        initialAttendanceSubTab: attendanceSubTab,
        initialModelSubTab: modelSubTab,
        initialDailySubTab: dailySubTab,
      }}
    />
  );
}
