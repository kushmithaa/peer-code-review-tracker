import {
    createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import {
    doc,
    setDoc
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

import {
    auth,
    db
} from "./firebase-config.js";


const nameInput = document.getElementById("name");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const roleInput = document.getElementById("role");

const registerBtn = document.getElementById("registerBtn");
const message = document.getElementById("message");


registerBtn.addEventListener("click", async () => {

    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const role = roleInput.value;

    if (!name || !email || !password || !role) {
        message.textContent = "Please fill in all fields.";
        message.style.color = "#f87171";
        return;
    }

    if (password.length < 6) {
        message.textContent =
            "Password must contain at least 6 characters.";

        message.style.color = "#f87171";
        return;
    }

    try {

        registerBtn.disabled = true;
        registerBtn.textContent = "Creating Account...";

        message.textContent = "";

        /*
         * Create Firebase Authentication account
         */
        const userCredential =
            await createUserWithEmailAndPassword(
                auth,
                email,
                password
            );

        const user = userCredential.user;

        /*
         * Store user details in Firestore
         */
        await setDoc(
            doc(db, "users", user.uid),
            {
                uid: user.uid,
                name: name,
                email: email,
                role: role,
                createdAt: new Date().toISOString()
            }
        );

        message.textContent =
            "Account created successfully!";

        message.style.color = "#22c55e";

        registerBtn.textContent =
            "Account Created ✓";

        /*
         * Redirect according to selected role
         */
        setTimeout(() => {

            if (role === "Developer") {

                window.location.href =
                    "developer-dashboard.html";

            } else if (role === "Reviewer") {

                window.location.href =
                    "reviewer-dashboard.html";

            } else if (role === "Team") {

                window.location.href =
                    "team-dashboard.html";
            }

        }, 1200);

    } catch (error) {

        console.error(
            "Registration Error:",
            error
        );

        message.style.color = "#f87171";

        switch (error.code) {

            case "auth/email-already-in-use":

                message.textContent =
                    "This email is already registered.";

                break;

            case "auth/invalid-email":

                message.textContent =
                    "Please enter a valid email address.";

                break;

            case "auth/weak-password":

                message.textContent =
                    "Password must contain at least 6 characters.";

                break;

            case "auth/operation-not-allowed":

                message.textContent =
                    "Email/Password authentication is not enabled in Firebase.";

                break;

            case "permission-denied":

                message.textContent =
                    "Firestore permission denied.";

                break;

            default:

                message.textContent =
                    error.message;
        }

        registerBtn.disabled = false;

        registerBtn.textContent =
            "Create Account";
    }

});