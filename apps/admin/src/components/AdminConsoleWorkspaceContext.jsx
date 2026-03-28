"use client";

import { createContext, useContext } from "react";

const AdminConsoleWorkspaceContext = createContext(null);

export function AdminConsoleWorkspaceProvider({ value, children }) {
  return (
    <AdminConsoleWorkspaceContext.Provider value={value}>
      {children}
    </AdminConsoleWorkspaceContext.Provider>
  );
}

export function useAdminConsoleWorkspaceContext() {
  const value = useContext(AdminConsoleWorkspaceContext);
  if (!value) {
    throw new Error("Admin console workspace context is not available.");
  }
  return value;
}

