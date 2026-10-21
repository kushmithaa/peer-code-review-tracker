/*
 * Pure checks: would the CURRENT firestore.rules cope with the data that already exists?
 * No Firebase imports, no writes. Used by scripts/audit-schema.mjs (read-only CLI) and by tests.
 *
 * Findings:
 *   blocker  - an operation the app needs will be DENIED or the record is unusable
 *   warning  - part of the app will not work for this record, or reads may fail
 *   info     - expected for older data; explained, nothing to fix
 */
const STATUSES = ["Open", "In Review", "Changes Requested", "Approved", "Merged"];
const PRIORITIES = ["High", "Medium", "Low"];
const CATEGORIES = ["Code Quality", "Readability", "Performance", "Security", "Testing", "Documentation"];
const ROLE_OK = ["Developer", "Reviewer", "Team Lead", "Team"];

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isPending = (s) => s === "Open" || s === "In Review";

export function auditDataset({ users = [], pullRequests = [], reviews = [] }) {
    const findings = [];
    const add = (severity, collection, id, code, message) => findings.push({ severity, collection, id, code, message });
    const userById = new Map(users.map((u) => [u.id, u]));

    /* ------------------------------ users ------------------------------ */
    for (const u of users) {
        const d = u.data;
        if (!ROLE_OK.includes(d.role)) add("blocker", "users", u.id, "role-invalid", `role is ${JSON.stringify(d.role)}; login is impossible and every rule treats this user as having no role`);
        else if (d.role === "Team") add("info", "users", u.id, "role-legacy-team", 'role "Team" is the legacy value for Team Lead and is still accepted');
        if (typeof d.name !== "string" || !d.name.trim()) {
            if (d.role === "Reviewer") add("blocker", "users", u.id, "name-missing", "a Reviewer without a profile name cannot submit reviews (reviewerName must equal the profile name)");
            else if (d.role === "Developer") add("warning", "users", u.id, "name-missing", "a Developer without a profile name cannot add pull requests (authorName must equal the profile name)");
        }
        if (!d.email) add("info", "users", u.id, "email-missing", "no email stored on the profile");
    }

    /* ------------------------- pull requests ------------------------- */
    const prById = new Map(pullRequests.map((p) => [p.id, p]));
    for (const p of pullRequests) {
        const d = p.data;
        if (!has(d, "status")) add("warning", "pullRequests", p.id, "status-missing", "no status: reviewers cannot review it (rules need Open/In Review). The Team Lead can fix it with Reopen");
        else if (!STATUSES.includes(d.status)) add("warning", "pullRequests", p.id, "status-noncanonical", `status ${JSON.stringify(d.status)} is not one of ${STATUSES.join(" / ")}; reviewers cannot review it. Team Lead: Reopen`);
        if (has(d, "priority") && !PRIORITIES.includes(d.priority)) add("blocker", "pullRequests", p.id, "priority-invalid", `priority ${JSON.stringify(d.priority)} is invalid: any Team Lead update of this PR will be denied`);
        if (!has(d, "authorId")) add("warning", "pullRequests", p.id, "authorId-missing", "no authorId field: the developer cannot see it and the read rule may error. Team Lead: set the developer");
        else if (d.authorId && !userById.has(d.authorId)) add("warning", "pullRequests", p.id, "author-unknown", `authorId ${d.authorId} has no user profile`);
        else if (d.authorId && userById.get(d.authorId).data.role !== "Developer") add("warning", "pullRequests", p.id, "author-not-developer", "authorId belongs to a user who is not a Developer; a Team Lead cannot re-save this assignment");
        if (!has(d, "reviewerId")) add("warning", "pullRequests", p.id, "reviewerId-missing", "no reviewerId field (should be null when unassigned): the read rule may error for the author");
        else if (d.reviewerId) {
            const r = userById.get(d.reviewerId);
            if (!r) add("warning", "pullRequests", p.id, "reviewer-unknown", `reviewerId ${d.reviewerId} has no user profile`);
            else if (r.data.role !== "Reviewer") add("warning", "pullRequests", p.id, "reviewer-not-reviewer", "reviewerId belongs to a user who is not a Reviewer; they cannot submit reviews");
            if (d.reviewerId === d.authorId) add("warning", "pullRequests", p.id, "self-review", "reviewer and author are the same person; reviews on this PR are denied");
        } else if (has(d, "status") && isPending(d.status)) add("info", "pullRequests", p.id, "unassigned", "pending but no reviewer assigned");
        if (typeof d.title !== "string" || !d.title.trim()) add("warning", "pullRequests", p.id, "title-missing", "no title");
        if (d.githubUrl !== undefined && d.githubUrl !== null && !/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/[0-9]+\/?$/.test(String(d.githubUrl))) add("info", "pullRequests", p.id, "url-nonstandard", "githubUrl is not a standard pull request URL (the app shows 'No GitHub link'); rules only check URLs when a PR is created");
        if (has(d, "number") && !Number.isInteger(d.number)) add("info", "pullRequests", p.id, "number-not-int", "number is not an integer");
    }

    /* ----------------------------- reviews ----------------------------- */
    for (const r of reviews) {
        const d = r.data;
        const pr = prById.get(d.pullRequestId);
        if (!pr) add("warning", "reviews", r.id, "pr-missing", `refers to pull request ${JSON.stringify(d.pullRequestId)} that does not exist`);
        if (!d.authorId) {
            if (pr && pr.data.authorId) add("info", "reviews", r.id, "authorId-missing-fixable", "no authorId (older review): the developer cannot see it. Team Lead: Manage -> Link legacy reviews");
            else add("warning", "reviews", r.id, "authorId-missing-blocked", "no authorId and its pull request has no developer either: set the developer on the PR first, then Link legacy reviews");
        } else if (pr && pr.data.authorId && pr.data.authorId !== d.authorId) add("warning", "reviews", r.id, "author-mismatch", "authorId differs from the pull request's current developer");
        if (!has(d, "ratings")) {
            if (d.rating === undefined || d.rating === null) add("info", "reviews", r.id, "unrated", "older review without ratings: displayed, but never counted in skill scores");
            else add("info", "reviews", r.id, "single-rating", "older single category/rating review: still counted in skill scores");
        } else if (!d.ratings || typeof d.ratings !== "object" || !Object.keys(d.ratings).length) add("warning", "reviews", r.id, "ratings-empty", "ratings is empty");
        else for (const [k, v] of Object.entries(d.ratings)) {
            if (!CATEGORIES.includes(k)) add("warning", "reviews", r.id, "ratings-unknown-category", `unknown category ${JSON.stringify(k)}`);
            if (!Number.isInteger(v) || v < 1 || v > 5) add("warning", "reviews", r.id, "ratings-out-of-range", `${k} rating ${JSON.stringify(v)} is not an integer 1-5; ignored in skill scores`);
        }
        if (!d.reviewerId || !userById.has(d.reviewerId)) add("info", "reviews", r.id, "reviewer-unknown", "reviewer has no user profile");
    }

    const count = (sev) => findings.filter((f) => f.severity === sev).length;
    const byCode = {};
    findings.forEach((f) => { byCode[f.code] = (byCode[f.code] || 0) + 1; });
    return {
        counts: { users: users.length, pullRequests: pullRequests.length, reviews: reviews.length },
        blockers: count("blocker"), warnings: count("warning"), info: count("info"), byCode, findings
    };
}
