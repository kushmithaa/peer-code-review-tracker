/* Shared renderers (HTML strings) used by several pages. */

import {
    escapeHTML,
    normalizeStatus,
    badgeClass,
    formatDate,
    toMillis,
    isPending,
    demoChip
} from "./common.js";
import { isValidGitHubPullUrl } from "./github.js";
import { SKILL_CATEGORIES, ratingsOf } from "./skills.js";
import { ring, radar } from "./charts.js";

export function badge(status) {
    const s = normalizeStatus(status);
    return `<span class="badge ${badgeClass(s)}">${escapeHTML(s)}</span>`;
}

export function priorityBadge(priority) {
    const p = ["High", "Medium", "Low"].includes(priority) ? priority : null;
    return p ? `<span class="badge ${p.toLowerCase()}">${p} priority</span>` : "";
}

export function prLabel(pr) {
    return pr.number ? `#${pr.number}` : `PR ${pr.id}`;
}

export function githubLink(pr, label = "View on GitHub ↗") {
    if (isValidGitHubPullUrl(pr.githubUrl)) {
        return `<a class="btn ghost sm" href="${escapeHTML(String(pr.githubUrl).trim())}"
                   target="_blank" rel="noopener noreferrer">${label}</a>`;
    }
    return `<span class="muted small" title="No valid GitHub pull request URL is stored">No GitHub link</span>`;
}

export function emptyState(title, text, glyph = "✦") {
    return `<div class="empty"><div class="glyph" aria-hidden="true">${glyph}</div><strong>${escapeHTML(title)}</strong><span>${escapeHTML(text)}</span></div>`;
}

export function errorState(title, text) {
    return `<div class="empty error" role="alert"><div class="glyph" aria-hidden="true">!</div><strong>${escapeHTML(title)}</strong><span>${escapeHTML(text)}</span></div>`;
}

export function loadingState(text = "Loading...") {
    return `<div role="status" aria-label="${escapeHTML(text)}" class="stack"><div class="skeleton"></div><div class="skeleton"></div></div>`;
}

export function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "n/a";
    const hours = ms / 3_600_000;
    if (hours < 1) return `${Math.max(1, Math.round(ms / 60000))} min`;
    if (hours < 48) return `${hours.toFixed(1)} h`;
    return `${(hours / 24).toFixed(1)} days`;
}

export function timeAgo(value, now = Date.now()) {
    const ms = toMillis(value);
    if (!ms) return "";
    const diff = now - ms;
    if (diff < 0) return "just now";
    const d = Math.floor(diff / 86_400_000);
    if (d >= 2) return `${d} days ago`;
    const h = Math.floor(diff / 3_600_000);
    if (h >= 1) return `${h}h ago`;
    return "just now";
}

export function isOverdue(pr, now = Date.now()) {
    const due = toMillis(pr.dueDate);
    return isPending(pr) && due > 0 && due < now;
}

/* "due in 2 days" / "overdue by 1 day" / "" */
export function dueText(pr, now = Date.now()) {
    const due = toMillis(pr.dueDate);
    if (!due) return "";
    const days = Math.ceil((due - now) / 86_400_000);
    if (days < 0) return `overdue by ${-days} day${days === -1 ? "" : "s"}`;
    if (days === 0) return "due today";
    return `due in ${days} day${days === 1 ? "" : "s"}`;
}

export function ratingText(review) {
    const pairs = ratingsOf(review);
    if (!pairs.length) return "Not rated";
    return pairs.length === 1 ? `${pairs[0][1]}/5` : `${pairs.length} categories rated`;
}

function ratingChips(review) {
    const pairs = ratingsOf(review);
    if (!pairs.length) {
        return `<span class="chip">Not rated</span>${review.category ? `<span class="chip accent">${escapeHTML(review.category)}</span>` : ""}`;
    }
    return pairs.map(([c, r]) =>
        `<span class="chip" title="${escapeHTML(c)} rated ${r} out of 5"><b>${r}/5</b> ${escapeHTML(c)}</span>`
    ).join("");
}

