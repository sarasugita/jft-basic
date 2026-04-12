const QUESTION_SET_LIBRARY_REFRESH_KEY = "jft_admin_question_set_library_refresh";
const QUESTION_SET_LIBRARY_REFRESH_EVENT = "jft-admin-question-set-library-refresh";

export function notifyQuestionSetLibraryUpdated() {
  if (typeof window === "undefined") return;

  const payload = String(Date.now());
  try {
    window.localStorage.setItem(QUESTION_SET_LIBRARY_REFRESH_KEY, payload);
  } catch (error) {
    console.warn("question set library refresh broadcast failed:", error);
  }
  window.dispatchEvent(new Event(QUESTION_SET_LIBRARY_REFRESH_EVENT));
}

export function subscribeQuestionSetLibraryUpdated(onRefresh) {
  if (typeof window === "undefined" || typeof onRefresh !== "function") {
    return () => {};
  }

  const handleStorage = (event) => {
    if (event?.key === QUESTION_SET_LIBRARY_REFRESH_KEY) {
      onRefresh(event);
    }
  };

  const handleCustomEvent = () => {
    onRefresh();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(QUESTION_SET_LIBRARY_REFRESH_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(QUESTION_SET_LIBRARY_REFRESH_EVENT, handleCustomEvent);
  };
}
