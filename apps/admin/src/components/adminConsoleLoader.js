"use client";

import { logAdminEvent, logAdminRequestFailure } from "../lib/adminDiagnostics";

export const ADMIN_CONSOLE_IMPORT_TIMEOUT_MS = 15000;

const CHUNK_PATH_FRAGMENT = "/_next/static/chunks/";
const STARTUP_ERROR_PATTERN = /ChunkLoadError|Failed to fetch dynamically imported module|Loading chunk|Unexpected token|Failed to fetch/i;

let adminConsolePromise = null;
let adminConsoleCorePromise = null;
let adminConsoleModule = null;
let adminConsoleCoreModule = null;
let adminConsoleAnnouncementsStartupPromise = null;
let adminConsoleAnnouncementsStartupModule = null;
let adminConsoleAttendanceStartupPromise = null;
let adminConsoleAttendanceStartupModule = null;
let adminConsoleRankingStartupPromise = null;
let adminConsoleRankingStartupModule = null;
let adminConsoleDailyRecordStartupPromise = null;
let adminConsoleDailyRecordStartupModule = null;
let adminConsoleStudentsStartupPromise = null;
let adminConsoleStudentsStartupModule = null;
let startupListenersRegistered = false;
const workspacePromises = {
  students: null,
  attendance: null,
  dailyRecord: null,
  ranking: null,
  announcements: null,
  testing: null,
};
const workspaceModules = {
  students: null,
  attendance: null,
  dailyRecord: null,
  ranking: null,
  announcements: null,
  testing: null,
};

function now() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function getNavigatorInfo() {
  if (typeof navigator === "undefined") {
    return {
      online: null,
      userAgent: "",
      language: "",
    };
  }

  return {
    online: typeof navigator.onLine === "boolean" ? navigator.onLine : null,
    userAgent: navigator.userAgent ?? "",
    language: navigator.language ?? "",
  };
}

function getWindowInfo() {
  if (typeof window === "undefined") {
    return {
      pathname: "",
      href: "",
      visibilityState: "",
      buildId: null,
      timeZone: "",
    };
  }

  let timeZone = "";
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    timeZone = "";
  }

  return {
    pathname: window.location?.pathname ?? "",
    href: window.location?.href ?? "",
    visibilityState: document?.visibilityState ?? "",
    buildId: window.__NEXT_DATA__?.buildId ?? null,
    timeZone,
  };
}

function buildImportContext(context = {}) {
  const navigatorInfo = getNavigatorInfo();
  const windowInfo = getWindowInfo();

  return {
    pathname: context.pathname ?? windowInfo.pathname,
    href: windowInfo.href,
    role: context.role ?? null,
    userId: context.userId ?? null,
    schoolId: context.schoolId ?? null,
    activeSchoolId: context.activeSchoolId ?? context.schoolId ?? null,
    attempt: context.attempt ?? 0,
    managedAuth: context.managedAuth ?? null,
    source: context.source ?? "unknown",
    importTarget: context.importTarget ?? "AdminConsole",
    visibilityState: windowInfo.visibilityState,
    buildId: windowInfo.buildId,
    timeZone: windowInfo.timeZone,
    online: navigatorInfo.online,
    userAgent: navigatorInfo.userAgent,
    language: navigatorInfo.language,
  };
}

function getChunkResourceTimings(startTimeMs) {
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") {
    return [];
  }

  return performance
    .getEntriesByType("resource")
    .filter((entry) => {
      return entry?.name?.includes(CHUNK_PATH_FRAGMENT)
        && entry.startTime >= startTimeMs;
    })
    .map((entry) => ({
      name: entry.name,
      initiatorType: entry.initiatorType ?? "",
      durationMs: Math.round((entry.duration ?? 0) * 10) / 10,
      transferSize: Number.isFinite(entry.transferSize) ? entry.transferSize : null,
      encodedBodySize: Number.isFinite(entry.encodedBodySize) ? entry.encodedBodySize : null,
      decodedBodySize: Number.isFinite(entry.decodedBodySize) ? entry.decodedBodySize : null,
      responseEnd: Math.round((entry.responseEnd ?? 0) * 10) / 10,
    }));
}

function logChunkTimings(context, startTimeMs) {
  getChunkResourceTimings(startTimeMs).forEach((entry) => {
    logAdminEvent("Admin console chunk resource timing", {
      ...context,
      ...entry,
    });
  });
}

