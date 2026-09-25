import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCxGcLFvoYKr_CwmodrUgAxjHLfirosefU",
    authDomain: "peer-code-review-tracker.firebaseapp.com",
    projectId: "peer-code-review-tracker",
    storageBucket: "peer-code-review-tracker.firebasestorage.app",
    messagingSenderId: "1019591781653",
    appId: "1:1019591781653:web:f520347d7b4839f1ce0d1c",
    measurementId: "G-0L2NDX2FJK"
};

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);

const db = getFirestore(app);

export { auth, db, firebaseConfig };