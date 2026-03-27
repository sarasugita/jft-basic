"use client";

import { useEffect } from "react";
import { registerAdminConsoleStartupListeners } from "./adminConsoleLoader";

export default function AdminStartupDiagnostics() {
  useEffect(() => {
    registerAdminConsoleStartupListeners();
  }, []);

  return null;
}
