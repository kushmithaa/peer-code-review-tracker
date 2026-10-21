/* Login page. In Demo Mode, people pick a sample user instead of typing a password. */

import * as authApi from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { normalizeRole, ROLE_HOME, navigate, isDemo, mountDemoBanner, escapeHTML, initials } from "./common.js";

const $ = (id) => document.getElementById(id);
const emailInput = $("email");
const passwordInput = $("password");
const loginBtn = $("loginBtn");
const message = $("message");

function say(text, type = "error") {
    message.textContent = text;
    message.className = `form-msg ${type}`;
}

function resetButton() {
    loginBtn.disabled = false;
    loginBtn.textContent = "Login";
}

const ERRORS = {
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/user-not-found": "No account found with this email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-email": "Please enter a valid email.",
    "auth/user-disabled": "This account has been disabled.",
    "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
    "auth/network-request-failed": "Network error. Check your internet connection and try again."
};

if (new URLSearchParams(window.location.search).get("error") === "norole") {
    say("Your account has no valid role, so you were signed out. Ask your Team Lead for help.");
}

/* ---------- Demo Mode ---------- */
async function startDemo() {
    $("livePanel").classList.add("hidden");
    $("demoPanel").classList.remove("hidden");
    mountDemoBanner();

    const people = authApi.demoPersonas ? authApi.demoPersonas() : [];
    const order = { Developer: 0, Reviewer: 1, "Team Lead": 2 };
    people.sort((a, b) => (order[normalizeRole(a.role)] ?? 9) - (order[normalizeRole(b.role)] ?? 9));

    $("personaGrid").innerHTML = people.map((p) => `
        <button type="button" class="persona" role="listitem" data-uid="${escapeHTML(p.uid)}" data-r="${escapeHTML(normalizeRole(p.role) || "")}">
            <span class="avatar">${escapeHTML(initials(p.name))}</span>
            <span><b>${escapeHTML(p.name)}</b><small>${escapeHTML(normalizeRole(p.role) || p.role)} · ${escapeHTML(p.email)}</small></span>
        </button>`).join("") || `<p class="muted">No demo users found. Use “Reset demo data” in the banner.</p>`;

    $("personaGrid").addEventListener("click", async (event) => {
        const btn = event.target.closest("[data-uid]");
        if (!btn) return;
        btn.disabled = true;
        try {
            await authApi.demoSignIn(btn.dataset.uid);
            const role = normalizeRole(btn.dataset.r);
            navigate("pages/" + ROLE_HOME[role]);
        } catch (error) {
            console.error("Demo sign-in failed:", error);
            btn.disabled = false;
        }
    });
}

if (isDemo()) {
    await startDemo();
} else {
    loginBtn.addEventListener("click", async () => {
        const email = emailInput.value.trim();
        const password = passwordInput.value;

        if (!email || !password) {
            say("Please enter your email and password.");
            return;
        }

        try {
            loginBtn.disabled = true;
            loginBtn.textContent = "Logging in...";
            say("", "info");

            const { user } = await authApi.signInWithEmailAndPassword(auth, email, password);
            const userDoc = await getDoc(doc(db, "users", user.uid));

            if (!userDoc.exists()) {
                say("User profile not found.");
                resetButton();
                return;
            }

            const role = normalizeRole(userDoc.data().role);
            if (role) {
                navigate("pages/" + ROLE_HOME[role]);
            } else {
                say("Your account has no valid role. Ask your Team Lead for help.");
                resetButton();
            }
        } catch (error) {
            console.error("Login Error:", error);
            say(ERRORS[error.code] || error.message || "Login failed. Please try again.");
            resetButton();
        }
    });

    [emailInput, passwordInput].forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") loginBtn.click(); }));
}
