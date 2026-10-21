/* Firestore actions on pull requests shared by Developer and Team Lead pages. */

import {
    collection,
    addDoc,
    doc,
    updateDoc,
    writeBatch,
    serverTimestamp,
    Timestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

import { db } from "./firebase-config.js";
import { parsePullUrl, fetchPullDetails } from "./github.js";
import { STATUS, showToast, escapeHTML } from "./common.js";

export const PRIORITIES = ["High", "Medium", "Low"];

/* The "add a pull request" form, shared by Developer and Team Lead. */
export function prFormHTML({ team = false } = {}) {
    return `
    <form id="prForm" class="stack" novalidate>
        <p class="muted small">
            Paste the GitHub pull request link. The number and repository come from the link.
            "Import from GitHub" fills the title and description for public repositories only;
            for private repositories type them in yourself.
        </p>
        <div class="form-row">
            <div class="field">
                <label for="newPrUrl">GitHub pull request URL</label>
                <input class="input" id="newPrUrl" type="url" required placeholder="https://github.com/owner/repo/pull/12">
            </div>
            <div class="field" style="flex:0 0 auto;align-self:end">
                <button type="button" class="btn" id="newPrFetch">Import from GitHub</button>
            </div>
        </div>
        <div class="field">
            <label for="newPrTitle">Title</label>
            <input class="input" id="newPrTitle" type="text" maxlength="200" required>
        </div>
        <div class="field">
            <label for="newPrDesc">Description (optional)</label>
            <textarea class="textarea" id="newPrDesc" maxlength="2000" style="min-height:80px"></textarea>
        </div>
        <div class="form-row">
            ${team ? `<div class="field"><label for="newPrAuthor">Developer</label><select class="select" id="newPrAuthor"></select></div>` : ""}
            <div class="field"><label for="newPrPriority">Priority</label>
                <select class="select" id="newPrPriority">
                    ${PRIORITIES.map((p) => `<option value="${p}" ${p === "Medium" ? "selected" : ""}>${p}</option>`).join("")}
                </select></div>
            <div class="field"><label for="newPrDue">Review due date (optional)</label>
                <input class="input" id="newPrDue" type="date"></div>
        </div>
        <div class="row">
            <button type="submit" class="btn primary" id="newPrSubmit">Add pull request</button>
            <button type="button" class="btn ghost" data-close-dialog>Cancel</button>
        </div>
        <p class="form-msg" id="newPrMessage" aria-live="polite"></p>
    </form>`;
}

export function validatePrInput(input) {
    const errors = [];
    const githubUrl = String(input.githubUrl ?? "").trim();
    const parsed = parsePullUrl(githubUrl);
    const title = String(input.title ?? "").trim();
    const description = String(input.description ?? "").trim();
    const priority = PRIORITIES.includes(input.priority) ? input.priority : "Medium";

    if (!parsed) {
        errors.push("Enter a valid GitHub pull request URL, e.g. https://github.com/owner/repo/pull/12");
    }
    if (!title) errors.push("A title is required.");
    if (title.length > 200) errors.push("The title is too long (200 characters maximum).");
    if (description.length > 2000) errors.push("The description is too long (2000 characters maximum).");

    let dueMs = null;
    if (input.dueDate) {
        const d = new Date(`${input.dueDate}T23:59:59`);
        if (Number.isNaN(d.getTime())) errors.push("The due date is not valid.");
        else if (d.getTime() < Date.now() - 86_400_000) errors.push("The due date cannot be in the past.");
        else dueMs = d.getTime();
    }

    return {
        ok: errors.length === 0,
        errors,
        value: {
            githubUrl,
            title,
            description,
            priority,
            dueMs,
            number: parsed ? parsed.number : null,
            repository: parsed ? `${parsed.owner}/${parsed.repo}` : "",
            repositoryUrl: parsed ? `https://github.com/${parsed.owner}/${parsed.repo}` : ""
        }
    };
}

export async function addPullRequest({ value, author, source = "manual" }) {
    const ref = await addDoc(collection(db, "pullRequests"), {
        title: value.title,
        description: value.description || "",
        number: value.number,
        repository: value.repository,
        repositoryUrl: value.repositoryUrl,
        githubUrl: value.githubUrl,
        status: STATUS.OPEN,
        priority: value.priority || "Medium",
        dueDate: value.dueMs ? Timestamp.fromMillis(value.dueMs) : null,
        authorId: author.id,
        authorName: author.name,
        reviewerId: null,
        reviewerName: null,
        source,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });
    return ref.id;
}

export async function requestReReview(prId) {
    await updateDoc(doc(db, "pullRequests", prId), {
        status: STATUS.IN_REVIEW,
        updatedAt: serverTimestamp()
    });
}

export async function reopenPullRequest(prId) {
    await updateDoc(doc(db, "pullRequests", prId), {
        status: STATUS.OPEN,
        updatedAt: serverTimestamp()
    });
}

/* Team Lead: set reviewer and/or developer of a PR. */
export async function assignPullRequest(prId, { reviewer, author, assignedNow }) {
    const patch = { updatedAt: serverTimestamp() };

    if (reviewer !== undefined) {
        patch.reviewerId = reviewer ? reviewer.id : null;
        patch.reviewerName = reviewer ? reviewer.name : null;
        if (reviewer && assignedNow) patch.assignedAt = serverTimestamp();
    }
    if (author) {
        patch.authorId = author.id;
        patch.authorName = author.name;
    }
    await updateDoc(doc(db, "pullRequests", prId), patch);
}

/*
 * Older reviews were saved without authorId, so developers cannot read them.
 * This copies authorId from the PR onto those reviews (Team Lead only).
 */
export async function linkLegacyReviews(reviews, prsById) {
    const targets = reviews.filter(
        (r) => !r.authorId && prsById.get(r.pullRequestId) && prsById.get(r.pullRequestId).authorId
    );

    /* The rules look up each review's pull request, so keep batches small (rules allow 20 lookups per request). */
    const BATCH = 10;
    for (let i = 0; i < targets.length; i += BATCH) {
        const batch = writeBatch(db);
        targets.slice(i, i + BATCH).forEach((r) => {
            batch.update(doc(db, "reviews", r.id), {
                authorId: prsById.get(r.pullRequestId).authorId
            });
        });
        await batch.commit();
    }
    return targets.length;
}

export function openDialog(dialog) {
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
}
export function closeDialog(dialog) {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
}

/*
 * Wire the shared "Add pull request" form (markup from prFormHTML()).
 */
export function bindPrForm({ form, getAuthor, existingUrls, onCreated }) {
    const $ = (id) => form.querySelector(`#${id}`);
    const url = $("newPrUrl");
    const title = $("newPrTitle");
    const desc = $("newPrDesc");
    const fetchBtn = $("newPrFetch");
    const submit = $("newPrSubmit");
    const message = $("newPrMessage");
    let imported = false;

    const say = (text, type) => {
        message.textContent = text;
        message.className = `form-msg ${type}`;
    };

    fetchBtn.addEventListener("click", async () => {
        say("Contacting GitHub...", "info");
        const result = await fetchPullDetails(url.value);
        if (!result.ok) {
            say(`${result.message} You can still type the title yourself.`, "error");
            return;
        }
        title.value = result.data.title || title.value;
        if (result.data.body && !desc.value) desc.value = result.data.body.slice(0, 1000);
        imported = true;
        say(`Imported from GitHub: ${result.data.repository} #${result.data.number} (${result.data.state}).`, "success");
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (submit.disabled) return;

        const checked = validatePrInput({
            githubUrl: url.value,
            title: title.value,
            description: desc.value,
            priority: $("newPrPriority").value,
            dueDate: $("newPrDue").value
        });
        if (!checked.ok) {
            say(checked.errors.join(" "), "error");
            return;
        }

        const author = getAuthor();
        if (!author || !author.id) {
            say("Choose the developer who owns this pull request.", "error");
            return;
        }
        if (existingUrls().has(checked.value.githubUrl.replace(/\/$/, "").toLowerCase())) {
            say("This pull request has already been added.", "error");
            return;
        }

        submit.disabled = true;
        try {
            const id = await addPullRequest({ value: checked.value, author, source: imported ? "github" : "manual" });
            say("Pull request added.", "success");
            showToast("Pull request added.", "success");
            form.reset();
            imported = false;
            await onCreated(id);
        } catch (error) {
            console.error("Unable to add pull request:", error);
            say("Unable to add the pull request. Check your permissions and try again.", "error");
        } finally {
            submit.disabled = false;
        }
    });
}
