/* Developer workspace: Overview / My Pull Requests / Feedback / Skill Growth / History. */

import {
    requireRole, ROLES, STATUS, queryDocs, normalizeStatus, escapeHTML, formatDate, toMillis,
    displayNameOf, showToast, demoChip
} from "./common.js";

import {
    badge, prLabel, githubLink, emptyState, errorState, loadingState, reviewCard, sortNewest,
    skillBlock, priorityBadge, dueText, timeAgo
} from "./ui.js";

import { computeSkills, ratingsOf } from "./skills.js";
import { fetchPullDetails } from "./github.js";
import { requestReReview, bindPrForm, prFormHTML, openDialog, closeDialog } from "./pr-actions.js";
import { heatmap, dayKey, ring, radar } from "./charts.js";

const $ = (id) => document.getElementById(id);
const VIEWS = ["overview", "prs", "feedback", "skills", "history"];
const TITLES = { overview: "Overview", prs: "My Pull Requests", feedback: "My Review Feedback", skills: "My Skill Growth", history: "My Review History" };

let session = null;
let prs = [];
let reviews = [];
let prError = false;
let reviewError = false;

/* ---------- View switching (hash based, survives refresh) ---------- */

function currentView() {
    const wanted = window.location.hash.replace("#", "");
    return VIEWS.includes(wanted) ? wanted : "overview";
}

