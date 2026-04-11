import { supabase } from "../supabaseClient";
import { getErrorMessage, logSupabaseError, logUnexpectedError, isMissingStudentWarningsTableError } from "../lib/errorHelpers";

export let issuedWarningsState = {
  loaded: false,
  loading: false,
  list: [],
  error: "",
};

export async function fetchIssuedStudentWarnings() {
  const { authState } = await import("./authState");
  if (!authState.session || issuedWarningsState.loading) return;
  if (!authState.profile?.school_id) return;
  issuedWarningsState.loading = true;
  issuedWarningsState.error = "";
  const hadData = issuedWarningsState.loaded && issuedWarningsState.list.length > 0;
  try {
    const { data: recipientRows, error: recipientError } = await supabase
      .from("student_warning_recipients")
      .select("id, warning_id, issues, created_at")
      .eq("student_id", authState.session.user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (recipientError) {
      logSupabaseError("student warning recipients fetch error", recipientError);
      if (!hadData) issuedWarningsState.list = [];
      issuedWarningsState.error = getErrorMessage(recipientError, "Failed to load warnings.");
      return;
    }
    const recipientList = recipientRows ?? [];
    if (!recipientList.length) {
      issuedWarningsState.list = [];
      return;
    }
    const warningIds = Array.from(new Set(recipientList.map((row) => row.warning_id).filter(Boolean)));
    const { data: warningRows, error: warningError } = await supabase
      .from("student_warnings")
      .select("id, title, created_at")
      .in("id", warningIds);
    if (warningError) {
      if (!isMissingStudentWarningsTableError(warningError)) {
        logSupabaseError("student warnings fetch error", warningError);
      }
      if (!hadData) issuedWarningsState.list = [];
      issuedWarningsState.error = isMissingStudentWarningsTableError(warningError)
        ? "Warning tables are not available yet."
        : getErrorMessage(warningError, "Failed to load warnings.");
      return;
    }
    const warningsById = new Map((warningRows ?? []).map((warning) => [warning.id, warning]));
    issuedWarningsState.list = recipientList
      .map((recipient) => {
        const warning = warningsById.get(recipient.warning_id) || null;
        return {
          id: recipient.id,
          warning_id: recipient.warning_id,
          title: warning?.title || "Warning",
          created_at: warning?.created_at || recipient.created_at || "",
          issues: (Array.isArray(recipient.issues) ? recipient.issues : []).map((item) => String(item ?? "").trim()).filter(Boolean),
        };
      })
      .sort((left, right) => String(right.created_at ?? "").localeCompare(String(left.created_at ?? "")));
  } catch (error) {
    logUnexpectedError("student warnings fetch failed", error);
    if (!hadData) issuedWarningsState.list = [];
    issuedWarningsState.error = getErrorMessage(error, "Failed to load warnings.");
  } finally {
    issuedWarningsState.loaded = true;
    issuedWarningsState.loading = false;
  }
}
