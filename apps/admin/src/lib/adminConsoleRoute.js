const ATTENDANCE_SUB_TABS = new Set(["sheet", "absence"]);
const TESTING_SUB_TABS = new Set(["results", "conduct", "upload"]);
const STARTUP_SCOPED_ADMIN_TABS = new Set([
  "announcements",
  "students",
  "attendance",
  "dailyRecord",
  "ranking",
]);

function normalizeSlug(slug) {
  if (Array.isArray(slug)) {
    return slug
      .map((segment) => String(segment ?? "").trim())
      .filter(Boolean);
  }
  if (slug == null) {
    return [];
  }
  const segment = String(slug).trim();
  return segment ? [segment] : [];
}

function normalizeTestingSubTab(value, fallback = "results") {
  return TESTING_SUB_TABS.has(value) ? value : fallback;
}

export function isStartupScopedAdminTab(adminTab) {
  return STARTUP_SCOPED_ADMIN_TABS.has(adminTab);
}

export function buildScopedAdminPathSegments(routeState = {}) {
  const adminTab = routeState.adminTab ?? "announcements";
  const attendanceSubTab = ATTENDANCE_SUB_TABS.has(routeState.attendanceSubTab)
    ? routeState.attendanceSubTab
    : "sheet";
  const modelSubTab = normalizeTestingSubTab(routeState.modelSubTab, "results");
  const dailySubTab = normalizeTestingSubTab(routeState.dailySubTab, "results");

  if (adminTab === "students") return ["students"];
  if (adminTab === "attendance") return ["attendance", attendanceSubTab];
  if (adminTab === "dailyRecord") return ["daily-record"];
  if (adminTab === "ranking") return ["ranking"];
  if (adminTab === "model") return ["model", modelSubTab];
  if (adminTab === "daily") return ["daily", dailySubTab];
  return ["announcements"];
}

export function buildScopedAdminHref(schoolId, routeState = {}, options = {}) {
  const encodedSchoolId = encodeURIComponent(String(schoolId ?? ""));
  const shouldUseRoot = Boolean(options.preferRoot && routeState.isRootEntry);
  const pathSegments = shouldUseRoot ? [] : buildScopedAdminPathSegments(routeState);
  const suffix = pathSegments.length ? `/${pathSegments.join("/")}` : "";
  return `/super/schools/${encodedSchoolId}/admin${suffix}`;
}

export function resolveScopedAdminRouteState(slug = []) {
  const segments = normalizeSlug(slug);
  const firstSegment = String(segments[0] ?? "").trim().toLowerCase();
  const secondSegment = String(segments[1] ?? "").trim().toLowerCase();

  let adminTab = "announcements";
  let attendanceSubTab = "sheet";
  let modelSubTab = "results";
  let dailySubTab = "results";

  if (firstSegment === "students") {
    adminTab = "students";
  } else if (firstSegment === "attendance") {
    adminTab = "attendance";
    attendanceSubTab = ATTENDANCE_SUB_TABS.has(secondSegment) ? secondSegment : "sheet";
  } else if (firstSegment === "daily-record" || firstSegment === "dailyrecord") {
    adminTab = "dailyRecord";
  } else if (firstSegment === "ranking") {
    adminTab = "ranking";
  } else if (firstSegment === "model") {
    adminTab = "model";
    modelSubTab = normalizeTestingSubTab(secondSegment, "results");
  } else if (firstSegment === "daily") {
    adminTab = "daily";
    dailySubTab = normalizeTestingSubTab(secondSegment, "results");
  } else if (firstSegment === "announcements" || firstSegment === "") {
    adminTab = "announcements";
  }

  const isRootEntry = segments.length === 0;
  const pathSegments = isRootEntry ? [] : buildScopedAdminPathSegments({
    adminTab,
    attendanceSubTab,
    modelSubTab,
    dailySubTab,
  });

  return {
    adminTab,
    attendanceSubTab,
    modelSubTab,
    dailySubTab,
    isRootEntry,
    usesStartupShell: isStartupScopedAdminTab(adminTab),
    pathSegments,
    pathKey: isRootEntry ? "index" : pathSegments.join("/"),
  };
}
