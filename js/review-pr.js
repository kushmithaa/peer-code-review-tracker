/* Review a single pull request (Reviewer role). */

import {
    doc, getDoc, collection, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

import { db } from "./firebase-config.js";

import {
    requireRole, ROLES, isPending, normalizeStatus, escapeHTML, formatDate, displayNameOf, showToast, STATUS, demoChip, isDemo
} from "./common.js";

import { fetchPullDetails, isValidGitHubPullUrl } from "./github.js";
import { SKILL_CATEGORIES } from "./skills.js";
import { priorityBadge, dueText } from "./ui.js";

const $ = (id) => document.getElementById(id);

const prTitle = $("prTitle");
const prMeta = $("prMeta");
const githubButton = $("githubButton");
const feedback = $("feedback");
const approveButton = $("approveButton");
const changesButton = $("changesButton");
const message = $("message");
const githubInfo = $("githubInfo");

const pullRequestId = new URLSearchParams(window.location.search).get("id");

let session = null;
let currentPR = null;
let isSubmitting = false;
let formLocked = false;

const slug = (c) => c.toLowerCase().replace(/\s+/g, "-");
const radios = () => [...document.querySelectorAll("#ratingRows input[type=radio]")];

/* { "Code Quality": 4, ... } for the categories the reviewer rated. */
function readRatings() {
    const out = {};
    SKILL_CATEGORIES.forEach((c) => {
        const checked = document.querySelector(`input[name="rating-${slug(c)}"]:checked`);
        const n = checked ? Number(checked.value) : NaN;
        if (Number.isInteger(n) && n >= 1 && n <= 5) out[c] = n;
    });
    return out;
}

function showMessage(html, type) {
    message.innerHTML = html;
    message.className = `form-msg ${type}`;
}

function setFormDisabled(disabled) {
    [approveButton, changesButton, feedback, ...radios()].forEach((el) => { el.disabled = disabled; });
}

function lockForm(reasonHtml, type = "error") {
    formLocked = true;
    setFormDisabled(true);
    showMessage(reasonHtml, type);
}

const NAV_LINKS = `
    <br><a href="pending-reviews.html">← Pending Reviews</a> ·
    <a href="review-history.html">My Review History</a> ·
    <a href="reviewer-dashboard.html">Dashboard</a>`;

function failWithTitle(title, meta) {
    prTitle.textContent = title;
    prMeta.textContent = meta;
    githubButton.classList.add("hidden");
    setFormDisabled(true);
    formLocked = true;
}

/* ---------- GitHub details (live, public API, no token) ---------- */

async function loadGitHubDetails(url, manual = false) {
    if (!isValidGitHubPullUrl(url)) {
        githubInfo.textContent = "No valid GitHub pull request URL is stored for this PR, so live details are unavailable.";
        return;
    }
    if (isDemo() && !manual) {
        githubInfo.innerHTML = `<p>Demo mode does not contact GitHub automatically (demo links point to example repositories).</p>
            <button type="button" class="btn sm" id="loadGitHub" style="margin-top:8px">Try loading from GitHub anyway</button>`;
        document.getElementById("loadGitHub").addEventListener("click", () => loadGitHubDetails(url, true));
        return;
    }
    githubInfo.textContent = "Contacting GitHub...";
    const result = await fetchPullDetails(url);

    if (!result.ok) {
        githubInfo.innerHTML = `${escapeHTML(result.message)} Use <strong>View on GitHub</strong> to inspect the code.`;
        return;
    }
    const d = result.data;
    const files = d.files.map((f) => `
        <li><code class="mono">${escapeHTML(f.filename)}</code>
            <span style="color:var(--ok)">+${escapeHTML(f.additions)}</span>
            <span style="color:var(--bad)">−${escapeHTML(f.deletions)}</span>
            <span class="muted">(${escapeHTML(f.status)})</span></li>`).join("");

    githubInfo.innerHTML = `
        <p><strong>${escapeHTML(d.title)}</strong> by ${escapeHTML(d.authorLogin || "unknown")}
           · GitHub state: <strong>${escapeHTML(d.state)}</strong> · opened ${escapeHTML(formatDate(d.createdAt))}</p>
        <p style="margin-top:6px">${escapeHTML(d.changedFiles)} file(s) changed,
           <span style="color:var(--ok)">+${escapeHTML(d.additions)}</span>
           <span style="color:var(--bad)">−${escapeHTML(d.deletions)}</span> lines, ${escapeHTML(d.commits)} commit(s)</p>
        ${d.body ? `<div class="notice" style="margin-top:10px">${escapeHTML(d.body.slice(0, 500))}${d.body.length > 500 ? "…" : ""}</div>` : ""}
        ${files ? `<ul class="stack small" style="margin-top:10px;padding-left:18px">${files}</ul>` : ""}
        ${d.filesTruncated ? `<p class="muted small">Showing the first ${d.files.length} files only.</p>` : ""}
        <p class="muted small" style="margin-top:10px">Live data from GitHub's public API. The status above is this app's own
           review status; it is not synchronised with GitHub. Open the PR on GitHub to read the code.</p>`;
}

/* ---------- Load the pull request ---------- */

async function loadPullRequest() {
    if (!pullRequestId) {
        failWithTitle("Pull Request ID Missing", "Open this page from Pending Reviews or PRs Assigned to Me.");
        return;
    }
    prTitle.textContent = "Loading Pull Request...";
    prMeta.textContent = "Loading information...";

    let snapshot;
    try {
        snapshot = await getDoc(doc(db, "pullRequests", pullRequestId));
    } catch (error) {
        console.error("Error loading pull request:", error);
        failWithTitle("Unable to Load Pull Request", "You can only open pull requests assigned to you. Check your connection and permissions.");
        return;
    }
    if (!snapshot.exists()) {
        failWithTitle("Pull Request Not Found", `No pull request exists with ID ${pullRequestId}.`);
        return;
    }

    currentPR = { ...snapshot.data(), id: snapshot.id };

    prTitle.textContent = currentPR.title || "Untitled Pull Request";
    prMeta.textContent = `Reviewing pull request ${currentPR.number ? "#" + currentPR.number : currentPR.id}`;
    $("prNumber").textContent = currentPR.number ? `#${currentPR.number}` : currentPR.id;
    $("repository").textContent = currentPR.repository || "Not specified";
    $("prStatus").textContent = normalizeStatus(currentPR.status);
    $("developerName").textContent = currentPR.authorName || "Unknown Developer";
    $("prDescription").textContent = currentPR.description || "";
    $("prChips").innerHTML = [priorityBadge(currentPR.priority), dueText(currentPR) ? `<span class="chip">${escapeHTML(dueText(currentPR))}</span>` : "", demoChip(currentPR)].join("");

    const url = String(currentPR.githubUrl || "").trim();
    if (isValidGitHubPullUrl(url)) {
        githubButton.href = url;
    } else {
        githubButton.removeAttribute("href");
        githubButton.addEventListener("click", (event) => {
            event.preventDefault();
            showMessage("No valid GitHub pull request URL is stored for this PR. Ask the Team Lead or developer to correct it.", "error");
        });
    }

    if (currentPR.reviewerId !== session.user.uid) {
        lockForm("You are not the reviewer assigned to this pull request.");
    } else if (!isPending(currentPR)) {
        lockForm(
            `This pull request is already <strong>${escapeHTML(normalizeStatus(currentPR.status))}</strong>. ` +
            "It can be reviewed again after the developer requests a re-review or the Team Lead reopens it." + NAV_LINKS,
            "info"
        );
    }
    loadGitHubDetails(url);
}

/* ---------- Submit the review ---------- */

function codeError(code, extra) {
    const error = new Error(code);
    error.code = code;
    error.extra = extra;
    return error;
}

async function submitReview(decision) {
    if (isSubmitting || formLocked) return;
    if (!currentPR) { showMessage("Pull request details have not loaded yet.", "error"); return; }

    const feedbackText = feedback.value.trim();
    const ratings = readRatings();
    const rated = Object.keys(ratings);

    if (!feedbackText) { showMessage("Please enter your review feedback first.", "error"); feedback.focus(); return; }
    if (!rated.length) { showMessage("Please rate at least one category (1–5).", "error"); return; }

    isSubmitting = true;
    setFormDisabled(true);

    const prRef = doc(db, "pullRequests", pullRequestId);
    const reviewRef = doc(collection(db, "reviews"));
    const primary = rated[0];

    try {
        /* One atomic transaction: re-check the PR, save the review, update the status. */
        await runTransaction(db, async (tx) => {
            const fresh = await tx.get(prRef);
            if (!fresh.exists()) throw codeError("pr-missing");
            const pr = fresh.data();
            if (pr.reviewerId !== session.user.uid) throw codeError("not-assigned");
            if (!isPending(pr)) throw codeError("not-pending", normalizeStatus(pr.status));

            tx.set(reviewRef, {
                pullRequestId,
                pullRequestTitle: pr.title || "",
                pullRequestNumber: pr.number ?? null,
                repository: pr.repository ?? null,
                githubUrl: pr.githubUrl ?? null,
                authorId: pr.authorId ?? null,
                authorName: pr.authorName ?? null,
                reviewerId: session.user.uid,
                reviewerName: displayNameOf(session.profile, session.user),
                category: primary,
                rating: ratings[primary],
                ratings,
                feedback: feedbackText,
                status: decision,
                createdAt: serverTimestamp()
            });

            /* lastReviewId lets the Security Rules require that a decision always comes with its review. */
            tx.update(prRef, { status: decision, lastReviewId: reviewRef.id, lastReviewedAt: serverTimestamp(), updatedAt: serverTimestamp() });
        });

        currentPR.status = decision;
        $("prStatus").textContent = decision;
        feedback.value = "";

        lockForm(
            (decision === STATUS.APPROVED ? "Review submitted. Pull request approved in this app." : "Review submitted. Changes requested in this app.") +
            " (This does not change the pull request on GitHub.)" + NAV_LINKS,
            "success"
        );
        showToast("Review saved.", "success");

        if (!currentPR.authorId) {
            showToast("This PR has no developer linked, so the developer cannot see this feedback yet. Ask the Team Lead to set the developer.", "error");
        }
    } catch (error) {
        console.error("Error submitting review:", error);

        if (error.code === "not-pending") {
            lockForm(`This pull request was already <strong>${escapeHTML(error.extra)}</strong>, so nothing was saved.` + NAV_LINKS, "info");
        } else if (error.code === "not-assigned") {
            lockForm("You are not the reviewer assigned to this pull request.", "error");
        } else if (error.code === "pr-missing") {
            lockForm("This pull request no longer exists.", "error");
        } else if (error.code === "permission-denied") {
            showMessage("Firestore denied this action. Your account may not be allowed to review this pull request.", "error");
            setFormDisabled(false);
        } else {
            showMessage("Unable to submit your review. Check your connection and try again.", "error");
            setFormDisabled(false);
        }
    } finally {
        isSubmitting = false;
    }
}

approveButton.addEventListener("click", () => submitReview(STATUS.APPROVED));
changesButton.addEventListener("click", () => submitReview(STATUS.CHANGES));

session = await requireRole([ROLES.REVIEWER]);
await loadPullRequest();
