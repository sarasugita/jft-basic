export const STORAGE_KEY = "jft_mock_state_v3";
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
export const TOTAL_TIME_SEC = 60 * 60;
export const SESSION_ATTEMPT_OVERRIDE_REFRESH_MS = 15 * 1000;
export const TEST_VERSION = "test_exam";
export const PASS_RATE_DEFAULT = 0.8;

export const PROFILE_SELECT_FIELDS = [
  "id",
  "role",
  "school_id",
  "email",
  "display_name",
  "student_code",
  "phone_number",
  "date_of_birth",
  "sex",
  "current_working_facility",
  "years_of_experience",
  "nursing_certificate",
  "nursing_certificate_status",
  "bnmc_registration_number",
  "bnmc_registration_expiry_date",
  "passport_number",
  "profile_uploads",
  "force_password_change"
].join(", ");

export const QUESTION_SELECT_BASE = "question_id, section_key, type, prompt_en, prompt_bn, answer_index, order_index, data";
