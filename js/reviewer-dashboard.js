/* Reviewer dashboard: priority queue, assignments, turnaround, activity. */

import {
    requireRole, ROLES, isPending, queryDocs, escapeHTML, formatDate, displayNameOf, normalizeStatus
} from "./common.js";

import {
    badge, emptyState, errorState, loadingState, sortNewest, sortQueue, prQueueItem, isOverdue,
    turnaroundMs, averageTurnaround, timeAgo, prCompactRow
} from "./ui.js";

import { reviewActivity, SKILL_CATEGORIES } from "./skills.js";
import { donut, hbars, STATUS_COLORS } from "./charts.js";

const $ = (id) => document.getElementById(id);
const setText = (id, value) => { const el = $(id); if (el) el.textContent = value; };

function renderAttention(prs) {
    const queue = sortQueue(prs.filter(isPending));
    const overdue = queue.filter((p) => isOverdue(p)).length;
    const high = queue.filter((p) => p.priority === "High").length;

    setText("pendingBig", queue.length);
    setText("pendingReviewCount", queue.length);
    setText("overdueCount", overdue);

    $("attentionText").textContent = queue.length
        ? `Next up: ${queue[0].title || "Untitled Pull Request"}`
        : "You're all caught up. Nothing is waiting for your review.";

    $("attentionChips").innerHTML = queue.length
        ? `${overdue ? `<span class="badge overdue">${overdue} overdue</span>` : ""}
           ${high ? `<span class="badge high">${high} high priority</span>` : ""}
           <span class="chip"><b>${queue.length}</b> pending</span>`
        : "";

    const start = $("startNext");
    start.href = queue.length ? `review-pr.html?id=${encodeURIComponent(queue[0].id)}` : "assigned-prs.html";
    start.textContent = queue.length ? "Start next review →" : "View assigned PRs →";

    $("pendingReviewList").innerHTML = queue.length
        ? queue.slice(0, 4).map((p) => prQueueItem(p)).join("") +
          (queue.length > 4 ? `<p class="muted small">+ ${queue.length - 4} more on the <a href="pending-reviews.html">Pending Reviews</a> page.</p>` : "")
        : emptyState("You're all caught up", "No pull requests are waiting for your review.", "✓");
}

function renderAssigned(prs) {
    $("assignedPRList").innerHTML = prs.length
        ? [...prs].sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0)).slice(0, 6).map((p) => prCompactRow(p)).join("")
        : emptyState("No pull requests assigned yet", "Pull requests assigned to you by a Team Lead will appear here.", "⌘");
}

function renderHistory(reviews) {
    const list = $("historyPreview");
    if (!reviews.length) {
        list.innerHTML = emptyState("No reviews submitted yet", "Reviews you submit will appear here.", "◷");
        return;
    }
    list.innerHTML = sortNewest(reviews).slice(0, 3).map((r) => `
        <article class="item">
            <div class="body">
                <h3>${escapeHTML(r.pullRequestTitle || "Untitled Pull Request")}</h3>
                <p class="meta">${escapeHTML(formatDate(r.createdAt))}${r.category ? " · " + escapeHTML(r.category) : ""}</p>
                <p class="quote">${escapeHTML((r.feedback || "No feedback provided.").slice(0, 220))}${(r.feedback || "").length > 220 ? "…" : ""}</p>
            </div>
            <div class="side">${badge(r.status)}</div>
        </article>`).join("");
}

function renderActivity(reviews, prs) {
    const a = reviewActivity(reviews);
    setText("completedReviewCount", a.total);

    $("approvalChart").innerHTML = a.total
        ? donut([
            { label: "Approved", value: a.approved, color: STATUS_COLORS.Approved },
            { label: "Changes requested", value: a.changesRequested, color: STATUS_COLORS["Changes Requested"] }
        ], { size: 150, thickness: 18, top: `${Math.round((a.approved / a.total) * 100)}%`, bottom: "approved", label: "Review decisions" })
        : emptyState("No decisions yet", "Your approval split appears after your first review.", "◔");

    $("growthSummary").innerHTML = a.total
        ? hbars(SKILL_CATEGORIES.map((c) => ({ label: c, value: a.byCategory[c] })), { max: Math.max(...Object.values(a.byCategory), 1) }) +
          `<p class="muted small">Counts of reviews that rated each area. This is activity, not a skill score.</p>`
        : emptyState("No review activity yet", "Submit a review to start your activity summary.", "▤");

    const byId = new Map(prs.map((p) => [p.id, p]));
    const t = averageTurnaround(reviews.map((r) => turnaroundMs(r, byId.get(r.pullRequestId))));
    setText("avgTurnaround", t.text);

    $("recentActivity").innerHTML = reviews.length
        ? `<ul class="timeline">${sortNewest(reviews).slice(0, 4).map((r) => `
            <li class="${normalizeStatus(r.status) === "Approved" ? "ok" : "warn"}">
                <div>${escapeHTML(normalizeStatus(r.status))}: ${escapeHTML(r.pullRequestTitle || "pull request")}</div>
                <div class="t">${escapeHTML(timeAgo(r.createdAt) || formatDate(r.createdAt))}</div></li>`).join("")}</ul>`
        : `<p class="muted small">No activity yet.</p>`;
}

async function load(session) {
    const uid = session.user.uid;
    ["pendingReviewList", "assignedPRList", "historyPreview"].forEach((id) => { $(id).innerHTML = loadingState(); });

    const [prResult, reviewResult] = await Promise.allSettled([
        queryDocs("pullRequests", "reviewerId", uid),
        queryDocs("reviews", "reviewerId", uid)
    ]);

    let prs = [];
    if (prResult.status === "fulfilled") {
        prs = prResult.value;
        setText("assignedPRCount", prs.length);
        renderAttention(prs);
        renderAssigned(prs);
    } else {
        console.error("Unable to load assigned pull requests:", prResult.reason);
        const msg = errorState("Unable to load pull requests", "Check your connection and the Firestore Security Rules, then refresh.");
        ["pendingReviewList", "assignedPRList"].forEach((id) => { $(id).innerHTML = msg; });
        ["assignedPRCount", "pendingReviewCount", "overdueCount", "pendingBig"].forEach((id) => setText(id, "—"));
        $("attentionText").textContent = "Your queue could not be loaded.";
    }

    if (reviewResult.status === "fulfilled") {
        renderHistory(reviewResult.value);
        renderActivity(reviewResult.value, prs);
    } else {
        console.error("Unable to load reviews:", reviewResult.reason);
        const msg = errorState("Unable to load review history", "Check your connection and the Firestore Security Rules, then refresh.");
        ["historyPreview", "growthSummary", "approvalChart", "recentActivity"].forEach((id) => { $(id).innerHTML = msg; });
        setText("completedReviewCount", "—");
        setText("avgTurnaround", "—");
    }
}

const session = await requireRole([ROLES.REVIEWER]);

const first = displayNameOf(session.profile, session.user).split(/[\s@]/)[0];
const hour = new Date().getHours();
setText("greeting", `Good ${hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}, ${first}`);

await load(session);
window.addEventListener("pageshow", (event) => { if (event.persisted) load(session); });
