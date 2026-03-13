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

export function logAdminEvent(event, details = {}) {
  console.info(`[AdminAuth] ${event}`, details);
}

export function logAdminRequestFailure(context, error, extra = {}) {
  const payload = getAdminErrorInfo(error, extra);
  const logger = payload.aborted ? console.warn : console.error;
  logger(`[AdminAuth] ${context}`, payload);
  return payload;
}
