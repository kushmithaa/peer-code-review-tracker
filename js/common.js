/* =====================================================
   Shared helpers: roles, route guard, formatting, logout.
   Every protected page imports this file.
===================================================== */

import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import {
    doc,
    getDoc,
    getDocs,
    collection,
    query,
    where
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

import * as firestoreApi from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

import { auth, db } from "./firebase-config.js";


/* ---------- Roles ---------- */

export const ROLES = {
    DEVELOPER: "Developer",
    REVIEWER: "Reviewer",
    TEAM_LEAD: "Team Lead"
};

/* Dashboard file for each role (relative to /pages/). */
export const ROLE_HOME = {
    "Developer": "developer-dashboard.html",
    "Reviewer": "reviewer-dashboard.html",
    "Team Lead": "team-dashboard.html"
};

/*
 * The users collection historically stores "Team" for team leads.
 * Both "Team" and "Team Lead" are accepted and mean the same role.
 */
export function normalizeRole(raw) {
    const value = String(raw ?? "").trim().toLowerCase();

    if (value === "developer") return ROLES.DEVELOPER;
    if (value === "reviewer") return ROLES.REVIEWER;
    if (value === "team" || value === "team lead" || value === "teamlead") {
        return ROLES.TEAM_LEAD;
    }
    return null;
}


/* ---------- Pull request status ---------- */

export const STATUS = {
    OPEN: "Open",
    IN_REVIEW: "In Review",
    CHANGES: "Changes Requested",
    APPROVED: "Approved",
    MERGED: "Merged"
};

export function normalizeStatus(value) {
    const raw = String(value ?? "").trim();
    const key = raw.toLowerCase().replace(/[-_]+/g, " ");

    if (key === "" || key === "open" || key === "pending") return STATUS.OPEN;
    if (key === "in review") return STATUS.IN_REVIEW;
    if (key === "changes requested") return STATUS.CHANGES;
    if (key === "approved") return STATUS.APPROVED;
    if (key === "merged") return STATUS.MERGED;
    return raw;
}

/* A review is pending when a reviewer is assigned and the PR is Open / In Review. */
export function isPending(pr) {
    if (!pr || !pr.reviewerId) return false;
    const status = normalizeStatus(pr.status);
    return status === STATUS.OPEN || status === STATUS.IN_REVIEW;
}

export function badgeClass(status) {
    switch (normalizeStatus(status)) {
        case STATUS.APPROVED: return "approved";
        case STATUS.MERGED: return "merged";
        case STATUS.CHANGES: return "changes";
        case STATUS.IN_REVIEW: return "review";
        default: return "open";
    }
}


/* ---------- Firestore query helpers ---------- */

function toList(snapshot) {
    return snapshot.docs.map((d) => ({ ...d.data(), id: d.id }));
}

/* All documents where field == value. */
export async function queryDocs(collectionName, field, value) {
    return toList(await getDocs(
        query(collection(db, collectionName), where(field, "==", value))
    ));
}

/* Every document in a collection (Team Lead pages; rules restrict who may call this). */
export async function listDocs(collectionName) {
    return toList(await getDocs(collection(db, collectionName)));
}


/* ---------- Formatting ---------- */

export function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

/* Accepts Firestore Timestamp, Date, ISO string or number. */
export function toMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === "function") return value.toMillis();
    const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isNaN(ms) ? 0 : ms;
}

export function formatDate(value) {
    const ms = toMillis(value);
    if (!ms) return "Date unavailable";
    return new Date(ms).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric"
    });
}

export function initials(name) {
    const parts = String(name || "?").trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0] || "").join("").toUpperCase() || "?";
}

export function displayNameOf(profile, user) {
    return (
        (profile && profile.name) ||
        (user && (user.displayName || user.email)) ||
        "User"
    );
}


/* ---------- Navigation (single place, so tests can intercept) ---------- */

export function navigate(url) {
    if (typeof globalThis.__testNavigate === "function") {
        globalThis.__testNavigate(url);
        return;
    }
    window.location.href = url;
}


/* ---------- UI helpers ---------- */

export function showToast(message, type = "info") {
    let host = document.getElementById("toastHost");
    if (!host) {
        host = document.createElement("div");
        host.id = "toastHost";
        host.className = "toast-host";
        document.body.appendChild(host);
    }
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.setAttribute("role", type === "error" ? "alert" : "status");
    toast.textContent = message;
    host.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}

