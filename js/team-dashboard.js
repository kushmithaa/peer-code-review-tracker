/* Team Lead workspace: overview analytics, members, PRs, reviews, skills, management. */

import {
    requireRole, ROLES, STATUS, listDocs, normalizeRole, normalizeStatus, isPending, escapeHTML, formatDate,
    toMillis, showToast, demoChip
} from "./common.js";

import {
    badge, prLabel, githubLink, emptyState, errorState, loadingState, skillBlock, priorityBadge, dueText,
    isOverdue, turnaroundMs, averageTurnaround, trendText, timeAgo
} from "./ui.js";

import { computeSkills, computeTeamSkills, SKILL_CATEGORIES } from "./skills.js";
import { donut, columns, hbars, radar, ring, STATUS_COLORS } from "./charts.js";
import { assignPullRequest, reopenPullRequest, linkLegacyReviews, bindPrForm, prFormHTML, openDialog, closeDialog } from "./pr-actions.js";

const $ = (id) => document.getElementById(id);
const VIEWS = ["overview", "members", "prs", "reviews", "skills", "manage"];
const TITLES = { overview: "Team overview", members: "Team members", prs: "Team PR activity", reviews: "Review activity", skills: "Skill growth analytics", manage: "Reviewer / PR management" };
const DAY = 86_400_000;

let session = null;
let users = [], prs = [], reviews = [];
const failed = { users: false, prs: false, reviews: false };

/* ---------- Views ---------- */

function currentView() {
    const wanted = window.location.hash.replace("#", "");
    return VIEWS.includes(wanted) ? wanted : "overview";
}

