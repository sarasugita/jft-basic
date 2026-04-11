import { escapeHtml } from "../lib/escapeHtml";
import { eyeIcon, eyeOffIcon } from "../lib/icons";
import { getActiveTestType } from "../lib/sessionHelpers";
import { hasLinkParam } from "../lib/linkHelpers";
import { state, saveState, goIntro } from "../state/appState";
import { authState } from "../state/authState";
import { testsState } from "../state/testsState";
import { supabase } from "../supabaseClient";
import { triggerRender } from "../lib/renderBus";

export function renderLogin(app) {
  const isDaily = getActiveTestType() === "daily";
  const showGuest = hasLinkParam() && testsState.loaded && !isDaily;
  const emailPrefill = authState.session?.user?.email ?? "";
  app.innerHTML = `
    <div class="app">
      <main class="student-login-screen">
        <div class="student-login-card">
          <div class="student-login-header">
            <img class="student-login-logo" src="/branding/jft-navi-color.png" alt="JFT Navi" />
          </div>
          <div class="student-login-divider"></div>
          <form id="studentLoginForm" class="student-login-form">
            <label class="student-login-label" for="email">Email</label>
            <input
              id="email"
              class="student-login-input"
              type="email"
              placeholder="example@gmail.com"
              value="${escapeHtml(emailPrefill)}"
            />

            <label class="student-login-label" for="password">Password</label>
            <div class="student-login-password">
              <input
                id="password"
                class="student-login-input student-login-password-input"
                type="password"
                placeholder="password"
              />
              <button class="student-login-toggle" type="button" id="studentLoginToggle" aria-label="Show password">
                ${eyeOffIcon()}
              </button>
            </div>

            <button class="student-login-submit" id="loginBtn" type="submit">LOGIN</button>
            ${
              showGuest
                ? `
                  <button class="student-login-guest" id="guestBtn" type="button">Take as Guest</button>
                  <p class="student-login-note">You can also take this test as a guest from this link.</p>
                `
                : ""
            }
          </form>

          <p id="msg" class="student-login-msg"></p>
        </div>
      </main>
    </div>
  `;

  const emailEl = app.querySelector("#email");
  const passEl = app.querySelector("#password");
  const msgEl = app.querySelector("#msg");
  const toggleEl = app.querySelector("#studentLoginToggle");

  toggleEl?.addEventListener("click", () => {
    const next = passEl.type === "password" ? "text" : "password";
    passEl.type = next;
    toggleEl.innerHTML = next === "text" ? eyeIcon() : eyeOffIcon();
  });

  app.querySelector("#studentLoginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    msgEl.textContent = "";
    const email = emailEl.value.trim();
    const password = passEl.value;
    if (!email || !password) {
      msgEl.textContent = "Email / Password を入力してください。";
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      msgEl.textContent = error.message;
      return;
    }
    state.studentTab = "home";
    state.requireLogin = false;
    state.linkLoginRequired = false;
    state.phase = "intro";
    saveState();
  });

  if (showGuest) {
    app.querySelector("#guestBtn")?.addEventListener("click", () => {
      supabase.auth.signOut();
      state.requireLogin = false;
      state.linkLoginRequired = false;
      goIntro();
    });
  }
}
