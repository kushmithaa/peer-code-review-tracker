/* Pending Reviews: assigned PRs that are Open or In Review, most urgent first. */

import { requireRole, ROLES, isPending, queryDocs, toMillis } from "./common.js";
import { emptyState, errorState, loadingState, formatDuration, sortQueue, prQueueItem, isOverdue } from "./ui.js";

const $ = (id) => document.getElementById(id);
let pending = [];
let session = null;

function render() {
    const search = $("searchPending").value.trim().toLowerCase();
    const list = $("pendingList");

    const shown = pending.filter((pr) =>
        [pr.title, pr.repository, pr.authorName, pr.number].map((v) => String(v ?? "").toLowerCase()).join(" ").includes(search)
    );
    $("resultCount").textContent = `Showing ${shown.length} of ${pending.length} pending reviews`;

    if (!pending.length) {
        list.innerHTML = emptyState("You're all caught up", "No pull requests are waiting for your review.", "✓");
    } else if (!shown.length) {
        list.innerHTML = emptyState("No matches", "Try a different search.", "⌕");
    } else {
        list.innerHTML = shown.map((pr) => prQueueItem(pr)).join("");
    }
}

async function load() {
    $("resultCount").textContent = "Loading pending reviews...";
    $("pendingList").innerHTML = loadingState();
    try {
        const assigned = await queryDocs("pullRequests", "reviewerId", session.user.uid);
        pending = sortQueue(assigned.filter(isPending));
    } catch (error) {
        console.error("Unable to load pending reviews:", error);
        $("resultCount").textContent = "Unable to load pending reviews.";
        $("pendingList").innerHTML = errorState("Unable to load pending reviews", "Check your connection and the Firestore Security Rules, then refresh.");
        $("pendingTotal").textContent = "—";
        return;
    }

    $("pendingTotal").textContent = pending.length;
    $("overduePending").textContent = pending.filter((p) => isOverdue(p)).length;

    const times = pending.map((p) => toMillis(p.assignedAt) || toMillis(p.createdAt)).filter(Boolean);
    $("oldestPending").textContent = times.length ? formatDuration(Date.now() - Math.min(...times)) : "n/a";
    render();
}

session = await requireRole([ROLES.REVIEWER]);
$("searchPending").addEventListener("input", render);
$("refreshPending").addEventListener("click", load);
await load();
window.addEventListener("pageshow", (e) => { if (e.persisted) load(); });
