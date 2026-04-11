export function isMissingTabLeftCountError(error) {
  const text = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`;
  return /tab_left_count/i.test(text) && /does not exist/i.test(text);
}

export function isMissingRetakeSessionFieldsError(error) {
  const text = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`;
  return /(retake_source_session_id|retake_release_scope)/i.test(text) && /does not exist/i.test(text);
}

export function isMissingSessionAttemptOverrideTableError(error) {
  const text = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`;
  return /test_session_attempt_overrides/i.test(text) && /does not exist/i.test(text);
}

export function isMissingStudentWarningsTableError(error) {
  const text = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`;
  return /student_warnings/i.test(text) && /does not exist/i.test(text);
}

export function getSupabaseErrorInfo(error) {
  return {
    message: error?.message ?? "Unknown error",
    code: error?.code ?? "",
    details: error?.details ?? "",
    hint: error?.hint ?? "",
    status: error?.status ?? "",
  };
}

export function getErrorMessage(error, fallback) {
  return getSupabaseErrorInfo(error).message || fallback;
}

export function logSupabaseError(context, error) {
  if (!error) return;
  console.error(`${context}:`, getSupabaseErrorInfo(error));
}

export function logUnexpectedError(context, error) {
  if (error?.message || error?.code || error?.details || error?.hint || error?.status) {
    logSupabaseError(context, error);
    return;
  }
  console.error(`${context}:`, error);
}
