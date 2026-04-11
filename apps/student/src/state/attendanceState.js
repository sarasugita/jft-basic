import { supabase } from "../supabaseClient";
import { getErrorMessage, logSupabaseError, logUnexpectedError } from "../lib/errorHelpers";
import { authState } from "./authState";

export let studentAttendanceState = {
  loaded: false,
  loading: false,
  list: [],
  error: "",
  userId: "",
};

export let absenceApplicationsState = {
  loaded: false,
  loading: false,
  list: [],
  error: "",
};

export async function fetchStudentAttendance() {
  if (!authState.session) return;
  if (studentAttendanceState.loading) return;
  studentAttendanceState.loading = true;
  studentAttendanceState.error = "";
  const hadData = studentAttendanceState.loaded && studentAttendanceState.list.length > 0;
  try {
    const { data, error } = await supabase
      .from("attendance_entries")
      .select("day_id, status, comment")
      .eq("student_id", authState.session.user.id);
    if (error) {
      logSupabaseError("attendance entries fetch error", error);
      if (!hadData) {
        studentAttendanceState.list = [];
      }
      studentAttendanceState.error = getErrorMessage(error, "Failed to load attendance.");
      return;
    }
    const entries = data ?? [];
    const dayIds = entries.map((e) => e.day_id).filter(Boolean);
    if (!dayIds.length) {
      studentAttendanceState.list = [];
      studentAttendanceState.loaded = true;
      return;
    }
    const { data: daysData, error: daysError } = await supabase
      .from("attendance_days")
      .select("id, day_date")
      .in("id", dayIds);
    if (daysError) {
      logSupabaseError("attendance days fetch error", daysError);
      if (!hadData) {
        studentAttendanceState.list = [];
      }
      studentAttendanceState.error = getErrorMessage(daysError, "Failed to load attendance.");
      return;
    }
    const dayMap = {};
    (daysData ?? []).forEach((d) => {
      dayMap[d.id] = d.day_date;
    });
    studentAttendanceState.list = entries
      .map((e) => ({
        day_id: e.day_id,
        day_date: dayMap[e.day_id] ?? "",
        status: e.status,
        comment: e.comment ?? ""
      }))
      .sort((a, b) => String(b.day_date).localeCompare(String(a.day_date)));
  } catch (error) {
    logUnexpectedError("attendance fetch failed", error);
    if (!hadData) {
      studentAttendanceState.list = [];
    }
    studentAttendanceState.error = getErrorMessage(error, "Failed to load attendance.");
  } finally {
    studentAttendanceState.loaded = true;
    studentAttendanceState.loading = false;
  }
}

export async function fetchAbsenceApplications() {
  if (!authState.session || absenceApplicationsState.loading) return;
  absenceApplicationsState.loading = true;
  absenceApplicationsState.error = "";
  const hadData = absenceApplicationsState.loaded && absenceApplicationsState.list.length > 0;
  try {
    const { data, error } = await supabase
      .from("absence_applications")
      .select("id, type, day_date, status, reason, catch_up, late_type, time_value, created_at")
      .eq("student_id", authState.session.user.id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      logSupabaseError("absence applications fetch error", error);
      if (!hadData) {
        absenceApplicationsState.list = [];
      }
      absenceApplicationsState.error = getErrorMessage(error, "Failed to load applications.");
      return;
    }
    absenceApplicationsState.list = data ?? [];
  } catch (error) {
    logUnexpectedError("absence applications fetch failed", error);
    if (!hadData) {
      absenceApplicationsState.list = [];
    }
    absenceApplicationsState.error = getErrorMessage(error, "Failed to load applications.");
  } finally {
    absenceApplicationsState.loaded = true;
    absenceApplicationsState.loading = false;
  }
}
