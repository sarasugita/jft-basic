import { supabase } from "../supabaseClient";
import { escapeHtml } from "./escapeHtml";

export const PROFILE_UPLOAD_BUCKET = "test-assets";

export const PERSONAL_UPLOAD_FIELDS = [
  { key: "passport_bio_page", label: "Bio Page Image", accept: "image/*" }
];

export const CERTIFICATE_STATUS_OPTIONS = [
  { value: "ongoing", label: "Ongoing" },
  { value: "completed", label: "Completed" }
];

export const SEX_OPTIONS = ["Male", "Female", "Other"];

export function calculateAge(dateOfBirth) {
  if (!dateOfBirth) return null;
  const match = String(dateOfBirth).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const today = new Date();
  let age = today.getFullYear() - year;
  const monthDiff = today.getMonth() + 1 - month;
  const dayDiff = today.getDate() - day;
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1;
  return age >= 0 ? age : null;
}

export function getPersonalInfoPayload(values) {
  const yearsRaw = String(values.years_of_experience ?? "").trim();
  const years = yearsRaw === "" ? null : Number(yearsRaw);
  return {
    display_name: String(values.display_name ?? "").trim() || null,
    email: String(values.email ?? "").trim() || null,
    phone_number: String(values.phone_number ?? "").trim() || null,
    date_of_birth: String(values.date_of_birth ?? "").trim() || null,
    sex: String(values.sex ?? "").trim() || null,
    student_code: String(values.student_code ?? "").trim() || null,
    current_working_facility: String(values.current_working_facility ?? "").trim() || null,
    years_of_experience: Number.isFinite(years) ? years : null,
    nursing_certificate: String(values.nursing_certificate ?? "").trim() || null,
    nursing_certificate_status: String(values.nursing_certificate_status ?? "").trim() || null,
    bnmc_registration_number: String(values.bnmc_registration_number ?? "").trim() || null,
    bnmc_registration_expiry_date: String(values.bnmc_registration_expiry_date ?? "").trim() || null,
    passport_number: String(values.passport_number ?? "").trim() || null,
    profile_uploads: getProfileUploads(values.profile_uploads)
  };
}

export function formatPersonalInfoValue(value, emptyLabel = "Not provided") {
  return value ? escapeHtml(String(value)) : `<span class="placeholder">${escapeHtml(emptyLabel)}</span>`;
}

export function getProfileUploads(value) {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

export function getFileExtension(filename) {
  const ext = String(filename ?? "").trim().split(".").pop() ?? "";
  return ext.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

export async function uploadProfileDocument(file, userId, uploadKey) {
  if (!file || !userId || !uploadKey) return { asset: null, error: null };
  const ext = getFileExtension(file.name) || "jpg";
  const filePath = `profile-documents/${userId}/${uploadKey}-${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from(PROFILE_UPLOAD_BUCKET)
    .upload(filePath, file, { upsert: true, contentType: file.type || undefined });
  if (uploadError) return { asset: null, error: uploadError };
  const { data } = supabase.storage.from(PROFILE_UPLOAD_BUCKET).getPublicUrl(filePath);
  return {
    asset: {
      url: data?.publicUrl ?? "",
      name: file.name,
      mime_type: file.type || null,
      uploaded_at: new Date().toISOString()
    },
    error: null
  };
}

export function isImageUpload(asset) {
  const mime = String(asset?.mime_type ?? "").toLowerCase();
  const url = String(asset?.url ?? "").toLowerCase();
  return mime.startsWith("image/") || [".png", ".jpg", ".jpeg", ".gif", ".webp"].some((ext) => url.endsWith(ext));
}

export function renderPersonalInfoUpload(asset) {
  const url = String(asset?.url ?? "").trim();
  if (!url) return `<span class="placeholder">Not uploaded</span>`;
  const safeUrl = escapeHtml(url);
  const safeName = escapeHtml(String(asset?.name ?? "View file"));
  return `
    <div class="student-info-image-block">
      <a class="student-info-image-link" href="${safeUrl}" target="_blank" rel="noreferrer">${safeName}</a>
      ${isImageUpload(asset) ? `<img class="student-info-image-preview" src="${safeUrl}" alt="${safeName}" />` : ""}
    </div>
  `;
}