function showView() {
    const view = currentView();
    VIEWS.forEach((name) => $(`view-${name}`).classList.toggle("active", name === view));
    document.querySelectorAll(".side-nav [data-view]").forEach((a) => {
        a.classList.toggle("active", a.dataset.view === view);
        if (a.dataset.view === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    document.title = `${TITLES[view]} | PeerReview`;
}

/* ---------- Derived data ---------- */

function reviewsByPr() {
    const map = new Map();
    sortNewest(reviews).forEach((r) => {
        if (!map.has(r.pullRequestId)) map.set(r.pullRequestId, []);
        map.get(r.pullRequestId).push(r);
    });
    return map;
}

/* ---------- Overview ---------- */

function renderStats() {
    const status = (pr) => normalizeStatus(pr.status);
    const v = (fn) => (prError ? "—" : fn());
    $("statTotal").textContent = v(() => prs.length);
    $("statPending").textContent = v(() => prs.filter((p) => [STATUS.OPEN, STATUS.IN_REVIEW].includes(status(p))).length);
    $("statApproved").textContent = v(() => prs.filter((p) => [STATUS.APPROVED, STATUS.MERGED].includes(status(p))).length);
    $("statChanges").textContent = v(() => prs.filter((p) => status(p) === STATUS.CHANGES).length);
}

function renderHero() {
    const first = displayNameOf(session.profile, session.user).split(/[\s@]/)[0];
    const hour = new Date().getHours();
    $("greeting").textContent = `Good ${hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}, ${first}`;

    const changes = prs.filter((p) => normalizeStatus(p.status) === STATUS.CHANGES).length;
    $("heroText").textContent = prError
        ? "Your pull requests could not be loaded."
        : changes
            ? `${changes} pull request${changes === 1 ? " needs" : "s need"} your attention. Address the feedback and request a re-review.`
            : prs.length
                ? "Everything is moving. Keep an eye on your skill growth below."
                : "Submit your first pull request to start receiving feedback.";
}

function renderProfile() {
    const p = session.profile;
    const name = displayNameOf(p, session.user);
    const received = reviews.length;
    $("profileCard").innerHTML = `
        <div class="who">
            <span class="avatar lg">${escapeHTML(name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase())}</span>
            <div><h3>${escapeHTML(name)}</h3><p class="muted small">${escapeHTML(p.email || session.user.email || "")}</p>
                <div class="chips" style="margin-top:6px"><span class="chip accent">Developer</span>${demoChip(p)}</div></div>
        </div>
        <div class="pc-stats">
            <div><b>${prError ? "—" : prs.length}</b><span>PRs</span></div>
            <div><b>${reviewError ? "—" : received}</b><span>Reviews</span></div>
            <div><b>${reviewError ? "—" : computeSkills(reviews).assessedCount}</b><span>Rated</span></div>
        </div>
        <p class="muted small">Member since ${escapeHTML(p.createdAt ? formatDate(p.createdAt) : "—")}</p>`;
}

function renderOverviewSkills() {
    const box = $("overviewSkills");
    if (reviewError) { box.innerHTML = errorState("Unable to calculate skills", "Your reviews could not be loaded."); return; }
    const s = computeSkills(reviews);
    if (!s.overall) { box.innerHTML = skillBlock(s); return; }
    box.innerHTML = `
        <div class="skill-split">
            <div class="stack" style="justify-items:center">${radar(s.categories.map((c) => ({ label: c.category.replace("Documentation", "Docs").replace("Performance", "Perf."), value: c.score })), { size: 280, label: "Category scores" })}</div>
            <div>
                <div class="row" style="gap:18px;margin-bottom:8px">${ring(s.overall.score, { size: 104, caption: "overall" })}
                    <p class="muted small">Based on ${s.overall.n} rated review(s) across ${s.overall.categoriesAssessed} categor${s.overall.categoriesAssessed === 1 ? "y" : "ies"}.</p></div>
                ${s.categories.map((c) => `<div class="bar-row"><span>${escapeHTML(c.category)}</span><div class="meter"><i style="width:${c.score ?? 0}%"></i></div><span class="v">${c.score === null ? "—" : c.score + "%"}</span></div>`).join("")}
            </div>
        </div>`;
}

function renderRecentFeedback() {
    const box = $("recentFeedback");
    if (reviewError) { box.innerHTML = errorState("Unable to load feedback", "Check your connection and the Firestore Security Rules."); return; }
    const latest = sortNewest(reviews).slice(0, 2);
    box.innerHTML = latest.length
        ? latest.map((r) => reviewCard(r, { showReviewer: true })).join("")
        : emptyState("No feedback yet", "Feedback appears here after a reviewer reviews one of your pull requests.", "💬");
}

function renderTimeline() {
    const box = $("timeline");
    if (prError && reviewError) { box.innerHTML = errorState("Unable to load activity", "Please refresh."); return; }
    const events = [
        ...prs.map((p) => ({ t: toMillis(p.createdAt), tone: "info", text: `You submitted ${p.title || "a pull request"}` })),
        ...reviews.map((r) => ({ t: toMillis(r.createdAt), tone: normalizeStatus(r.status) === "Approved" ? "ok" : "warn",
            text: `${r.reviewerName || "A reviewer"} ${normalizeStatus(r.status) === "Approved" ? "approved" : "requested changes on"} ${r.pullRequestTitle || "a pull request"}` }))
    ].filter((e) => e.t).sort((a, b) => b.t - a.t).slice(0, 6);

    box.innerHTML = events.length
        ? `<ul class="timeline">${events.map((e) => `<li class="${e.tone}"><div>${escapeHTML(e.text)}</div><div class="t">${escapeHTML(timeAgo(e.t))}</div></li>`).join("")}</ul>`
        : emptyState("No activity yet", "Your recent activity will show up here.", "◷");
}

function renderHeat() {
    const counts = {};
    [...prs, ...reviews].forEach((x) => { const ms = toMillis(x.createdAt); if (ms) counts[dayKey(ms)] = (counts[dayKey(ms)] || 0) + 1; });
    $("heatmap").innerHTML = heatmap(counts, { weeks: 14, label: "Contribution activity" });
}

function renderNotice() {
    const box = $("pageNotice");
    box.innerHTML = "";
    if (prError || reviewError) return;
    const byPr = reviewsByPr();
    const unlinked = prs.filter((p) => [STATUS.APPROVED, STATUS.CHANGES].includes(normalizeStatus(p.status)) && !byPr.has(p.id));
    if (unlinked.length) {
        box.innerHTML = `<div class="notice warn" style="margin-bottom:18px"><strong>${unlinked.length} reviewed pull request(s) show no feedback here.</strong>
            Reviews saved before developer linking was added may need your Team Lead to run "Link legacy reviews" in Reviewer / PR Management.</div>`;
    }
}

/* ---------- My Pull Requests ---------- */

function prCard(pr, byPr) {
    const status = normalizeStatus(pr.status);
    const latest = (byPr.get(pr.id) || [])[0];
    let feedbackText = "Awaiting feedback";
    if (!pr.reviewerId) feedbackText = "No reviewer assigned yet";
    else if (latest) feedbackText = `Feedback: ${latest.status} · ${formatDate(latest.createdAt)}`;

    const reReview = status === STATUS.CHANGES
        ? `<button class="btn primary sm" data-action="rereview" data-id="${escapeHTML(pr.id)}">Request re-review</button>` : "";

    return `
        <article class="item" data-pr="${escapeHTML(pr.id)}">
            <div class="body">
                <h3>${escapeHTML(pr.title || "Untitled Pull Request")}</h3>
                <p class="meta">${escapeHTML(prLabel(pr))} · ${escapeHTML(pr.repository || "Repository not set")}
                    · Reviewer: ${escapeHTML(pr.reviewerName || (pr.reviewerId ? "Assigned" : "Not assigned yet"))}</p>
                <div class="chips" style="margin-top:8px"><span class="chip">${escapeHTML(feedbackText)}</span>${priorityBadge(pr.priority)}
                    ${dueText(pr) ? `<span class="chip">${escapeHTML(dueText(pr))}</span>` : ""}${demoChip(pr)}</div>
                <details style="margin-top:10px">
                    <summary class="muted small">PR details</summary>
                    <div class="notice" style="margin-top:8px" data-detail="${escapeHTML(pr.id)}">
                        ${pr.description ? `<p>${escapeHTML(pr.description)}</p>` : ""}
                        <p class="small muted">Added: ${escapeHTML(formatDate(pr.createdAt))} ·
                           Last reviewed: ${pr.lastReviewedAt ? escapeHTML(formatDate(pr.lastReviewedAt)) : "not yet"}</p>
                        <button class="btn sm" data-action="gh-details" data-id="${escapeHTML(pr.id)}" style="margin-top:8px">Load live details from GitHub</button>
                        <div data-gh="${escapeHTML(pr.id)}" class="small" style="margin-top:8px"></div>
                    </div>
                </details>
            </div>
            <div class="side">${badge(status)}${githubLink(pr)}${reReview}</div>
        </article>`;
}

function renderPrs() {
    const list = $("prList");
    if (prError) { list.innerHTML = errorState("Unable to load your pull requests", "Check your connection and the Firestore Security Rules, then refresh."); return; }
    const search = $("searchPrs").value.trim().toLowerCase();
    const filter = $("prStatusFilter").value;
    const byPr = reviewsByPr();
    const shown = prs.filter((pr) => {
        const okStatus = filter === "all" || normalizeStatus(pr.status) === filter;
        const hay = [pr.title, pr.repository, pr.number].map((v) => String(v ?? "").toLowerCase()).join(" ");
        return okStatus && hay.includes(search);
    }).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

    if (!prs.length) list.innerHTML = emptyState("No pull requests yet", "Use “Add pull request” to register one of your GitHub pull requests.", "⌘");
    else if (!shown.length) list.innerHTML = emptyState("No matches", "Try changing your search or filter.", "⌕");
    else list.innerHTML = shown.map((pr) => prCard(pr, byPr)).join("");
}

/* ---------- Feedback / Skills / History ---------- */

function renderFeedback() {
    const list = $("feedbackList");
    if (reviewError) { list.innerHTML = errorState("Unable to load feedback", "Check your connection and the Firestore Security Rules, then refresh."); return; }
    const latest = [...reviewsByPr().values()].map((arr) => arr[0]);
    list.innerHTML = latest.length
        ? sortNewest(latest).map((r) => reviewCard(r, { showReviewer: true })).join("")
        : emptyState("No feedback yet", "Feedback appears here after a reviewer reviews one of your pull requests.", "💬");
}

function renderSkills() {
    const box = $("skillBlock");
    box.innerHTML = reviewError
        ? errorState("Unable to calculate skills", "Your reviews could not be loaded. Refresh and try again.")
        : skillBlock(computeSkills(reviews), { subject: "Your" });
}

function renderHistory() {
    const list = $("historyList"), count = $("historyCount");
    if (reviewError) { count.textContent = ""; list.innerHTML = errorState("Unable to load review history", "Check your connection and the Firestore Security Rules, then refresh."); return; }

    const search = $("searchHistory").value.trim().toLowerCase();
    const status = $("historyStatus").value;
    const category = $("historyCategory").value;

    const shown = sortNewest(reviews).filter((r) => {
        const cats = ratingsOf(r).map(([c]) => c.toLowerCase());
        if (r.category) cats.push(String(r.category).toLowerCase());
        const hay = [r.pullRequestTitle, r.feedback, r.reviewerName, ...cats].map((v) => String(v ?? "").toLowerCase()).join(" ");
        return hay.includes(search) &&
            (status === "all" || String(r.status || "").toLowerCase() === status) &&
            (category === "all" || cats.includes(category));
    });
    count.textContent = `Showing ${shown.length} of ${reviews.length} reviews`;
    if (!reviews.length) list.innerHTML = emptyState("No review history yet", "Reviews of your pull requests will be listed here.", "◷");
    else if (!shown.length) list.innerHTML = emptyState("No reviews found", "Try changing your search or filters.", "⌕");
    else list.innerHTML = shown.map((r) => reviewCard(r, { showReviewer: true })).join("");
}

/* ---------- Loading ---------- */

function renderAll() {
    renderStats(); renderHero(); renderProfile(); renderOverviewSkills(); renderRecentFeedback();
    renderTimeline(); renderHeat(); renderNotice(); renderPrs(); renderFeedback(); renderSkills(); renderHistory();
}

async function load() {
    const uid = session.user.uid;
    ["prList", "feedbackList", "historyList"].forEach((id) => { $(id).innerHTML = loadingState(); });
    const [prResult, reviewResult] = await Promise.allSettled([
        queryDocs("pullRequests", "authorId", uid),
        queryDocs("reviews", "authorId", uid)
    ]);
    prError = prResult.status === "rejected";
    reviewError = reviewResult.status === "rejected";
    prs = prError ? [] : prResult.value;
    reviews = reviewError ? [] : reviewResult.value;
    if (prError) console.error("Unable to load pull requests:", prResult.reason);
    if (reviewError) console.error("Unable to load reviews:", reviewResult.reason);
    renderAll();
}

/* ---------- Actions ---------- */

async function onPrListClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button || button.disabled) return;
    const id = button.dataset.id;

    if (button.dataset.action === "rereview") {
        button.disabled = true;
        try {
            await requestReReview(id);
            const pr = prs.find((p) => p.id === id);
            if (pr) pr.status = STATUS.IN_REVIEW;
            showToast("Re-review requested. Your reviewer will see it in Pending Reviews.", "success");
            renderAll();
        } catch (error) {
            console.error("Unable to request re-review:", error);
            showToast("Unable to request a re-review. Please try again.", "error");
            button.disabled = false;
        }
    }

    if (button.dataset.action === "gh-details") {
        const pr = prs.find((p) => p.id === id);
        const target = [...document.querySelectorAll("[data-gh]")].find((el) => el.dataset.gh === id);
        target.textContent = "Contacting GitHub...";
        const result = await fetchPullDetails(pr ? pr.githubUrl : "");
        if (!result.ok) { target.textContent = result.message; return; }
        const d = result.data;
        target.innerHTML = `GitHub state: <strong>${escapeHTML(d.state)}</strong> · ${escapeHTML(d.changedFiles)} file(s) ·
            <span style="color:var(--ok)">+${escapeHTML(d.additions)}</span> <span style="color:var(--bad)">−${escapeHTML(d.deletions)}</span> · ${escapeHTML(d.commits)} commit(s)`;
    }
}

/* ---------- Start ---------- */

session = await requireRole([ROLES.DEVELOPER]);

$("prFormHost").innerHTML = prFormHTML();
const dialog = $("prDialog");
["openPrDialog", "openPrDialog2"].forEach((id) => $(id).addEventListener("click", () => openDialog(dialog)));
dialog.addEventListener("click", (e) => { if (e.target.closest("[data-close-dialog]") || e.target === dialog) closeDialog(dialog); });

showView();
window.addEventListener("hashchange", showView);

$("searchPrs").addEventListener("input", renderPrs);
$("prStatusFilter").addEventListener("change", renderPrs);
["searchHistory", "historyStatus", "historyCategory"].forEach((id) => {
    $(id).addEventListener(id === "searchHistory" ? "input" : "change", renderHistory);
});
$("prList").addEventListener("click", onPrListClick);

bindPrForm({
    form: $("prForm"),
    getAuthor: () => ({ id: session.user.uid, name: displayNameOf(session.profile, session.user) }),
    existingUrls: () => new Set(prs.map((p) => String(p.githubUrl || "").replace(/\/$/, "").toLowerCase())),
    onCreated: async () => { closeDialog(dialog); await load(); }
});

await load();
window.addEventListener("pageshow", (e) => { if (e.persisted) load(); });
