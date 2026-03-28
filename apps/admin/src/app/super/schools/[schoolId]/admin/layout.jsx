/**
 * School-scoped admin layout.
 *
 * Phase 1: passthrough — AdminConsoleCore still handles all state and shell chrome.
 *
 * Phase 2 (per workspace): This layout will progressively take over:
 *   - Auth (from SuperAdminShell via useSuperAdmin())
 *   - School-scoped Supabase client creation
 *   - School name + options loading
 *   - AdminConsoleShellProvider (slim shared context)
 *   - AdminConsoleShellFrame (sidebar + topbar chrome)
 *
 * Until a workspace is migrated, AdminConsoleCore continues running unchanged.
 * Once all workspaces are migrated, AdminConsoleCore and AdminConsole are deleted
 * and this layout renders the active workspace page directly.
 */
export default function SchoolAdminLayout({ children }) {
  return children;
}