function createTimeoutError(timeoutMs, importTarget) {
  const error = new Error(`${importTarget} import timed out after ${timeoutMs}ms`);
  error.name = "AdminConsoleImportTimeoutError";
  error.code = "admin-console-import-timeout";
  return error;
}

function getErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error ?? "");
}

function getErrorObject(error, fallback = {}) {
  if (error instanceof Error) return error;
  return {
    ...fallback,
    message: getErrorMessage(error),
  };
}

function shouldLogStartupMessage(message) {
  return STARTUP_ERROR_PATTERN.test(String(message ?? ""));
}

async function loadImport(importTarget, importer, context = {}) {
  const startTimeMs = now();
  const payload = buildImportContext({
    ...context,
    importTarget,
  });

  logAdminEvent("Admin console import start", payload);

  try {
    const mod = await importer();
    const durationMs = Math.round((now() - startTimeMs) * 10) / 10;
    logChunkTimings(payload, startTimeMs);
    logAdminEvent("Admin console import success", {
      ...payload,
      durationMs,
    });
    return mod;
  } catch (error) {
    const durationMs = Math.round((now() - startTimeMs) * 10) / 10;
    logChunkTimings(payload, startTimeMs);
    logAdminRequestFailure("Admin console import failed", error, {
      ...payload,
      durationMs,
      stack: error instanceof Error ? error.stack ?? "" : "",
    });
    throw error;
  }
}

