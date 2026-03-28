"use client";

import { createContext, useContext } from "react";

const AdminConsoleShellContext = createContext(null);

/**
 * Provides the slim shared shell context to all workspace pages.
 *
 * Shape of `value`:
 * {
 *   supabase,           // school-scoped Supabase client
 *   session,            // auth session
 *   profile,            // user profile (role, display_name)
 *   activeSchoolId,     // resolved school id
 *   schoolName,         // resolved school display name
 *   schoolOptions,      // array of { school_id, school_name, school_status }
 *   canUseAdminConsole, // boolean
 *   openAttemptDetail,  // fn(attempt, source) — shared trigger for attempt detail modal
 * }
 *
 * This context is populated by the admin layout once per workspace phase migration.
 * Until a workspace is migrated it remains null; migrated workspaces call
 * useAdminConsoleShell() instead of useAdminConsoleWorkspaceContext().
 */
export function AdminConsoleShellProvider({ value, children }) {
  return (
    <AdminConsoleShellContext.Provider value={value}>
      {children}
    </AdminConsoleShellContext.Provider>
  );
}

/**
 * Returns the shell context or null if the workspace hasn't been migrated yet.
 * Migrated workspaces should assert the return value is non-null.
 */
export function useAdminConsoleShell() {
  return useContext(AdminConsoleShellContext);
}