function showView() {
    const view = currentView();
    VIEWS.forEach((v) => $(`view-${v}`).classList.toggle("active", v === view));
    document.querySelectorAll(".team-rail [data-view]").forEach((a) => {
        a.classList.toggle("active", a.dataset.view === view);
        if (a.dataset.view === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    $("viewTitle").textContent = TITLES[view];
    $("filters").classList.toggle("hidden", view === "members" || view === "manage");
    document.title = `${TITLES[view]} | PeerReview`;
}

/* ---------- Data helpers ---------- */

const roleOf = (u) => normalizeRole(u.role);
const developers = () => users.filter((u) => roleOf(u) === ROLES.DEVELOPER);
const reviewers = () => users.filter((u) => roleOf(u) === ROLES.REVIEWER);
const prsById = () => new Map(prs.map((p) => [p.id, p]));
const nameOf = (u) => u.name || u.email || u.id;
const userName = (id, fallback = "Unknown") => { const u = users.find((x) => x.id === id); return u ? nameOf(u) : fallback; };

function table(headers, rows, numFrom = 99) {
    return `<div class="table-wrap"><table class="table"><thead><tr>${headers.map((h, i) => `<th class="${i >= numFrom ? "num" : ""}">${escapeHTML(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}
const td = (html, cls = "") => `<td class="${cls}">${html}</td>`;

/* Analytics filters (member / status / date range / data origin). */
function scoped() {
    const member = $("fMember").value, status = $("fStatus").value, range = $("fRange").value, origin = $("fData").value;
    const since = range === "all" ? 0 : Date.now() - Number(range) * DAY;
    const okOrigin = (x) => origin === "all" || (origin === "demo") === (x.demo === true);
    const inRange = (x) => !since || toMillis(x.createdAt) >= since;

    const p = prs.filter((x) =>
        okOrigin(x) && inRange(x) &&
        (status === "all" || normalizeStatus(x.status) === status) &&
        (member === "all" || x.authorId === member || x.reviewerId === member));
    const ids = new Set(p.map((x) => x.id));
    const r = reviews.filter((x) =>
        okOrigin(x) && inRange(x) &&
        (member === "all" || x.authorId === member || x.reviewerId === member) &&
        (status === "all" || ids.has(x.pullRequestId)));
    return { prs: p, reviews: r };
}

const failureBox = (what) => errorState(`Unable to load ${what}`, "Check your connection and the Firestore Security Rules, then refresh.");

/* ---------- KPIs ---------- */

function renderKpis(s) {
    const set = (id, v, sub) => { $(id).textContent = v; if (sub !== undefined) $(id + "Sub").textContent = sub; };
    set("statMembers", failed.users ? "—" : users.length, failed.users ? "" : `${developers().length} developers · ${reviewers().length} reviewers`);
    set("statPrs", failed.prs ? "—" : s.prs.length, "in current filter");
    set("statPending", failed.prs ? "—" : s.prs.filter(isPending).length);
    set("statReviews", failed.reviews ? "—" : s.reviews.length, "submitted");
    const total = s.reviews.length;
    const approved = s.reviews.filter((r) => normalizeStatus(r.status) === "Approved").length;
    const changes = s.reviews.filter((r) => normalizeStatus(r.status) === "Changes Requested").length;
    set("kpiApproval", failed.reviews || !total ? "—" : Math.round((approved / total) * 100) + "%");
    set("kpiChanges", failed.reviews || !total ? "—" : Math.round((changes / total) * 100) + "%");
}

/* ---------- Overview widgets ---------- */

function renderOverview(s) {
    if (failed.prs) {
        ["ovStatus", "ovWeekly", "ovWorkload", "ovAttention"].forEach((id) => { $(id).innerHTML = failureBox("pull requests"); });
    } else {
        const counts = {};
        [STATUS.OPEN, STATUS.IN_REVIEW, STATUS.CHANGES, STATUS.APPROVED, STATUS.MERGED].forEach((k) => { counts[k] = 0; });
        s.prs.forEach((p) => { const k = normalizeStatus(p.status); counts[k] = (counts[k] || 0) + 1; });
        $("ovStatus").innerHTML = s.prs.length
            ? donut(Object.entries(counts).filter(([, v]) => v > 0).map(([label, value]) => ({ label, value, color: STATUS_COLORS[label] || "#94a3b8" })),
                { size: 168, top: String(s.prs.length), bottom: "pull requests", label: "Pull requests by status" })
            : emptyState("No pull requests", "Nothing matches the current filters.", "⌘");

        const weeks = Array.from({ length: 8 }, (_, i) => ({ label: i === 7 ? "This wk" : `-${7 - i}w`, value: 0 }));
        const now = Date.now();
        s.prs.forEach((p) => {
            const ms = toMillis(p.createdAt); if (!ms) return;
            const w = Math.floor((now - ms) / (7 * DAY));
            if (w >= 0 && w < 8) weeks[7 - w].value += 1;
        });
        $("ovWeekly").innerHTML = weeks.some((w) => w.value)
            ? columns(weeks, { label: "Pull requests created per week" })
            : emptyState("No recent PRs", "No pull requests were created in the last 8 weeks.", "▥");

        renderWorkload(s);
        renderAttention(s);
    }

    renderOverviewSkills(s);
    renderPerformance(s, 6, "ovPerformance");
    renderTimeline(s);
}

function renderWorkload(s) {
    const ids = new Set([...reviewers().map((u) => u.id), ...s.prs.map((p) => p.reviewerId).filter(Boolean)]);
    if (!ids.size) { $("ovWorkload").innerHTML = emptyState("No reviewers", "Assign reviewers to see workload.", "👥"); return; }
    const rows = [...ids].map((id) => {
        const mine = s.prs.filter((p) => p.reviewerId === id);
        return { id, name: userName(id), assigned: mine.length, pending: mine.filter(isPending).length };
    }).sort((a, b) => b.assigned - a.assigned);
    const max = Math.max(...rows.map((r) => r.assigned), 1);
    $("ovWorkload").innerHTML = rows.map((r) => `
        <div style="margin:10px 0">
            <div class="row between small"><strong>${escapeHTML(r.name)}</strong><span class="muted">${r.assigned} assigned · ${r.pending} pending</span></div>
            <div class="meter" style="display:flex;margin-top:6px"><i style="flex:none;width:${((r.assigned - r.pending) / max) * 100}%;background:var(--ok)"></i><i style="flex:none;width:${(r.pending / max) * 100}%;background:var(--warn)"></i></div>
        </div>`).join("") +
        `<div class="legend"><span><i style="background:var(--ok)"></i>reviewed / other</span><span><i style="background:var(--warn)"></i>pending</span></div>`;
}

function renderAttention(s) {
    const unassigned = s.prs.filter((p) => !p.reviewerId);
    const overdue = s.prs.filter((p) => isOverdue(p));
    const noAuthor = s.prs.filter((p) => !p.authorId);
    const stale = s.prs.filter((p) => normalizeStatus(p.status) === STATUS.CHANGES && toMillis(p.lastReviewedAt) && Date.now() - toMillis(p.lastReviewedAt) > 7 * DAY);
    const row = (tone, text, items) => `<div class="notice ${tone}"><strong>${escapeHTML(text)}</strong>
        <div class="small muted">${items.slice(0, 3).map((p) => escapeHTML(p.title || p.id)).join(" · ")}${items.length > 3 ? ` · +${items.length - 3} more` : ""}</div></div>`;
    const out = [];
    if (overdue.length) out.push(row("warn", `${overdue.length} overdue review(s)`, overdue));
    if (unassigned.length) out.push(row("warn", `${unassigned.length} pull request(s) have no reviewer`, unassigned));
    if (noAuthor.length) out.push(row("warn", `${noAuthor.length} pull request(s) have no developer linked`, noAuthor));
    if (stale.length) out.push(row("", `${stale.length} pull request(s) waiting on changes for over 7 days`, stale));
    $("ovAttention").innerHTML = out.length
        ? out.join("") + `<a class="btn sm" href="#manage" style="justify-self:start">Open management</a>`
        : emptyState("Nothing needs attention", "No overdue, unassigned or stale pull requests.", "✓");
}

function renderOverviewSkills(s) {
    if (failed.reviews) { $("ovSkills").innerHTML = failureBox("skill data"); return; }
    const t = computeTeamSkills(s.reviews);
    $("ovSkills").innerHTML = t.overall
        ? `<div class="row wrap" style="gap:18px;justify-content:center">${ring(t.overall.score, { size: 104, caption: "team" })}
             <p class="muted small" style="max-width:22ch">${t.overall.n} rated review(s) across ${t.overall.categoriesAssessed} categories.</p></div>` +
          radar(t.categories.map((c) => ({ label: c.category.replace("Documentation", "Docs").replace("Performance", "Perf."), value: c.score })), { size: 280, label: "Team skill scores" })
        : emptyState("No assessments yet", "Team scores appear once reviews with 1–5 ratings exist.", "📈");
}

function memberRows(s, limit) {
    const byId = prsById();
    const rows = users.map((u) => {
        const role = roleOf(u);
        let activity = "—", score = "—", sortKey = 0;
        if (role === ROLES.DEVELOPER) {
            const own = s.prs.filter((p) => p.authorId === u.id);
            const received = s.reviews.filter((r) => r.authorId === u.id);
            const sk = computeSkills(received);
            activity = `${own.length} PR(s) · ${received.length} review(s) received`;
            score = sk.overall ? `${sk.overall.score}% skill` : "Not enough data";
            sortKey = own.length + received.length;
        } else if (role === ROLES.REVIEWER) {
            const assigned = s.prs.filter((p) => p.reviewerId === u.id);
            const done = s.reviews.filter((r) => r.reviewerId === u.id);
            const t = averageTurnaround(done.map((r) => turnaroundMs(r, byId.get(r.pullRequestId))));
            activity = `${assigned.filter(isPending).length} pending · ${done.length} written`;
            score = t.count ? `${t.text} avg turnaround` : "activity only";
            sortKey = assigned.length + done.length;
        }
        return { u, role, activity, score, sortKey };
    }).sort((a, b) => b.sortKey - a.sortKey);
    return (limit ? rows.slice(0, limit) : rows);
}

function renderPerformance(s, limit, target) {
    if (failed.users) { $(target).innerHTML = failureBox("team members"); return; }
    const rows = memberRows(s, limit);
    $(target).innerHTML = rows.length
        ? table(["Member", "Role", "Activity", "Performance"], rows.map(({ u, role, activity, score }) =>
            `<tr>${td(escapeHTML(nameOf(u)) + " " + demoChip(u))}${td(escapeHTML(role || String(u.role || "Unknown")))}${td(escapeHTML(activity))}${td(escapeHTML(score))}</tr>`))
        : emptyState("No team members", "Registered users will be listed here.", "👥");
}

function renderTimeline(s) {
    const events = [
        ...s.prs.map((p) => ({ t: toMillis(p.createdAt), tone: "info", text: `${p.authorName || "A developer"} submitted ${p.title || "a pull request"}` })),
        ...s.reviews.map((r) => ({ t: toMillis(r.createdAt), tone: normalizeStatus(r.status) === "Approved" ? "ok" : "warn",
            text: `${r.reviewerName || "A reviewer"} ${normalizeStatus(r.status) === "Approved" ? "approved" : "requested changes on"} ${r.pullRequestTitle || "a pull request"}` }))
    ].filter((e) => e.t).sort((a, b) => b.t - a.t).slice(0, 7);
    $("ovTimeline").innerHTML = events.length
        ? `<ul class="timeline">${events.map((e) => `<li class="${e.tone}"><div>${escapeHTML(e.text)}</div><div class="t">${escapeHTML(timeAgo(e.t))}</div></li>`).join("")}</ul>`
        : emptyState("No activity", "Nothing matches the current filters.", "◷");
}

/* ---------- Members ---------- */

function renderMembers() {
    const box = $("membersTable");
    if (failed.users) { box.innerHTML = failureBox("team members"); return; }
    const all = { prs, reviews };
    const rows = memberRows(all).map(({ u, role, activity, score }) =>
        `<tr>${td(escapeHTML(nameOf(u)) + " " + demoChip(u))}${td(escapeHTML(u.email || ""))}${td(escapeHTML(role || String(u.role || "Unknown")))}${td(escapeHTML(activity))}${td(escapeHTML(score))}</tr>`);
    box.innerHTML = rows.length ? table(["Name", "Email", "Role", "Activity", "Performance"], rows)
        : emptyState("No team members", "Registered users will be listed here.", "👥");
}

/* ---------- PR activity ---------- */

function renderPrActivity(s) {
    if (failed.prs) { ["prStatusBars", "prMonthly", "prTable"].forEach((id) => { $(id).innerHTML = failureBox("pull requests"); }); return; }
    const counts = {};
    [STATUS.OPEN, STATUS.IN_REVIEW, STATUS.CHANGES, STATUS.APPROVED, STATUS.MERGED].forEach((k) => { counts[k] = 0; });
    s.prs.forEach((p) => { const k = normalizeStatus(p.status); counts[k] = (counts[k] || 0) + 1; });
    const entries = Object.entries(counts);
    $("prStatusBars").innerHTML = s.prs.length
        ? hbars(entries.map(([label, value]) => ({ label, value, color: STATUS_COLORS[label] })), { max: Math.max(...entries.map((e) => e[1]), 1) })
        : emptyState("No pull requests", "Add pull requests in Reviewer / PR Management.", "⌘");

    const months = {}; let undated = 0;
    s.prs.forEach((p) => {
        const ms = toMillis(p.createdAt); if (!ms) { undated += 1; return; }
        const d = new Date(ms), key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        months[key] = (months[key] || 0) + 1;
    });
    const me = Object.entries(months).sort(([a], [b]) => a.localeCompare(b));
    $("prMonthly").innerHTML = (me.length ? columns(me.map(([label, value]) => ({ label: label.slice(2), value })), { label: "Pull requests created per month" })
        : emptyState("No dated pull requests", "Activity over time needs a createdAt date on pull requests.", "▥")) +
        (undated ? `<p class="muted small">${undated} PR(s) have no creation date and are not shown here.</p>` : "");

    $("prTable").innerHTML = s.prs.length
        ? table(["Pull request", "Developer", "Reviewer", "Priority", "Status", "Created"],
            [...s.prs].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)).map((p) => `<tr>
                ${td(`<strong>${escapeHTML(p.title || "Untitled")}</strong> ${demoChip(p)}<br><span class="muted small">${escapeHTML(prLabel(p))} · ${escapeHTML(p.repository || "")}</span>`)}
                ${td(escapeHTML(p.authorName || "—"))}${td(escapeHTML(p.reviewerName || (p.reviewerId ? "Assigned" : "Unassigned")))}
                ${td(priorityBadge(p.priority) || "—")}${td(badge(p.status))}${td(escapeHTML(p.createdAt ? formatDate(p.createdAt) : "—"))}</tr>`))
        : "";
}

/* ---------- Review activity ---------- */

function renderReviewActivity(s) {
    if (failed.reviews || failed.prs) { $("reviewerTable").innerHTML = failureBox("review activity"); $("turnaround").textContent = ""; return; }
    const byId = prsById();
    const all = averageTurnaround(s.reviews.map((r) => turnaroundMs(r, byId.get(r.pullRequestId))));
    $("turnaround").textContent =
        `${s.reviews.length} review(s) completed · ${s.prs.filter(isPending).length} pending assignment(s) · average turnaround: ${all.text}` +
        (all.count !== all.total ? ` (based on ${all.count} of ${all.total} reviews that have both assignment/creation and review timestamps)` : "");

    const ids = new Set([...reviewers().map((u) => u.id), ...s.prs.map((p) => p.reviewerId).filter(Boolean), ...s.reviews.map((r) => r.reviewerId).filter(Boolean)]);
    if (!ids.size) { $("reviewerTable").innerHTML = emptyState("No reviewer activity", "Assign reviewers to pull requests to see activity.", "✎"); return; }

    const st = (r) => String(r.status || "").toLowerCase();
    $("reviewerTable").innerHTML = table(["Reviewer", "Assigned", "Pending", "Completed", "Approved", "Changes requested", "Avg turnaround"],
        [...ids].map((id) => {
            const mine = s.reviews.filter((r) => r.reviewerId === id);
            const assigned = s.prs.filter((p) => p.reviewerId === id);
            const t = averageTurnaround(mine.map((r) => turnaroundMs(r, byId.get(r.pullRequestId))));
            const fallback = (mine[0] && mine[0].reviewerName) || id;
            return `<tr>${td(escapeHTML(userName(id, fallback)))}${td(assigned.length, "num")}${td(assigned.filter(isPending).length, "num")}${td(mine.length, "num")}${td(mine.filter((r) => st(r) === "approved").length, "num")}${td(mine.filter((r) => st(r) === "changes requested").length, "num")}${td(escapeHTML(t.text), "num")}</tr>`;
        }), 1);
}

/* ---------- Skills ---------- */

function renderSkills(s) {
    if (failed.reviews || failed.users) { $("teamSkills").innerHTML = failureBox("skill data"); $("devSkillsTable").innerHTML = ""; return; }
    const team = computeTeamSkills(s.reviews);
    const names = (status) => team.categories.filter((c) => c.status === status).map((c) => c.category);
    const line = (label, list, none) => `<strong>${label}:</strong> ${list.length ? list.map(escapeHTML).join(", ") : none}`;

    $("teamSkills").innerHTML = skillBlock(team, { subject: "Team", extraNote: "Pooled across all developers." }) +
        (team.overall ? `<div class="notice" style="margin-top:14px">
            ${line("Skill gaps (below 60%, 3+ ratings)", names("gap"), "none supported by current data")}<br>
            ${line("Strengths (80%+, 3+ ratings)", names("strength"), "none yet")}<br>
            ${line("Too little data to judge (under 3 ratings)", names("insufficient"), "none")}<br>
            ${line("No assessments yet", names("no-data"), "none")}</div>` : "");

    const devs = developers();
    if (!devs.length) { $("devSkillsTable").innerHTML = emptyState("No developers", "Registered developers will be listed here.", "👥"); return; }
    $("devSkillsTable").innerHTML = table(["Developer", "Overall", "Reviews used", "Progress (previous → current)", "Strengths", "Needs improvement"],
        devs.map((u) => {
            const sk = computeSkills(s.reviews.filter((r) => r.authorId === u.id));
            return `<tr>${td(escapeHTML(nameOf(u)))}${td(sk.overall ? `<strong>${sk.overall.score}%</strong>` : "Not enough data")}${td(sk.assessedCount, "num")}
                ${td(escapeHTML(sk.overall ? trendText(sk.overall.trend) : "—"))}${td(escapeHTML(sk.strengths.join(", ") || "—"))}${td(escapeHTML(sk.improvements.join(", ") || "—"))}</tr>`;
        }), 2);
}

/* ---------- Management ---------- */

function options(list, selectedId, emptyLabel) {
    return `<option value="">${escapeHTML(emptyLabel)}</option>` + list.map((u) =>
        `<option value="${escapeHTML(u.id)}" ${u.id === selectedId ? "selected" : ""}>${escapeHTML(nameOf(u))}</option>`).join("");
}

function renderLegacy() {
    const box = $("legacyBox");
    box.innerHTML = "";
    if (failed.reviews || failed.prs) return;
    const byId = prsById();
    const linkable = reviews.filter((r) => !r.authorId && byId.get(r.pullRequestId) && byId.get(r.pullRequestId).authorId);
    const blocked = reviews.filter((r) => !r.authorId && !(byId.get(r.pullRequestId) && byId.get(r.pullRequestId).authorId));
    if (!linkable.length && !blocked.length) return;

    box.innerHTML = `<div class="notice warn" style="margin-bottom:14px"><strong>Older reviews not linked to a developer</strong>
        <p class="small">Developers can only see reviews that carry their user id. ${linkable.length} review(s) can be linked now from their pull request.${blocked.length ? ` ${blocked.length} more belong to a pull request with no developer; set the developer below first.` : ""}</p>
        ${linkable.length ? `<button class="btn primary sm" id="linkLegacy" style="margin-top:8px">Link ${linkable.length} legacy review(s)</button>` : ""}</div>`;

    const btn = $("linkLegacy");
    if (btn) btn.addEventListener("click", async () => {
        btn.disabled = true;
        try { const n = await linkLegacyReviews(reviews, byId); showToast(`Linked ${n} review(s).`, "success"); await load(); }
        catch (error) { console.error("Unable to link legacy reviews:", error); showToast("Unable to link reviews. Check your permissions.", "error"); btn.disabled = false; }
    });
}

function renderManage() {
    const box = $("manageTable");
    if (failed.prs || failed.users) { box.innerHTML = failureBox("pull requests"); return; }
    const search = $("searchManage").value.trim().toLowerCase();
    const filter = $("manageFilter").value;

    const shown = prs.filter((p) => {
        const hay = [p.title, p.repository, p.authorName, p.reviewerName].map((v) => String(v ?? "").toLowerCase()).join(" ");
        const ok = filter === "all" || (filter === "unassigned" && !p.reviewerId) || (filter === "pending" && isPending(p)) || (filter === "no-author" && !p.authorId);
        return ok && hay.includes(search);
    }).sort((a, b) => Number(isPending(b)) - Number(isPending(a)) || toMillis(b.createdAt) - toMillis(a.createdAt));

    if (!prs.length) { box.innerHTML = emptyState("No pull requests yet", "Use “Add pull request” above.", "⌘"); return; }
    if (!shown.length) { box.innerHTML = emptyState("No matches", "Try changing your search or filter.", "⌕"); return; }

    const devs = developers(), revs = reviewers();
    box.innerHTML = table(["Pull request", "Developer", "Reviewer", "Status", "Actions"], shown.map((p) => {
        const reopenable = ![STATUS.OPEN, STATUS.IN_REVIEW].includes(p.status);   // anything not canonically Open/In Review (incl. legacy values)
        return `<tr data-row="${escapeHTML(p.id)}" ${!p.reviewerId ? 'style="background:rgba(251,191,36,.06)"' : ""}>
            ${td(`<strong>${escapeHTML(p.title || "Untitled")}</strong> ${demoChip(p)}<br><span class="muted small">${escapeHTML(prLabel(p))} · ${escapeHTML(p.repository || "")} ${priorityBadge(p.priority)} ${isOverdue(p) ? '<span class="badge overdue">Overdue</span>' : ""}</span>`)}
            ${td(`<select class="select" data-field="author" aria-label="Developer for ${escapeHTML(p.title || p.id)}">${options(devs, p.authorId, "— none —")}</select>`)}
            ${td(`<select class="select" data-field="reviewer" aria-label="Reviewer for ${escapeHTML(p.title || p.id)}">${options(revs, p.reviewerId, "— unassigned —")}</select>`)}
            ${td(badge(p.status))}
            ${td(`<div class="row wrap"><button class="btn primary sm" data-action="save" data-id="${escapeHTML(p.id)}">Save</button>
                  ${reopenable ? `<button class="btn sm" data-action="reopen" data-id="${escapeHTML(p.id)}">Reopen</button>` : ""}${githubLink(p, "GitHub ↗")}</div>`)}
        </tr>`;
    }));
}

async function onManageClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button || button.disabled) return;
    const id = button.dataset.id;
    const pr = prs.find((p) => p.id === id);
    const row = button.closest("tr");
    button.disabled = true;

    try {
        if (button.dataset.action === "reopen") {
            await reopenPullRequest(id);
            showToast("Pull request reopened for review.", "success");
        } else {
            const authorId = row.querySelector('[data-field="author"]').value;
            const reviewerId = row.querySelector('[data-field="reviewer"]').value;
            const byId = new Map(users.map((u) => [u.id, u]));
            const patch = {};
            if (reviewerId !== (pr.reviewerId || "")) {
                patch.reviewer = reviewerId ? { id: reviewerId, name: nameOf(byId.get(reviewerId)) } : null;
                patch.assignedNow = true;
            }
            if (authorId && authorId !== (pr.authorId || "")) patch.author = { id: authorId, name: nameOf(byId.get(authorId)) };
            if (patch.reviewer === undefined && !patch.author) {
                showToast("Nothing to save: no changes were made.", "info");
                button.disabled = false;
                return;
            }
            await assignPullRequest(id, patch);
            showToast("Pull request updated.", "success");
        }
        await load();
    } catch (error) {
        console.error("Management action failed:", error);
        showToast("Unable to save the change. Check your permissions and try again.", "error");
        button.disabled = false;
    }
}

/* ---------- Render / load ---------- */

function fillFilters() {
    const member = $("fMember"), keep = member.value;
    member.innerHTML = `<option value="all">All members</option>` + users.map((u) => `<option value="${escapeHTML(u.id)}">${escapeHTML(nameOf(u))}</option>`).join("");
    member.value = [...member.options].some((o) => o.value === keep) ? keep : "all";
    const hasDemo = [...users, ...prs, ...reviews].some((x) => x.demo === true);
    $("fData").classList.toggle("hidden", !hasDemo);
    const authorSelect = $("newPrAuthor");
    if (authorSelect) { const k = authorSelect.value; authorSelect.innerHTML = options(developers(), k, "Select developer..."); authorSelect.value = k; }
}

function renderAll() {
    const s = scoped();
    renderKpis(s);
    renderOverview(s);
    renderMembers();
    renderPrActivity(s);
    renderReviewActivity(s);
    renderSkills(s);
    renderLegacy();
    renderManage();
}

async function load() {
    const settle = async (key, name) => {
        try { failed[key] = false; return await listDocs(name); }
        catch (error) { console.error(`Unable to load ${name}:`, error); failed[key] = true; return []; }
    };
    $("manageTable").innerHTML = loadingState();
    [users, prs, reviews] = await Promise.all([settle("users", "users"), settle("prs", "pullRequests"), settle("reviews", "reviews")]);
    fillFilters();
    renderAll();
}

/* ---------- Start ---------- */

session = await requireRole([ROLES.TEAM_LEAD]);

$("prFormHost").innerHTML = prFormHTML({ team: true });
const dialog = $("prDialog");
$("openPrDialog").addEventListener("click", () => openDialog(dialog));
dialog.addEventListener("click", (e) => { if (e.target.closest("[data-close-dialog]") || e.target === dialog) closeDialog(dialog); });

showView();
window.addEventListener("hashchange", showView);

["fMember", "fStatus", "fRange", "fData"].forEach((id) => $(id).addEventListener("change", renderAll));
$("searchManage").addEventListener("input", renderManage);
$("manageFilter").addEventListener("change", renderManage);
$("manageTable").addEventListener("click", onManageClick);

bindPrForm({
    form: $("prForm"),
    getAuthor: () => {
        const id = $("newPrAuthor").value;
        const user = users.find((u) => u.id === id);
        return user ? { id, name: nameOf(user) } : null;
    },
    existingUrls: () => new Set(prs.map((p) => String(p.githubUrl || "").replace(/\/$/, "").toLowerCase())),
    onCreated: async () => { closeDialog(dialog); await load(); }
});

await load();
window.addEventListener("pageshow", (e) => { if (e.persisted) load(); });
