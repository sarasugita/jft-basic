import { publicSupabase } from "../supabaseClient";
import { getErrorMessage, logSupabaseError, logUnexpectedError } from "../lib/errorHelpers";

export let announcementsState = {
  loaded: false,
  loading: false,
  list: [],
  error: "",
};

export async function fetchAnnouncements() {
  if (announcementsState.loading) return;
  announcementsState.loading = true;
  announcementsState.error = "";
  const hadData = announcementsState.loaded && announcementsState.list.length > 0;
  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await publicSupabase
      .from("announcements")
      .select("id, title, body, publish_at, end_at, created_at")
      .lte("publish_at", nowIso)
      .or(`end_at.is.null,end_at.gte.${nowIso}`)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      logSupabaseError("announcements fetch error", error);
      if (!hadData) {
        announcementsState.list = [];
      }
      announcementsState.error = getErrorMessage(error, "Failed to load announcements.");
      return;
    }
    announcementsState.list = data ?? [];
  } catch (error) {
    logUnexpectedError("announcements fetch failed", error);
    if (!hadData) {
      announcementsState.list = [];
    }
    announcementsState.error = getErrorMessage(error, "Failed to load announcements.");
  } finally {
    announcementsState.loaded = true;
    announcementsState.loading = false;
  }
}
