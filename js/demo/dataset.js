/* =====================================================================
   Demonstration dataset - the ONE source of truth used by
     1. Demo Mode (browser, local only, never touches Firebase)
     2. scripts/seed-firebase.mjs (explicit, confirmed, idempotent)

   Pure data, no imports. Timestamps are markers { __ts: epochMillis }
   so each consumer can turn them into its own Timestamp type.
   Everything is relative to `nowMs`, so the demo always looks current.
===================================================================== */

export const DEMO_NAMESPACE = "pcrt-demo-v1";
const DAY = 86_400_000;
const HOUR = 3_600_000;
const ts = (ms) => ({ __ts: Math.round(ms) });

export const DEMO_USERS = [
    { key: "rahul",    name: "Rahul Kumar",     email: "rahul.developer@example.com",    role: "Developer" },
    { key: "priya",    name: "Priya Sharma",    email: "priya.developer@example.com",    role: "Developer" },
    { key: "arjun",    name: "Arjun Patel",     email: "arjun.developer@example.com",    role: "Developer" },
    { key: "arun",     name: "Arun Kumar",      email: "arun.reviewer@example.com",      role: "Reviewer" },
    { key: "sneha",    name: "Sneha Reddy",     email: "sneha.reviewer@example.com",     role: "Reviewer" },
    { key: "karthik",  name: "Karthik Raj",     email: "karthik.reviewer@example.com",   role: "Reviewer" },
    { key: "meera",    name: "Meera Krishnan",  email: "meera.lead@example.com",         role: "Team Lead" }
];

const WEB = "https://github.com/demo-org/web-app";
const API = "https://github.com/demo-org/api-service";
const DOCS = "https://github.com/demo-org/docs-site";

/*
 * Pull requests. Status values are the app's canonical ones:
 * Open | In Review | Changes Requested | Approved | Merged
 * (Open = waiting for review; Open + In Review = "pending").
 * ago = days since created; due = days from now (negative = overdue).
 */
const PRS = [
    { n: 1,  repo: WEB,  num: 142, title: "Improve authentication flow", author: "rahul", reviewer: "arun", status: "Approved", ago: 52, prio: "Medium",
      desc: "Splits token refresh from login, adds session expiry handling and clearer error states when credentials are rejected." },
    { n: 2,  repo: WEB,  num: 148, title: "Add input validation to registration form", author: "priya", reviewer: "sneha", status: "Approved", ago: 45, prio: "Medium",
      desc: "Validates email format, password strength and required fields on the client before the request is sent." },
    { n: 3,  repo: WEB,  num: 153, title: "Optimize dashboard loading performance", author: "arjun", reviewer: "karthik", status: "Changes Requested", ago: 30, prio: "High",
      desc: "Lazy-loads chart bundles and batches the three dashboard queries into one round trip." },
    { n: 4,  repo: WEB,  num: 156, title: "Add unit tests for user registration", author: "rahul", reviewer: "sneha", status: "Approved", ago: 36, prio: "Medium",
      desc: "Covers success, duplicate email, weak password and network failure paths with Jest." },
    { n: 5,  repo: API,  num: 61,  title: "Improve error handling in API requests", author: "priya", reviewer: "arun", status: "Changes Requested", ago: 20, prio: "High",
      desc: "Introduces a typed ApiError, retries idempotent GETs and surfaces readable messages to the UI." },
    { n: 6,  repo: WEB,  num: 160, title: "Fix responsive navigation on mobile", author: "arjun", reviewer: "sneha", status: "Approved", ago: 28, prio: "Medium",
      desc: "Replaces the fixed sidebar with a collapsible drawer below 900px and fixes focus trapping." },
    { n: 7,  repo: API,  num: 64,  title: "Improve password reset workflow", author: "rahul", reviewer: "karthik", status: "In Review", ago: 6, prio: "High", due: 2,
      desc: "One-time reset tokens with a 15 minute expiry and rate limiting on reset requests." },
    { n: 8,  repo: DOCS, num: 12,  title: "Add documentation for authentication module", author: "priya", reviewer: "arun", status: "Open", ago: 3, prio: "Low", due: 5,
      desc: "Documents the login, refresh and logout flows with sequence diagrams and troubleshooting notes." },
    { n: 9,  repo: API,  num: 66,  title: "Refactor duplicate validation logic", author: "arjun", reviewer: "arun", status: "Open", ago: 4, prio: "Medium", due: -1,
      desc: "Extracts four copies of the same validators into a shared module with table-driven tests." },
    { n: 10, repo: WEB,  num: 165, title: "Fix pull request status display", author: "rahul", reviewer: "sneha", status: "Approved", ago: 14, prio: "Medium",
      desc: "Status badges now reflect the latest review decision and no longer flash stale values." },
    { n: 11, repo: API,  num: 68,  title: "Improve Firestore query efficiency", author: "priya", reviewer: "karthik", status: "Open", ago: 2, prio: "High", due: 3,
      desc: "Replaces three client-side filters with indexed where() clauses and removes an N+1 read." },
    { n: 12, repo: WEB,  num: 170, title: "Add accessibility improvements to forms", author: "arjun", reviewer: "sneha", status: "In Review", ago: 5, prio: "Medium", due: 1,
      desc: "Associates labels with inputs, announces validation errors to screen readers and fixes tab order." },
    { n: 13, repo: WEB,  num: 172, title: "Add loading states to dashboards", author: "rahul", reviewer: "arun", status: "Open", ago: 1, prio: "Low",
      desc: "Skeleton placeholders while data loads and a retry button when a request fails." },
    { n: 14, repo: API,  num: 59,  title: "Secure session handling", author: "priya", reviewer: "karthik", status: "Approved", ago: 40, prio: "High",
      desc: "HttpOnly cookies, rotation on privilege change and logout invalidation across devices." },
    { n: 15, repo: WEB,  num: 138, title: "Introduce CSS variables for theming", author: "arjun", reviewer: "karthik", status: "Approved", ago: 48, prio: "Low",
      desc: "Moves colours and spacing to custom properties so a dark theme can be added later." }
];