/* One saved review. */
export function reviewCard(review, { showReviewer = false, showDeveloper = false } = {}) {
    const status = normalizeStatus(review.status || "Submitted");
    const who = [];
    if (showReviewer) who.push(`Reviewer: ${escapeHTML(review.reviewerName || "Unknown")}`);
    if (showDeveloper) who.push(`Developer: ${escapeHTML(review.authorName || "Unknown")}`);
    const number = review.pullRequestNumber ? `#${escapeHTML(review.pullRequestNumber)} · ` : "";
    const link = isValidGitHubPullUrl(review.githubUrl)
        ? `<a class="small" href="${escapeHTML(review.githubUrl)}" target="_blank" rel="noopener noreferrer">View pull request on GitHub ↗</a>`
        : "";

    return `
        <article class="item history-card">
            <div class="body">
                <h3>${escapeHTML(review.pullRequestTitle || "Untitled Pull Request")}</h3>
                <p class="meta">${number}${escapeHTML(review.repository || review.pullRequestId || "")}
                    ${who.length ? " · " + who.join(" · ") : ""} · ${escapeHTML(formatDate(review.createdAt))}</p>
                <div class="chips" style="margin-top:10px">${ratingChips(review)}</div>
                <p class="quote">${escapeHTML(review.feedback || "No feedback provided.")}</p>
                ${link ? `<p style="margin-top:8px">${link}</p>` : ""}
            </div>
            <div class="side">${badge(status)}${demoChip(review)}</div>
        </article>`;
}

/* Newest first. */
export function sortNewest(list) {
    return [...list].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
}

export function trendText(trend) {
    if (!trend || trend.status === "insufficient") {
        return "Progress needs 4+ ratings";
    }
    const sign = trend.change > 0 ? "+" : "";
    const arrow = trend.status === "improving" ? "▲" : trend.status === "declining" ? "▼" : "●";
    return `Previous ${trend.previous}% → Current ${trend.current}% ${arrow} ${sign}${trend.change} pts`;
}

function trendClass(trend) {
    if (!trend) return "flat";
    return trend.status === "improving" ? "up" : trend.status === "declining" ? "down" : "flat";
}

/* Skill panel for a developer or the pooled team. */
export function skillBlock(skills, { subject = "Your", extraNote = "" } = {}) {
    if (!skills.overall) {
        const legacy = skills.unassessedCount
            ? ` ${skills.unassessedCount} review(s) have no 1–5 rating and are not counted.`
            : "";
        return emptyState(
            "Not enough assessment data yet",
            "Scores appear after reviews that include 1–5 category ratings are submitted." + legacy,
            "📈"
        );
    }

    const o = skills.overall;
    const rows = skills.categories.map((c) => {
        const score = c.score === null ? "Not assessed" : `${c.score}%`;
        const width = c.score === null ? 0 : c.score;
        const flag = c.lowConfidence ? ` <span class="chip">low confidence</span>` : "";
        return `
            <div class="skill-row">
                <div class="row between"><strong>${escapeHTML(c.category)}${flag}</strong><strong>${score}</strong></div>
                <div class="meter ${c.score !== null && c.score < 60 ? "warn" : ""}"><i style="width:${width}%"></i></div>
                <div class="row between small muted">
                    <span>${c.n} rating(s) used</span>
                    <span class="delta ${trendClass(c.trend)}">${escapeHTML(trendText(c.trend))}</span>
                </div>
            </div>`;
    }).join("");

    const chips = (items, none) => items.length
        ? items.map((i) => `<span class="chip accent">${escapeHTML(i)}</span>`).join(" ")
        : `<span class="muted small">${none}</span>`;

    return `
        <div class="skill-split">
            <div class="stack" style="justify-items:center">
                <div class="score-ring">${ring(o.score, { caption: "overall" })}</div>
                ${radar(skills.categories.map((c) => ({ label: c.category.replace("Documentation", "Docs").replace("Performance", "Perf."), value: c.score })), { size: 280, label: "Category scores" })}
            </div>
            <div>
                <p><strong>${escapeHTML(subject)} overall skill score: ${o.score}%</strong></p>
                <p class="muted small">Average of ${o.categoriesAssessed} assessed categor${o.categoriesAssessed === 1 ? "y" : "ies"},
                   from ${o.n} rated review(s). ${escapeHTML(trendText(o.trend))}.</p>
                ${rows}
                <p class="small" style="margin-top:12px"><strong>Strengths (80%+):</strong> ${chips(skills.strengths, "none yet")}</p>
                <p class="small" style="margin-top:6px"><strong>Needs improvement (below 60%):</strong> ${chips(skills.improvements, "none identified")}</p>
            </div>
        </div>
        <p class="muted small" style="margin-top:14px">Method: category score = average reviewer rating (1–5) ÷ 5; overall = average of
           assessed categories. Only rated reviews are used; ${skills.unassessedCount} review(s) without a
           rating are excluded. ${escapeHTML(extraNote)}</p>`;
}

