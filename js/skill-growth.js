/* Reviewer "My Skill Growth": review ACTIVITY only (not a skill score). */

import { requireRole, ROLES, queryDocs } from "./common.js";
import { emptyState, errorState, turnaroundMs, averageTurnaround } from "./ui.js";
import { reviewActivity, ratingsOf, SKILL_CATEGORIES } from "./skills.js";
import { hbars } from "./charts.js";

const $ = (id) => document.getElementById(id);
const session = await requireRole([ROLES.REVIEWER]);

try {
    const [reviews, prs] = await Promise.all([
        queryDocs("reviews", "reviewerId", session.user.uid),
        queryDocs("pullRequests", "reviewerId", session.user.uid)
    ]);
    const a = reviewActivity(reviews);

    $("totalReviews").textContent = a.total;
    $("approvedCount").textContent = a.approved;
    $("changesCount").textContent = a.changesRequested;
    $("ratedCount").textContent = reviews.filter((r) => ratingsOf(r).length > 0).length;

    $("categoryActivity").innerHTML = a.total
        ? hbars(SKILL_CATEGORIES.map((c) => ({ label: c, value: a.byCategory[c] })), { max: Math.max(...Object.values(a.byCategory), 1) }) +
          (a.uncategorised ? `<p class="muted small">${a.uncategorised} review(s) have no recognised category.</p>` : "")
        : emptyState("No review activity yet", "Submit a review to see your activity by category.", "▤");

    const byId = new Map(prs.map((p) => [p.id, p]));
    const t = averageTurnaround(reviews.map((r) => turnaroundMs(r, byId.get(r.pullRequestId))));
    $("turnaroundBox").innerHTML = t.count
        ? `<p style="font-size:2.2rem;font-weight:800">${t.text}</p><p class="muted small">Average time from assignment to your review, based on ${t.count} of ${t.total} review(s) with timestamps.</p>`
        : emptyState("No turnaround yet", "Needs a review on a pull request with an assignment date.", "⏱");
} catch (error) {
    console.error("Unable to load review activity:", error);
    $("categoryActivity").innerHTML = errorState("Unable to load review activity", "Check your connection and the Firestore Security Rules, then refresh.");
}