/*
 * Reviews. ago = days since the review was submitted (must be < the PR's age).
 * ratings use the same 1-5 scale; only categories the reviewer assessed appear.
 */
const REVIEWS = [
    { n: 1,  pr: 1,  by: "arun",    ago: 50, status: "Approved",
      ratings: { "Code Quality": 3, "Readability": 3, "Security": 2, "Testing": 3 },
      text: "Token refresh is cleanly separated, nice. Please validate the redirect target after login and add tests for the expired-session path before this ships." },
    { n: 2,  pr: 2,  by: "sneha",   ago: 43, status: "Changes Requested",
      ratings: { "Code Quality": 3, "Readability": 4, "Testing": 2, "Documentation": 3 },
      text: "Validation rules read well. The password rule rejects valid unicode characters, and none of the new branches have tests. Please cover those and add a short note on the rules to the README." },
    { n: 3,  pr: 2,  by: "sneha",   ago: 40, status: "Approved",
      ratings: { "Code Quality": 4, "Readability": 4, "Testing": 4 },
      text: "Unicode handling fixed and the table-driven tests are easy to extend. Approving." },
    { n: 4,  pr: 4,  by: "sneha",   ago: 33, status: "Approved",
      ratings: { "Testing": 4, "Code Quality": 4, "Documentation": 3 },
      text: "Good coverage of the failure paths. Consider naming tests after behaviour rather than function names. Approved." },
    { n: 5,  pr: 14, by: "karthik", ago: 37, status: "Approved",
      ratings: { "Security": 4, "Code Quality": 4, "Performance": 3 },
      text: "Cookie flags and rotation look correct. The session lookup runs on every request; a short-lived cache would help later. Approved." },
    { n: 6,  pr: 15, by: "karthik", ago: 46, status: "Approved",
      ratings: { "Code Quality": 3, "Readability": 2, "Performance": 3 },
      text: "The variables help, but several names (--c1, --c2) are not descriptive. Please rename them before extending the theme." },
    { n: 7,  pr: 6,  by: "sneha",   ago: 25, status: "Approved",
      ratings: { "Readability": 4, "Code Quality": 4, "Performance": 4, "Documentation": 3 },
      text: "The drawer behaves well with a keyboard and on small screens. Please add a short comment explaining the 900px breakpoint choice." },
    { n: 8,  pr: 3,  by: "karthik", ago: 24, status: "Changes Requested",
      ratings: { "Performance": 2, "Code Quality": 3, "Testing": 2 },
      text: "Batching the queries is the right idea, but the lazy-loaded bundle is still imported eagerly in main.js, so there is no real saving. Please measure before and after and add a regression check." },
    { n: 9,  pr: 5,  by: "arun",    ago: 17, status: "Changes Requested",
      ratings: { "Code Quality": 4, "Security": 3, "Testing": 2, "Readability": 3 },
      text: "ApiError is a good abstraction. Error messages currently echo server text to the UI, which can leak internals. Please map to safe messages and add tests for the retry logic." },
    { n: 10, pr: 10, by: "sneha",   ago: 11, status: "Approved",
      ratings: { "Code Quality": 5, "Readability": 4, "Testing": 4 },
      text: "Clear, focused change with a regression test for the stale badge. Great improvement." }
];

