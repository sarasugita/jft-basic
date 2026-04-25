"use client";

import AdminLoadingState from "./AdminLoadingState";

const NAV_ITEMS = [
  { key: "announcements", label: "Announcements" },
  { key: "students", label: "Student List" },
  { key: "attendance", label: "Attendance" },
  { key: "model", label: "Model Test" },
  { key: "daily", label: "Daily Test" },
  { key: "dailyRecord", label: "Schedule & Record" },
  { key: "ranking", label: "Ranking" },
];

function getAdminPageTitle(activeTab) {
  if (activeTab === "announcements") return "Announcements";
  if (activeTab === "attendance") return "Attendance";
  if (activeTab === "model") return "Model Test";
  if (activeTab === "daily") return "Daily Test";
  if (activeTab === "dailyRecord") return "Schedule & Record";
  if (activeTab === "ranking") return "Ranking";
  return "Student List";
}

export default function AdminConsoleShellFrame({
  schoolName = "",
  displayName = "",
  activeTab = "announcements",
  schoolSelector = null,
  changeSchoolHref = "",
  onChangeSchool = null,
  onSelectTab = null,
  children = null,
}) {
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-head">
          <div className="admin-brand">
            <div className="admin-brand-text">
              <div className="admin-brand-title">
                <img className="admin-brand-logo" src="/branding/jft-navi-color.png" alt="JFT Navi" />
              </div>
              <div className="admin-brand-sub">Admin Console</div>
            </div>
          </div>
        </div>
        <div className="admin-nav" aria-hidden="true">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              className={`admin-nav-item ${activeTab === item.key ? "active" : ""}`}
              type="button"
              disabled={typeof onSelectTab !== "function"}
              onClick={() => onSelectTab?.(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="admin-sidebar-footer">
          <div className="admin-email">{displayName || <AdminLoadingState compact label="Loading user..." />}</div>
        </div>
      </aside>

      <div className="admin-main">
        <div className="admin-wrap">
          <div className="admin-page-topbar">
            <div className="admin-page-topbar-title">{getAdminPageTitle(activeTab)}</div>
            <div className="admin-page-topbar-meta">
              {schoolSelector || (
                <div className="admin-school-switcher admin-topbar-school-switcher">
                  <label>School</label>
                  <div className="admin-topbar-school-label">{schoolName || <AdminLoadingState compact label="Loading school..." />}</div>
                </div>
              )}
              {changeSchoolHref ? (
                <button
                  className="btn admin-topbar-link"
                  type="button"
                  onClick={onChangeSchool}
                >
                  Change school
                </button>
              ) : null}
              <div className="admin-page-topbar-console">Admin Console</div>
              <div className="admin-page-topbar-user">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" fill="currentColor" />
                  <path d="M4 20a8 8 0 0 1 16 0Z" fill="currentColor" />
                </svg>
                <span>{displayName || <AdminLoadingState compact label="Loading user..." />}</span>
              </div>
            </div>
          </div>

          <div className="admin-panel admin-console-panel">{children}</div>
        </div>
      </div>
    </div>
  );
}