export function showFatal(message) {
    const banner = document.createElement("div");
    banner.className = "fatal";
    banner.setAttribute("role", "alert");
    banner.textContent = message;
    document.body.prepend(banner);
}

/* ---------- Demo mode (local sample data, never touches Firebase) ---------- */

export const isDemo = () => !!globalThis.__PCRT_DEMO__;

function loginUrl(query = "") {
    const inPages = /\/pages\//.test(window.location.pathname);
    return (inPages ? "../index.html" : "index.html") + query;
}

export function mountDemoBanner() {
    if (!isDemo() || document.getElementById("demoBanner")) return;

    const bar = document.createElement("div");
    bar.id = "demoBanner";
    bar.className = "demo-banner";
    bar.setAttribute("role", "status");
    bar.innerHTML = `
        <span>DEMO MODE: sample data stored only in this browser. Nothing is sent to Firebase.</span>
        <button type="button" data-demo="switch">Switch user</button>
        <button type="button" data-demo="reset">Reset demo data</button>
        <button type="button" data-demo="exit">Exit demo mode</button>`;
    document.body.prepend(bar);

    bar.addEventListener("click", async (event) => {
        const action = event.target && event.target.dataset && event.target.dataset.demo;
        if (!action) return;

        if (action === "switch") {
            await signOut(auth);
            navigate(loginUrl());
        }
        if (action === "reset") {
            if (typeof firestoreApi.demoReset === "function") firestoreApi.demoReset();
            await signOut(auth);
            navigate(loginUrl());
        }
        if (action === "exit") {
            await signOut(auth);
            navigate(loginUrl("?demo=0"));
        }
    });
}

/* Small "DEMO" marker for seeded records (field demo === true). */
export function demoChip(record) {
    if (isDemo()) return "";   /* local demo mode: every record is demo, the banner says so */
    return record && record.demo === true
        ? `<span class="chip demo" title="Sample record">DEMO</span>`
        : "";
}

/* Fill sidebar profile blocks: [data-user-name], [data-user-initials], #reviewerName */
export function fillProfile(name) {
    document.querySelectorAll("[data-user-name]").forEach((el) => {
        el.textContent = name;
    });
    document.querySelectorAll("[data-user-initials]").forEach((el) => {
        el.textContent = initials(name);
    });
    const legacy = document.getElementById("reviewerName");
    if (legacy) legacy.textContent = name;
}

export function wireLogout() {
    const link = document.getElementById("logoutLink");
    if (!link || link.dataset.wired) return;
    link.dataset.wired = "1";
    link.addEventListener("click", async (event) => {
        event.preventDefault();
        try {
            await signOut(auth);
        } catch (error) {
            console.error("Logout failed:", error);
        }
        navigate("../index.html");
    });
}


/* ---------- Route guard ---------- */

/*
 * requireRole(["Reviewer"])
 *  - not logged in            -> index.html
 *  - no users/{uid} role      -> signed out, index.html?error=norole
 *  - wrong role               -> redirected to that role's own dashboard
 *  - allowed                  -> resolves { user, profile, role }
 */
export function requireRole(allowedRoles) {
    return new Promise((resolve) => {
        let resolved = false;
        let leaving = false;

        onAuthStateChanged(auth, async (user) => {
            if (!user) {
                /* Ignore the sign-out we trigger ourselves below. */
                if (!leaving) navigate("../index.html");
                return;
            }
            if (resolved) return;

            try {
                const snap = await getDoc(doc(db, "users", user.uid));
                const role = snap.exists() ? normalizeRole(snap.data().role) : null;

                if (!role) {
                    leaving = true;
                    await signOut(auth);
                    navigate("../index.html?error=norole");
                    return;
                }
                if (!allowedRoles.includes(role)) {
                    navigate(ROLE_HOME[role]);
                    return;
                }

                resolved = true;
                mountDemoBanner();
                const profile = { ...snap.data(), id: user.uid };
                fillProfile(displayNameOf(profile, user));
                wireLogout();
                resolve({ user, profile, role });

            } catch (error) {
                console.error("Unable to verify account:", error);
                showFatal(
                    "Unable to verify your account. Check your connection " +
                    "and the Firestore Security Rules for the users collection."
                );
            }
        });
    });
}
