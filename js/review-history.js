/* Reviewer's saved reviews, loaded from Firestore on every visit. */

import { requireRole, ROLES, queryDocs, normalizeStatus } from "./common.js";
import { reviewCard, emptyState, errorState, loadingState, sortNewest } from "./ui.js";
import { ratingsOf } from "./skills.js";

const $ = (id) => document.getElementById(id);
let reviews = [];

function render() {
    const search = $("searchReviews").value.trim().toLowerCase();
    const status = $("statusFilter").value;
    const category = $("categoryFilter").value;

    const shown = sortNewest(reviews).filter((r) => {
        const cats = ratingsOf(r).map(([c]) => c.toLowerCase());
        if (r.category) cats.push(String(r.category).toLowerCase());
        const hay = [r.pullRequestTitle, r.feedback, r.category, ...cats, r.authorName].map((v) => String(v ?? "").toLowerCase()).join(" ");
        return (
            hay.includes(search) &&
            (status === "all" || String(r.status || "").toLowerCase() === status) &&
            (category === "all" || cats.includes(category))
        );
    });

    $("resultCount").textContent = `Showing ${shown.length} of ${reviews.length} reviews`;

    if (!reviews.length) {
        $("historyList").innerHTML = emptyState("No review history yet", "Reviews you submit will appear here.", "◷");
    } else if (!shown.length) {
        $("historyList").innerHTML = emptyState("No reviews found", "Try changing your search or filters.", "⌕");
    } else {
        $("historyList").innerHTML = shown.map((r) => reviewCard(r, { showDeveloper: true })).join("");
    }
}

async function load(session) {
    $("historyList").innerHTML = loadingState("Loading review history...");
    try {
        reviews = await queryDocs("reviews", "reviewerId", session.user.uid);
    } catch (error) {
        console.error("Unable to load review history:", error);
        $("resultCount").textContent = "Unable to load review history.";
        $("historyList").innerHTML = errorState("Unable to load review history", "Check your connection and the Firestore Security Rules, then refresh.");
        return;
    }
    const s = (r) => normalizeStatus(r.status);
    $("totalReviews").textContent = reviews.length;
    $("approvedReviews").textContent = reviews.filter((r) => s(r) === "Approved").length;
    $("changesReviews").textContent = reviews.filter((r) => s(r) === "Changes Requested").length;
    render();
}

const session = await requireRole([ROLES.REVIEWER]);
["searchReviews"].forEach((id) => $(id).addEventListener("input", render));
["statusFilter", "categoryFilter"].forEach((id) => $(id).addEventListener("change", render));
await load(session);
window.addEventListener("pageshow", (e) => { if (e.persisted) load(session); });
