import { escapeHtml } from "../lib/escapeHtml";
import { formatDateFull, formatYearsOfExperience } from "../lib/formatters";
import {
  PERSONAL_UPLOAD_FIELDS,
  CERTIFICATE_STATUS_OPTIONS,
  SEX_OPTIONS,
  calculateAge,
  getPersonalInfoPayload,
  formatPersonalInfoValue,
  getProfileUploads,
  uploadProfileDocument,
  renderPersonalInfoUpload
} from "../lib/profileHelpers";
import { PROFILE_SELECT_FIELDS } from "../lib/constants";
import { state, saveState } from "../state/appState";
import { authState } from "../state/authState";
import { supabase } from "../supabaseClient";
import { triggerRender } from "../lib/renderBus";

const closeIconSvg = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 6l12 12M18 6l-12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
  </svg>
`;

export function buildPersonalInfoTabHTML() {
  const profile = authState.profile ?? {};
  const profileUploads = getProfileUploads(profile.profile_uploads);
  const dateOfBirth = profile.date_of_birth || "";
  const age = calculateAge(dateOfBirth);
  const yearsOfExperience = formatYearsOfExperience(profile.years_of_experience);
  const personalInfoRows = [
    { label: "Full Name", value: formatPersonalInfoValue(profile.display_name) },
    { label: "Email", value: formatPersonalInfoValue(profile.email || authState.session?.user?.email || "") },
    { label: "Phone Number", value: formatPersonalInfoValue(profile.phone_number) },
    {
      label: "Date of Birth",
      value: dateOfBirth
        ? `${escapeHtml(formatDateFull(dateOfBirth))}${age != null ? ` <span class="student-info-meta">Age ${age}</span>` : ""}`
        : `<span class="placeholder">Not provided</span>`
    },
    { label: "Sex", value: formatPersonalInfoValue(profile.sex) },
    { label: "UID", value: formatPersonalInfoValue(profile.student_code) },
    { label: "Current Working Facility", value: formatPersonalInfoValue(profile.current_working_facility) },
    { label: "Years of Experience", value: formatPersonalInfoValue(yearsOfExperience, "Not provided") },
    { label: "Nursing Certificate", value: formatPersonalInfoValue(profile.nursing_certificate) },
    { label: "Certificate Status", value: formatPersonalInfoValue(profile.nursing_certificate_status) },
    { label: "BNMC Registration Number", value: formatPersonalInfoValue(profile.bnmc_registration_number) },
    {
      label: "BNMC Registration Expiry Date",
      value: profile.bnmc_registration_expiry_date
        ? escapeHtml(formatDateFull(profile.bnmc_registration_expiry_date))
        : `<span class="placeholder">Not provided</span>`
    },
    { label: "Passport Number", value: formatPersonalInfoValue(profile.passport_number) },
    ...PERSONAL_UPLOAD_FIELDS.map((field) => ({
      label: field.label,
      value: renderPersonalInfoUpload(profileUploads[field.key]),
      wide: true
    }))
  ];

  return `
    <section class="home-card student-info-card">
      <div class="student-info-header">
        <div>
          <div class="student-home-title" style="margin-bottom:4px;">Personal Information</div>
          <div class="student-info-subtitle">Review your profile details and update them when needed.</div>
        </div>
        <button class="btn btn-primary" type="button" id="openPersonalInfoModal">Edit Information</button>
      </div>
      <div class="student-info-grid">
        ${personalInfoRows
          .map(
            (row) => `
              <div class="student-info-row ${row.wide ? "student-info-row-wide" : ""}">
                <div class="student-info-label">${escapeHtml(row.label)}</div>
                <div class="student-info-value">${row.value}</div>
              </div>
            `
          )
          .join("")}
      </div>
    </section>
    <div class="student-modal-overlay" id="personalInfoModal" hidden>
      <div class="student-modal student-info-modal" role="dialog" aria-modal="true" aria-labelledby="personalInfoTitle">
        <div class="student-modal-header">
          <div class="student-modal-title" id="personalInfoTitle">Edit Personal Information</div>
          <button class="student-modal-close" type="button" id="personalInfoClose" aria-label="Close">${closeIconSvg}</button>
        </div>
        <div class="student-modal-body">
          <div class="student-info-form-grid">
            <div>
              <label class="form-label">Full Name</label>
              <input class="form-input" id="personalFullName" value="${escapeHtml(profile.display_name || "")}" />
            </div>
            <div>
              <label class="form-label">Email</label>
              <input class="form-input" id="personalEmail" type="email" value="${escapeHtml(profile.email || authState.session?.user?.email || "")}" disabled />
              <div class="text-muted">Login email can only be changed by admin.</div>
            </div>
            <div>
              <label class="form-label">Phone Number</label>
              <input class="form-input" id="personalPhone" value="${escapeHtml(profile.phone_number || "")}" />
            </div>
            <div>
              <label class="form-label">UID</label>
              <input class="form-input" id="personalUid" value="${escapeHtml(profile.student_code || "")}" disabled />
              <div class="text-muted">Student number is managed by admin.</div>
            </div>
            <div>
              <label class="form-label">Date of Birth</label>
              <input class="form-input" id="personalDob" type="date" value="${escapeHtml(dateOfBirth)}" />
              <div class="student-info-age" id="personalAgeValue">${age != null ? `Age ${age}` : "Age -"}</div>
            </div>
            <div>
              <label class="form-label">Sex</label>
              <select class="form-input" id="personalSex">
                <option value="">Select</option>
                ${SEX_OPTIONS.map((option) => `<option value="${escapeHtml(option)}" ${profile.sex === option ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
              </select>
            </div>
            <div>
              <label class="form-label">Current Working Facility</label>
              <input class="form-input" id="personalFacility" value="${escapeHtml(profile.current_working_facility || "")}" />
            </div>
            <div>
              <label class="form-label">Years of Experience</label>
              <input class="form-input" id="personalYearsExperience" type="number" min="0" step="0.1" value="${escapeHtml(yearsOfExperience)}" />
            </div>
            <div>
              <label class="form-label">Nursing Certificate</label>
              <input class="form-input" id="personalNursingCertificate" value="${escapeHtml(profile.nursing_certificate || "")}" />
            </div>
            <div>
              <label class="form-label">Certificate Status</label>
              <select class="form-input" id="personalCertificateStatus">
                <option value="">Select</option>
                ${CERTIFICATE_STATUS_OPTIONS.map((option) => `<option value="${option.value}" ${profile.nursing_certificate_status === option.value ? "selected" : ""}>${option.label}</option>`).join("")}
              </select>
            </div>
            <div>
              <label class="form-label">BNMC Registration Number</label>
              <input class="form-input" id="personalBnmcNumber" value="${escapeHtml(profile.bnmc_registration_number || "")}" />
            </div>
            <div>
              <label class="form-label">BNMC Registration Expiry Date</label>
              <input class="form-input" id="personalBnmcExpiry" type="date" value="${escapeHtml(profile.bnmc_registration_expiry_date || "")}" />
            </div>
            <div>
              <label class="form-label">Passport Number</label>
              <input class="form-input" id="personalPassportNumber" value="${escapeHtml(profile.passport_number || "")}" />
            </div>
            ${PERSONAL_UPLOAD_FIELDS.map((field) => {
              const currentUpload = profileUploads[field.key];
              return `
                <div>
                  <label class="form-label">${escapeHtml(field.label)}</label>
                  <input
                    class="form-input"
                    data-profile-upload-key="${escapeHtml(field.key)}"
                    type="file"
                    accept="${escapeHtml(field.accept)}"
                  />
                  ${
                    currentUpload?.url
                      ? `
                        <div class="student-info-upload-help">Current file</div>
                        ${renderPersonalInfoUpload(currentUpload)}
                      `
                      : `<div class="student-info-upload-help">Upload ${escapeHtml(field.label.toLowerCase())}.</div>`
                  }
                </div>
              `;
            }).join("")}
          </div>
          <div class="admin-msg" id="personalInfoMsg" style="margin-top:10px;"></div>
        </div>
        <div class="student-modal-actions">
          <button class="btn btn-primary" id="personalInfoSave" type="button">Save Information</button>
        </div>
      </div>
    </div>
  `;
}

export function bindPersonalInfoTabEvents(app) {
  const personalModal = app.querySelector("#personalInfoModal");
  const personalMsg = app.querySelector("#personalInfoMsg");
  const dobInput = app.querySelector("#personalDob");
  const ageValue = app.querySelector("#personalAgeValue");

  const syncAge = () => {
    if (!ageValue || !(dobInput instanceof HTMLInputElement)) return;
    const age = calculateAge(dobInput.value);
    ageValue.textContent = age != null ? `Age ${age}` : "Age -";
  };

  app.querySelector("#openPersonalInfoModal")?.addEventListener("click", () => {
    if (personalModal) personalModal.hidden = false;
    syncAge();
  });

  app.querySelector("#personalInfoClose")?.addEventListener("click", () => {
    if (personalModal) personalModal.hidden = true;
  });

  dobInput?.addEventListener("input", syncAge);

  personalModal?.addEventListener("click", (event) => {
    if (event.target === personalModal) personalModal.hidden = true;
  });

  app.querySelector("#personalInfoSave")?.addEventListener("click", async () => {
    if (!authState.session?.user?.id) return;
    if (personalMsg) personalMsg.textContent = "";
    const saveBtn = app.querySelector("#personalInfoSave");
    if (saveBtn instanceof HTMLButtonElement) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";
    }
    const nextUploads = { ...getProfileUploads(authState.profile?.profile_uploads) };
    for (const field of PERSONAL_UPLOAD_FIELDS) {
      const input = app.querySelector(`[data-profile-upload-key="${field.key}"]`);
      const file = input instanceof HTMLInputElement ? input.files?.[0] ?? null : null;
      if (!file) continue;
      const { asset, error: uploadError } = await uploadProfileDocument(file, authState.session.user.id, field.key);
      if (uploadError) {
        if (personalMsg) personalMsg.textContent = `Upload failed: ${uploadError.message}`;
        if (saveBtn instanceof HTMLButtonElement) {
          saveBtn.disabled = false;
          saveBtn.textContent = "Save Information";
        }
        return;
      }
      if (asset?.url) nextUploads[field.key] = asset;
    }
    const payload = getPersonalInfoPayload({
      display_name: app.querySelector("#personalFullName")?.value,
      email: authState.profile?.email || authState.session?.user?.email || "",
      phone_number: app.querySelector("#personalPhone")?.value,
      date_of_birth: app.querySelector("#personalDob")?.value,
      sex: app.querySelector("#personalSex")?.value,
      student_code: authState.profile?.student_code || "",
      current_working_facility: app.querySelector("#personalFacility")?.value,
      years_of_experience: app.querySelector("#personalYearsExperience")?.value,
      nursing_certificate: app.querySelector("#personalNursingCertificate")?.value,
      nursing_certificate_status: app.querySelector("#personalCertificateStatus")?.value,
      bnmc_registration_number: app.querySelector("#personalBnmcNumber")?.value,
      bnmc_registration_expiry_date: app.querySelector("#personalBnmcExpiry")?.value,
      passport_number: app.querySelector("#personalPassportNumber")?.value,
      profile_uploads: nextUploads
    });
    const { data, error } = await supabase
      .from("profiles")
      .update(payload)
      .eq("id", authState.session.user.id)
      .select(PROFILE_SELECT_FIELDS)
      .single();
    if (error) {
      if (personalMsg) personalMsg.textContent = `Save failed: ${error.message}`;
      if (saveBtn instanceof HTMLButtonElement) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Information";
      }
      return;
    }
    authState.profile = data ?? { ...(authState.profile || {}), ...payload };
    state.user = {
      name: (authState.profile?.display_name ?? "").trim(),
      id: (authState.profile?.student_code ?? "").trim()
    };
    saveState();
    triggerRender();
  });
}
