import { supabase } from "../supabaseClient";
import { getErrorMessage, logSupabaseError, logUnexpectedError } from "../lib/errorHelpers";
import { authState } from "./authState";

export let studentSchoolState = {
  loaded: false,
  loading: false,
  name: "",
  error: "",
  schoolId: "",
};

export async function fetchStudentSchool() {
  const schoolId = authState.profile?.school_id ?? "";
  if (!schoolId || studentSchoolState.loading) return;
  if (studentSchoolState.loaded && studentSchoolState.schoolId === schoolId) return;
  studentSchoolState.loading = true;
  studentSchoolState.error = "";
  try {
    const { data, error } = await supabase
      .from("schools")
      .select("id, name")
      .eq("id", schoolId)
      .maybeSingle();
    if (error) {
      logSupabaseError("student school fetch error", error);
      studentSchoolState.name = "";
      studentSchoolState.error = getErrorMessage(error, "Failed to load school.");
      return;
    }
    studentSchoolState.name = String(data?.name ?? "").trim();
    studentSchoolState.schoolId = schoolId;
  } catch (error) {
    logUnexpectedError("student school fetch failed", error);
    studentSchoolState.name = "";
    studentSchoolState.error = getErrorMessage(error, "Failed to load school.");
  } finally {
    studentSchoolState.loaded = true;
    studentSchoolState.loading = false;
  }
}
