const ADMIN_DIAGNOSTICS_STORAGE_KEY = "jft_admin_recent_diagnostics";
const MAX_STORED_ADMIN_DIAGNOSTICS = 100;

export function isAbortLikeError(error) {
  const name = String(error?.name ?? "").trim();
  const code = String(error?.code ?? "").trim();
  const message = String(error?.message ?? "").trim();
  const details = String(error?.details ?? "").trim();
  const hint = String(error?.hint ?? "").trim();
  const haystack = `${name} ${code} ${message} ${details} ${hint}`.toLowerCase();
  return (
    name === "AbortError"
    || code === "20"
    || /\babort(ed|ing)?\b/.test(haystack)
    || /\bcancel(l)?ed\b/.test(haystack)
  );
}

export function getAdminErrorInfo(error, extra = {}) {
  if (!error) {
    return {
      message: "",
      code: "",
      details: "",
      hint: "",
      status: null,
      aborted: false,
      ...extra,
    };
  }

  const message = String(error?.message ?? error?.error_description ?? error?.error ?? "").trim();
  const code = String(error?.code ?? error?.error_code ?? "").trim();
  const details = String(error?.details ?? "").trim();
  const hint = String(error?.hint ?? "").trim();
  const statusRaw = error?.status ?? error?.statusCode ?? error?.response?.status ?? null;
  const status = Number.isFinite(Number(statusRaw)) ? Number(statusRaw) : null;

  return {
    message,
    code,
    details,
    hint,
    status,
    aborted: isAbortLikeError(error),
    ...extra,
  };
}

function persistAdminDiagnostic(entry) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.sessionStorage.getItem(ADMIN_DIAGNOSTICS_STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    const nextList = Array.isArray(list) ? list : [];
    nextList.push({
      timestamp: new Date().toISOString(),
      ...entry,
    });
    const trimmed = nextList.slice(-MAX_STORED_ADMIN_DIAGNOSTICS);
    window.sessionStorage.setItem(ADMIN_DIAGNOSTICS_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore storage failures so diagnostics never break runtime behavior.
  }
}

function getStoredAdminDiagnostics() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(ADMIN_DIAGNOSTICS_STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function getAdminDiagnosticsReport(extra = {}) {
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    currentPath:
      typeof window !== "undefined"
        ? window.location?.pathname ?? ""
        : "",
    ...extra,
    events: getStoredAdminDiagnostics(),
  }, null, 2);
}

export function logAdminEvent(event, details = {}) {
  console.info(`[AdminAuth] ${event}`, details);
  persistAdminDiagnostic({
    level: "info",
    event,
    details,
  });
}

export function createAdminTrace(step, details = {}) {
  const start = typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

  logAdminEvent(`${step} start`, details);

  return function finish(status, extra = {}) {
    const end = typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
    const durationMs = Math.round((end - start) * 10) / 10;
    logAdminEvent(`${step} ${status}`, {
      ...details,
      ...extra,
      durationMs,
    });
  };
}

export function logAdminRequestFailure(context, error, extra = {}) {
  const payload = getAdminErrorInfo(error, extra);
  const logger = payload.aborted ? console.warn : console.error;
  logger(`[AdminAuth] ${context}`, payload);
  persistAdminDiagnostic({
    level: payload.aborted ? "warn" : "error",
    event: context,
    details: payload,
  });
  return payload;
}