export { SKILL_CATEGORIES, demoChip };

/* ---------- Reviewer queue ---------- */

const PRIO_RANK = { High: 0, Medium: 1, Low: 2 };

/* Overdue first, then priority, then longest waiting. */
export function sortQueue(prs, now = Date.now()) {
    const waitStart = (p) => toMillis(p.assignedAt) || toMillis(p.createdAt) || now;
    return [...prs].sort((a, b) =>
        Number(isOverdue(b, now)) - Number(isOverdue(a, now)) ||
        (PRIO_RANK[a.priority] ?? 3) - (PRIO_RANK[b.priority] ?? 3) ||
        waitStart(a) - waitStart(b)
    );
}

export function prQueueItem(pr, now = Date.now()) {
    const pending = isPending(pr);
    const overdue = isOverdue(pr, now);
    const prio = ["High", "Medium", "Low"].includes(pr.priority) ? pr.priority.toLowerCase() : "";
    const due = dueText(pr, now);
    const since = toMillis(pr.assignedAt) || toMillis(pr.createdAt);

    return `
        <article class="item q-item ${prio ? "p-" + prio : ""} ${overdue ? "is-overdue" : ""}" data-pr="${escapeHTML(pr.id)}">
            <div class="body">
                <h3>${escapeHTML(pr.title || "Untitled Pull Request")}</h3>
                <p class="meta">${escapeHTML(prLabel(pr))} · ${escapeHTML(pr.repository || "Repository not set")}
                    · Developer: ${escapeHTML(pr.authorName || "Unknown")}</p>
                <div class="chips" style="margin-top:8px">
                    ${priorityBadge(pr.priority)}
                    ${overdue ? `<span class="badge overdue">Overdue</span>` : ""}
                    ${due ? `<span class="chip">${escapeHTML(due)}</span>` : ""}
                    ${pending && since ? `<span class="chip">waiting ${escapeHTML(formatDuration(now - since))}</span>` : ""}
                    ${demoChip(pr)}
                </div>
            </div>
            <div class="side">
                ${badge(pr.status)}
                <a class="btn ${pending ? "primary" : ""} sm" href="review-pr.html?id=${encodeURIComponent(pr.id)}">${pending ? "Open Review" : "View"}</a>
                ${githubLink(pr)}
            </div>
        </article>`;
}

/* Review turnaround in ms (assignment/creation -> review), null when timestamps are missing. */
export function turnaroundMs(review, pr) {
    if (!pr) return null;
    const start = toMillis(pr.assignedAt) || toMillis(pr.createdAt);
    const end = toMillis(review.createdAt);
    return start && end && end >= start ? end - start : null;
}

export function averageTurnaround(values) {
    const ok = values.filter((v) => v !== null);
    return {
        count: ok.length,
        total: values.length,
        ms: ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null,
        text: ok.length ? formatDuration(ok.reduce((a, b) => a + b, 0) / ok.length) : "n/a"
    };
}

/* Compact single-line row (used where a full queue card would repeat itself). */
export function prCompactRow(pr) {
    return `
        <a class="item link" href="review-pr.html?id=${encodeURIComponent(pr.id)}">
            <div class="body">
                <h3>${escapeHTML(pr.title || "Untitled Pull Request")}</h3>
                <p class="meta">${escapeHTML(prLabel(pr))} · ${escapeHTML(pr.repository || "Repository not set")} · Developer: ${escapeHTML(pr.authorName || "Unknown")}</p>
            </div>
            <div class="side" style="flex-direction:row;align-items:center">${priorityBadge(pr.priority)}${badge(pr.status)}</div>
        </a>`;
}
