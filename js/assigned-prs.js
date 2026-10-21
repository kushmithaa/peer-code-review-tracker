/* All pull requests assigned to the logged-in reviewer. */

import { requireRole, ROLES, isPending, queryDocs, normalizeStatus } from "./common.js";
import { emptyState, errorState, loadingState, sortQueue, prQueueItem } from "./ui.js";

const $ = (id) => document.getElementById(id);
let allPrs = [];

function matches(pr, search, filter) {
    const status = normalizeStatus(pr.status);
    const okFilter = filter === "all" || (filter === "pending" ? isPending(pr) : status === filter);
    const hay = [pr.title, pr.repository, pr.authorName, pr.number].map((v) => String(v ?? "").toLowerCase()).join(" ");
    return okFilter && hay.includes(search);
}

function render() {
    const search = $("searchPrs").value.trim().toLowerCase();
    const filter = $("statusFilter").value;
    const list = $("assignedPRList");

    const pendingFirst = sortQueue(allPrs.filter(isPending));
    const rest = allPrs.filter((p) => !isPending(p));
    const shown = [...pendingFirst, ...rest].filter((pr) => matches(pr, search, filter));

    $("resultCount").textContent = `Showing ${shown.length} of ${allPrs.length} pull requests`;

    if (!allPrs.length) {
        list.innerHTML = emptyState("No pull requests assigned yet", "Pull requests assigned to you by a Team Lead will appear here.", "⌘");
    } else if (!shown.length) {
        list.innerHTML = emptyState("No matches", "Try changing your search or filter.", "⌕");
    } else {
        list.innerHTML = shown.map((pr) => prQueueItem(pr)).join("");
    }
}

async function load(session) {
    $("resultCount").textContent = "Loading pull requests...";
    $("assignedPRList").innerHTML = loadingState();
    try {
        allPrs = await queryDocs("pullRequests", "reviewerId", session.user.uid);
    } catch (error) {
        console.error("Unable to load assigned pull requests:", error);
        $("resultCount").textContent = "Unable to load pull requests.";
        $("assignedPRList").innerHTML = errorState("Unable to load pull requests", "Check your connection and the Firestore Security Rules, then refresh.");
        return;
    }
    $("totalAssigned").textContent = allPrs.length;
    $("totalPending").textContent = allPrs.filter(isPending).length;
    $("totalCompleted").textContent = allPrs.filter((p) => !isPending(p)).length;
    render();
}

const session = await requireRole([ROLES.REVIEWER]);
$("searchPrs").addEventListener("input", render);
$("statusFilter").addEventListener("change", render);
await load(session);
window.addEventListener("pageshow", (e) => { if (e.persisted) load(session); });
