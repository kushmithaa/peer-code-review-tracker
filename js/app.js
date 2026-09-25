import {
    signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import {
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

import {
    auth,
    db
} from "./firebase-config.js";


const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");

const loginBtn = document.getElementById("loginBtn");
const message = document.getElementById("message");


loginBtn.addEventListener("click", async () => {

    const email = emailInput.value.trim();
    const password = passwordInput.value;


    if (!email || !password) {

        message.textContent =
            "Please enter your email and password.";

        message.style.color = "#f87171";

        return;
    }


    try {

        loginBtn.disabled = true;

        loginBtn.textContent =
            "Logging in...";

        message.textContent = "";


        /*
         * Authenticate user
         */
        const userCredential =
            await signInWithEmailAndPassword(
                auth,
                email,
                password
            );


        const user = userCredential.user;


        /*
         * Get user information from Firestore
         */
        const userDoc = await getDoc(
            doc(db, "users", user.uid)
        );


        if (!userDoc.exists()) {

            message.textContent =
                "User profile not found.";

            message.style.color = "#f87171";

            loginBtn.disabled = false;

            loginBtn.textContent = "Login";

            return;
        }


        const userData = userDoc.data();


        /*
         * Redirect according to role
         */

        if (userData.role === "Developer") {

            window.location.href =
                "pages/developer-dashboard.html";

        } else if (userData.role === "Reviewer") {

            window.location.href =
                "pages/reviewer-dashboard.html";

        } else if (userData.role === "Team") {

            window.location.href =
                "pages/team-dashboard.html";

        } else {

            message.textContent =
                "Invalid user role.";

            message.style.color = "#f87171";

            loginBtn.disabled = false;

            loginBtn.textContent = "Login";
        }


    } catch (error) {

        console.error(
            "Login Error:",
            error
        );


        message.style.color =
            "#f87171";


        switch (error.code) {

            case "auth/invalid-credential":

                message.textContent =
                    "Incorrect email or password.";

                break;


            case "auth/user-not-found":

                message.textContent =
                    "No account found with this email.";

                break;


            case "auth/wrong-password":

                message.textContent =
                    "Incorrect password.";

                break;


            case "auth/invalid-email":

                message.textContent =
                    "Please enter a valid email.";

                break;


            default:

                message.textContent =
                    error.message;
        }


        loginBtn.disabled = false;

        loginBtn.textContent =
            "Login";
    }

});