async function preloadImport(importTarget, loadFn, context = {}, options = {}) {
  const timeoutMs = options.timeoutMs ?? ADMIN_CONSOLE_IMPORT_TIMEOUT_MS;
  const startTimeMs = now();
  const payload = buildImportContext({
    ...context,
    importTarget,
    source: context.source ?? "preload",
  });

  let timeoutId = null;
  let timedOut = false;

  try {
    return await Promise.race([
      loadFn(payload),
      new Promise((_, reject) => {
        if (typeof window === "undefined") return;
        timeoutId = window.setTimeout(() => {
          timedOut = true;
          const durationMs = Math.round((now() - startTimeMs) * 10) / 10;
          logChunkTimings(payload, startTimeMs);
          logAdminEvent("Admin console import timeout", {
            ...payload,
            durationMs,
            timeoutMs,
          });
          reject(createTimeoutError(timeoutMs, importTarget));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (timedOut) {
      throw error;
    }
    throw error;
  } finally {
    if (timeoutId != null && typeof window !== "undefined") {
      window.clearTimeout(timeoutId);
    }
  }
}

function loadCachedModule(getPromiseRef, setPromiseRef, getModuleRef, setModuleRef, importer) {
  const loadedModule = getModuleRef();
  if (loadedModule) {
    return Promise.resolve(loadedModule);
  }

  const existing = getPromiseRef();
  if (existing) return existing;
  const next = importer()
    .then((mod) => {
      setModuleRef(mod);
      return mod;
    })
    .catch((error) => {
      setPromiseRef(null);
      throw error;
    });
  setPromiseRef(next);
  return next;
}

function loadCachedWorkspaceModule(key, importer) {
  return loadCachedModule(
    () => workspacePromises[key],
    (value) => {
      workspacePromises[key] = value;
    },
    () => workspaceModules[key],
    (value) => {
      workspaceModules[key] = value;
    },
    importer
  );
}

export function loadAdminConsole(context = {}) {
  return loadImport(
    "AdminConsole",
    () => loadCachedModule(
      () => adminConsolePromise,
      (value) => {
        adminConsolePromise = value;
      },
      () => adminConsoleModule,
      (value) => {
        adminConsoleModule = value;
      },
      () => import("./AdminConsole")
    ),
    context
  );
}

export function preloadAdminConsole(context = {}, options = {}) {
  return preloadImport("AdminConsole", loadAdminConsole, context, options);
}

export function loadAdminConsoleCore(context = {}) {
  return loadImport(
    "AdminConsoleCore",
    () => loadCachedModule(
      () => adminConsoleCorePromise,
      (value) => {
        adminConsoleCorePromise = value;
      },
      () => adminConsoleCoreModule,
      (value) => {
        adminConsoleCoreModule = value;
      },
      () => import("./AdminConsoleCore")
    ),
    context
  );
}

export function preloadAdminConsoleCore(context = {}, options = {}) {
  return preloadImport("AdminConsoleCore", loadAdminConsoleCore, context, options);
}

export function loadAdminConsoleAnnouncementsStartup(context = {}) {
  return loadImport(
    "AdminConsoleAnnouncementsStartup",
    () => loadCachedModule(
      () => adminConsoleAnnouncementsStartupPromise,
      (value) => {
        adminConsoleAnnouncementsStartupPromise = value;
      },
      () => adminConsoleAnnouncementsStartupModule,
      (value) => {
        adminConsoleAnnouncementsStartupModule = value;
      },
      () => import("./AdminConsoleAnnouncementsStartup")
    ),
    context
  );
}

export function preloadAdminConsoleAnnouncementsStartup(context = {}, options = {}) {
  return preloadImport("AdminConsoleAnnouncementsStartup", loadAdminConsoleAnnouncementsStartup, context, options);
}

export function loadAdminConsoleAttendanceStartup(context = {}) {
  return loadImport(
    "AdminConsoleAttendanceStartup",
    () => loadCachedModule(
      () => adminConsoleAttendanceStartupPromise,
      (value) => {
        adminConsoleAttendanceStartupPromise = value;
      },
      () => adminConsoleAttendanceStartupModule,
      (value) => {
        adminConsoleAttendanceStartupModule = value;
      },
      () => import("./AdminConsoleAttendanceStartup")
    ),
    context
  );
}

export function preloadAdminConsoleAttendanceStartup(context = {}, options = {}) {
  return preloadImport("AdminConsoleAttendanceStartup", loadAdminConsoleAttendanceStartup, context, options);
}

export function loadAdminConsoleRankingStartup(context = {}) {
  return loadImport(
    "AdminConsoleRankingStartup",
    () => loadCachedModule(
      () => adminConsoleRankingStartupPromise,
      (value) => {
        adminConsoleRankingStartupPromise = value;
      },
      () => adminConsoleRankingStartupModule,
      (value) => {
        adminConsoleRankingStartupModule = value;
      },
      () => import("./AdminConsoleRankingStartup")
    ),
    context
  );
}

export function preloadAdminConsoleRankingStartup(context = {}, options = {}) {
  return preloadImport("AdminConsoleRankingStartup", loadAdminConsoleRankingStartup, context, options);
}

export function loadAdminConsoleDailyRecordStartup(context = {}) {
  return loadImport(
    "AdminConsoleDailyRecordStartup",
    () => loadCachedModule(
      () => adminConsoleDailyRecordStartupPromise,
      (value) => {
        adminConsoleDailyRecordStartupPromise = value;
      },
      () => adminConsoleDailyRecordStartupModule,
      (value) => {
        adminConsoleDailyRecordStartupModule = value;
      },
      () => import("./AdminConsoleDailyRecordStartup")
    ),
    context
  );
}

export function preloadAdminConsoleDailyRecordStartup(context = {}, options = {}) {
  return preloadImport("AdminConsoleDailyRecordStartup", loadAdminConsoleDailyRecordStartup, context, options);
}

export function loadAdminConsoleStudentsStartup(context = {}) {
  return loadImport(
    "AdminConsoleStudentsStartup",
    () => loadCachedModule(
      () => adminConsoleStudentsStartupPromise,
      (value) => {
        adminConsoleStudentsStartupPromise = value;
      },
      () => adminConsoleStudentsStartupModule,
      (value) => {
        adminConsoleStudentsStartupModule = value;
      },
      () => import("./AdminConsoleStudentsStartup")
    ),
    context
  );
}

export function preloadAdminConsoleStudentsStartup(context = {}, options = {}) {
  return preloadImport("AdminConsoleStudentsStartup", loadAdminConsoleStudentsStartup, context, options);
}

function createWorkspaceLoaders(key, importTarget, importer) {
  const load = (context = {}) => loadImport(
    importTarget,
    () => loadCachedWorkspaceModule(key, importer),
    context
  );
  const preload = (context = {}, options = {}) => preloadImport(importTarget, load, context, options);
  const getLoaded = () => workspaceModules[key];
  return { load, preload, getLoaded };
}

const studentsWorkspace = createWorkspaceLoaders(
  "students",
  "AdminConsoleStudentsWorkspace",
  () => import("./AdminConsoleStudentsWorkspace")
);
const attendanceWorkspace = createWorkspaceLoaders(
  "attendance",
  "AdminConsoleAttendanceWorkspace",
  () => import("./AdminConsoleAttendanceWorkspace")
);
const dailyRecordWorkspace = createWorkspaceLoaders(
  "dailyRecord",
  "AdminConsoleDailyRecordWorkspace",
  () => import("./AdminConsoleDailyRecordWorkspace")
);
const rankingWorkspace = createWorkspaceLoaders(
  "ranking",
  "AdminConsoleRankingWorkspace",
  () => import("./AdminConsoleRankingWorkspace")
);
const announcementsWorkspace = createWorkspaceLoaders(
  "announcements",
  "AdminConsoleAnnouncementsWorkspace",
  () => import("./AdminConsoleAnnouncementsWorkspace")
);
const testingWorkspace = createWorkspaceLoaders(
  "testing",
  "AdminConsoleTestingWorkspace",
  () => import("./AdminConsoleTestingWorkspace")
);

export function getLoadedAdminConsole() {
  return adminConsoleModule;
}

export function getLoadedAdminConsoleCore() {
  return adminConsoleCoreModule;
}

export function getLoadedAdminConsoleAnnouncementsStartup() {
  return adminConsoleAnnouncementsStartupModule;
}

export function getLoadedAdminConsoleAttendanceStartup() {
  return adminConsoleAttendanceStartupModule;
}

export function getLoadedAdminConsoleRankingStartup() {
  return adminConsoleRankingStartupModule;
}

export function getLoadedAdminConsoleDailyRecordStartup() {
  return adminConsoleDailyRecordStartupModule;
}

export function getLoadedAdminConsoleStudentsStartup() {
  return adminConsoleStudentsStartupModule;
}

export const loadAdminConsoleStudentsWorkspace = studentsWorkspace.load;
export const preloadAdminConsoleStudentsWorkspace = studentsWorkspace.preload;
export const getLoadedAdminConsoleStudentsWorkspace = studentsWorkspace.getLoaded;

export const loadAdminConsoleAttendanceWorkspace = attendanceWorkspace.load;
export const preloadAdminConsoleAttendanceWorkspace = attendanceWorkspace.preload;
export const getLoadedAdminConsoleAttendanceWorkspace = attendanceWorkspace.getLoaded;

export const loadAdminConsoleDailyRecordWorkspace = dailyRecordWorkspace.load;
export const preloadAdminConsoleDailyRecordWorkspace = dailyRecordWorkspace.preload;
export const getLoadedAdminConsoleDailyRecordWorkspace = dailyRecordWorkspace.getLoaded;

export const loadAdminConsoleRankingWorkspace = rankingWorkspace.load;
export const preloadAdminConsoleRankingWorkspace = rankingWorkspace.preload;
export const getLoadedAdminConsoleRankingWorkspace = rankingWorkspace.getLoaded;

export const loadAdminConsoleAnnouncementsWorkspace = announcementsWorkspace.load;
export const preloadAdminConsoleAnnouncementsWorkspace = announcementsWorkspace.preload;
export const getLoadedAdminConsoleAnnouncementsWorkspace = announcementsWorkspace.getLoaded;

export const loadAdminConsoleTestingWorkspace = testingWorkspace.load;
export const preloadAdminConsoleTestingWorkspace = testingWorkspace.preload;
export const getLoadedAdminConsoleTestingWorkspace = testingWorkspace.getLoaded;

export function registerAdminConsoleStartupListeners() {
  if (typeof window === "undefined" || startupListenersRegistered) return;
  startupListenersRegistered = true;

  window.addEventListener("error", (event) => {
    const message = event?.message || event?.error?.message || "";
    if (!shouldLogStartupMessage(message)) return;
    logAdminRequestFailure(
      "Admin console startup window error",
      getErrorObject(event?.error, {
        message,
        stack: event?.error?.stack ?? "",
      }),
      {
        ...buildImportContext({
          source: "window.error",
          importTarget: "AdminConsoleStartup",
        }),
        filename: event?.filename ?? "",
        lineno: event?.lineno ?? null,
        colno: event?.colno ?? null,
      }
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason;
    const message = getErrorMessage(reason);
    if (!shouldLogStartupMessage(message)) return;
    logAdminRequestFailure(
      "Admin console startup unhandled rejection",
      getErrorObject(reason, {
        message,
      }),
      {
        ...buildImportContext({
          source: "unhandledrejection",
          importTarget: "AdminConsoleStartup",
        }),
      }
    );
  });
}