export function buildDemoDataset(nowMs = Date.now(), { uidByEmail = {} } = {}) {
    const flags = { demo: true, demoNamespace: DEMO_NAMESPACE };

    const users = DEMO_USERS.map((u) => ({
        id: uidByEmail[u.email] || `demo-${u.key}`,
        data: {
            uid: uidByEmail[u.email] || `demo-${u.key}`,
            name: u.name, email: u.email, role: u.role,
            createdAt: ts(nowMs - 60 * DAY), ...flags
        }
    }));
    const byKey = Object.fromEntries(DEMO_USERS.map((u, i) => [u.key, users[i]]));
    const nm = (k) => byKey[k].data.name;
    const id = (k) => byKey[k].id;

    const prsById = {};
    const pullRequests = PRS.map((p) => {
        const created = nowMs - p.ago * DAY - 3 * HOUR;
        const assigned = created + HOUR;
        const docId = `demo_pr_${String(p.n).padStart(2, "0")}`;
        const reviewsFor = REVIEWS.filter((r) => r.pr === p.n);
        const lastReview = reviewsFor.length
            ? Math.max(...reviewsFor.map((r) => nowMs - r.ago * DAY - 2 * HOUR))
            : null;
        const data = {
            title: p.title, number: p.num, repository: p.repo.replace("https://github.com/", ""),
            repositoryUrl: p.repo, githubUrl: `${p.repo}/pull/${p.num}`, description: p.desc,
            status: p.status, priority: p.prio,
            dueDate: p.due === undefined ? null : ts(nowMs + p.due * DAY),
            authorId: id(p.author), authorName: nm(p.author),
            reviewerId: id(p.reviewer), reviewerName: nm(p.reviewer),
            createdAt: ts(created), assignedAt: ts(assigned),
            lastReviewedAt: lastReview ? ts(lastReview) : null,
            updatedAt: ts(lastReview || assigned), source: "demo", ...flags
        };
        prsById[p.n] = { docId, data, authorKey: p.author };
        return { id: docId, data };
    });

    const reviews = REVIEWS.map((r) => {
        const pr = prsById[r.pr];
        const [primary, primaryRating] = Object.entries(r.ratings)[0];
        return {
            id: `demo_rv_${String(r.n).padStart(2, "0")}`,
            data: {
                pullRequestId: pr.docId, pullRequestTitle: pr.data.title, pullRequestNumber: pr.data.number,
                repository: pr.data.repository, githubUrl: pr.data.githubUrl, authorId: pr.data.authorId, authorName: pr.data.authorName,
                reviewerId: id(r.by), reviewerName: nm(r.by),
                category: primary, rating: primaryRating, ratings: r.ratings,
                feedback: r.text, status: r.status,
                createdAt: ts(nowMs - r.ago * DAY - 2 * HOUR), ...flags
            }
        };
    });

    return { users, pullRequests, reviews };
}

/* Convert {__ts} markers using a factory (browser Timestamp, admin Timestamp ...). */
export function reviveTimestamps(value, make) {
    if (Array.isArray(value)) return value.map((v) => reviveTimestamps(v, make));
    if (value && typeof value === "object") {
        if (Object.keys(value).length === 1 && "__ts" in value) return make(value.__ts);
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, reviveTimestamps(v, make)]));
    }
    return value;
}
