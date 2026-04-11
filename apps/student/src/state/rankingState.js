import { supabase } from "../supabaseClient";
import { getErrorMessage, logSupabaseError, logUnexpectedError } from "../lib/errorHelpers";
import { authState } from "./authState";

export let rankingState = {
  loaded: false,
  loading: false,
  list: [],
  error: "",
  userId: "",
};

export async function fetchStudentRanking() {
  if (rankingState.loading) return;
  if (!authState.profile?.school_id) {
    return;
  }
  rankingState.loading = true;
  rankingState.error = "";
  const hadData = rankingState.loaded && rankingState.list.length > 0;
  try {
    const { data, error } = await supabase
      .from("ranking_periods")
      .select(`
        id,
        label,
        start_date,
        end_date,
        sort_order,
        ranking_entries(student_id, student_name, average_rate, rank_position)
      `)
      .eq("school_id", authState.profile.school_id)
      .order("sort_order", { ascending: true });
    if (error) {
      logSupabaseError("ranking fetch error", error);
      if (!hadData) {
        rankingState.list = [];
      }
      rankingState.error = getErrorMessage(error, "Failed to load rankings.");
      return;
    }
    const currentUserId = authState.session?.user?.id ?? "";
    rankingState.list = (data ?? []).map((period) => {
      const entries = [...(period.ranking_entries ?? [])].sort((a, b) => (a.rank_position ?? 0) - (b.rank_position ?? 0));
      const index = entries.findIndex((entry) => entry.student_id === currentUserId);
      return {
        ...period,
        ranking_entries: entries,
        currentEntry: index >= 0 ? entries[index] : null,
        higherEntry: index > 0 ? entries[index - 1] : null,
        lowerEntry: index >= 0 && index < entries.length - 1 ? entries[index + 1] : null,
      };
    });
  } catch (error) {
    logUnexpectedError("ranking fetch failed", error);
    if (!hadData) {
      rankingState.list = [];
    }
    rankingState.error = getErrorMessage(error, "Failed to load rankings.");
  } finally {
    rankingState.loaded = true;
    rankingState.loading = false;
  }
}
