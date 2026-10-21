/* Registration for Developers and Reviewers. Team Leads are provisioned by an administrator. */

import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { ROLE_HOME, navigate, mountDemoBanner } from "./common.js";

mountDemoBanner();

const $ = (id) => document.getElementById(id);
const nameInput = $("name");
const emailInput = $("email");
const passwordInput = $("password");
const roleInput = $("role");
const registerBtn = $("registerBtn");
const message = $("message");

function say(text, type = "error") {
    message.textContent = text;
    message.className = `form-msg ${type}`;
}

const ERRORS = {
    "auth/email-already-in-use": "This email is already registered.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/weak-password": "Password must contain at least 6 characters.",
    "auth/operation-not-allowed": "Email/Password authentication is not enabled in Firebase.",
    "auth/network-request-failed": "Network error. Check your internet connection and try again.",
    "permission-denied": "Firestore denied saving your profile. Check the Security Rules."
};

registerBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const role = roleInput.value;

    if (!["Developer", "Reviewer"].includes(role)) {
        say("Please choose Developer or Reviewer. Team Lead accounts are created by an administrator.");
        return;
    }
    if (!name || !email || !password) { say("Please fill in all fields."); return; }
    if (password.length < 6) { say("Password must contain at least 6 characters."); return; }

    registerBtn.disabled = true;
    registerBtn.textContent = "Creating Account...";
    say("", "info");

    let created = false;
    try {
        const { user } = await createUserWithEmailAndPassword(auth, email, password);
        created = true;

        await setDoc(doc(db, "users", user.uid), {
            uid: user.uid, name, email: user.email || email, role, createdAt: new Date().toISOString()
        });

        say("Account created successfully!", "success");
        registerBtn.textContent = "Account Created ✓";
        setTimeout(() => navigate(ROLE_HOME[role]), 1200);
    } catch (error) {
        console.error("Registration Error:", error);
        say(created
            ? "Your sign-in was created but your profile could not be saved. Please try logging in again or contact your Team Lead."
            : (ERRORS[error.code] || error.message || "Registration failed. Please try again."));
        registerBtn.disabled = false;
        registerBtn.textContent = "Create Account";
    }
});
