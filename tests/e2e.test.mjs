import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
await import("../js/demo/firebase-firestore.js");
await import("../js/demo/firebase-auth.js");
const H = await import("./helpers.mjs");
const { openPage, resetFirebase, seed, addAccount, login, get, all, fakeDb, fakeAuth, click, setValue, settle } = H;

const GH = "https://github.com/kushmithaa/peer-code-review-tracker/pull/1";

function world() {
  resetFirebase();
  addAccount("dev1", "dev@x.com", "Developer", "Kushmitha N");
  addAccount("rev1", "arun.review@example.com", "Reviewer", "Arun");
  addAccount("rev2", "bala@x.com", "Reviewer", "Bala");
  addAccount("lead1", "lead@x.com", "Team", "Lead Person");           // legacy role value "Team"
  seed("pullRequests", "PR-001", { title: "Improve authentication flow", number: 142, repository: "peer-code-review",
    status: "Approved", authorName: "Kushmitha N", reviewerId: "rev1", githubUrl: GH });                 // legacy: no authorId
  seed("pullRequests", "PR-002", { title: "Add logging", number: 7, repository: "peer-code-review", status: "Open",
    authorId: "dev1", authorName: "Kushmitha N", reviewerId: "rev1", reviewerName: "Arun", githubUrl: "https://github.com/o/r/pull/7",
    createdAt: "2026-10-01T00:00:00.000Z" });
  seed("pullRequests", "PR-003", { title: "Unassigned work", number: 8, repository: "peer-code-review", status: "Open",
    authorId: "dev1", authorName: "Kushmitha N", reviewerId: null, githubUrl: "https://github.com/o/r/pull/8" });
  seed("reviews", "R-old", { pullRequestId: "PR-001", pullRequestTitle: "Improve authentication flow", reviewerId: "rev1",
    reviewerName: "arun.review@example.com", category: "Code Quality", feedback: "The authentication flow is implemented clearly.",
    status: "Approved", createdAt: { toMillis: () => Date.UTC(2026, 8, 20), toDate: () => new Date(Date.UTC(2026, 8, 20)) } });
}
beforeEach(world);

const rate = (page, category, value) => {
  const slug = category.toLowerCase().replace(/\s+/g, "-");
  const input = page.$(`input[name="rating-${slug}"][value="${value}"]`);
  input.checked = true; input.dispatchEvent(new page.dom.window.Event("change", { bubbles: true }));
};
const text = (page, sel) => page.$(sel).textContent.replace(/\s+/g, " ").trim();

/* ---------------- ROUTE GUARDS ---------------- */
test("logged-out user is sent to login", async () => {
  const p = await openPage("pages/reviewer-dashboard.html");
  assert.deepEqual(p.nav, ["../index.html"]);
});
test("account without role record is signed out and sent to login with error", async () => {
  fakeAuth().currentUser = { uid: "ghost", email: "g@x.com" };
  const p = await openPage("pages/reviewer-dashboard.html");
  assert.deepEqual(p.nav, ["../index.html?error=norole"]);
  assert.equal(fakeAuth().currentUser, null);
});
test("wrong role is redirected to own dashboard (all 6 combos)", async () => {
  const cases = [
    ["dev1", "dev@x.com", "pages/reviewer-dashboard.html", "developer-dashboard.html"],
    ["dev1", "dev@x.com", "pages/team-dashboard.html", "developer-dashboard.html"],
    ["rev1", "arun.review@example.com", "pages/developer-dashboard.html", "reviewer-dashboard.html"],
    ["rev1", "arun.review@example.com", "pages/team-dashboard.html", "reviewer-dashboard.html"],
    ["lead1", "lead@x.com", "pages/reviewer-dashboard.html", "team-dashboard.html"],
    ["lead1", "lead@x.com", "pages/developer-dashboard.html", "team-dashboard.html"],
  ];
  for (const [uid, email, page, expected] of cases) {
    world(); login(uid, email);
    const p = await openPage(page);
    assert.deepEqual(p.nav, [expected], `${uid} on ${page}`);
  }
});
test("review page and history page are Reviewer-only", async () => {
  login("dev1", "dev@x.com");
  for (const page of ["pages/review-pr.html", "pages/review-history.html", "pages/pending-reviews.html", "pages/assigned-prs.html", "pages/skill-growth.html"]) {
    const p = await openPage(page, { search: "?id=PR-002" });
    assert.deepEqual(p.nav, ["developer-dashboard.html"], page);
  }
});

/* ---------------- REVIEWER DASHBOARD / PENDING ---------------- */
test("reviewer dashboard: real counts, pending list is populated (the 'Waiting for Firebase' bug)", async () => {
  login("rev1", "arun.review@example.com");
  const p = await openPage("pages/reviewer-dashboard.html");
  assert.equal(text(p, "#assignedPRCount"), "2");
  assert.equal(text(p, "#pendingReviewCount"), "1");           // PR-002 only; PR-001 is Approved
  assert.equal(text(p, "#completedReviewCount"), "1");
  assert.equal(text(p, "#pendingBig"), "1");
  assert.match(text(p, "#greeting"), /Good (morning|afternoon|evening), Arun/);
  const pending = p.$("#pendingReviewList");
  assert.match(pending.textContent, /Add logging/);
  assert.doesNotMatch(pending.textContent, /Improve authentication/);
  assert.doesNotMatch(p.document.body.textContent, /Waiting for Firebase/);
  assert.equal(pending.querySelector("a.btn.primary").getAttribute("href"), "review-pr.html?id=PR-002");
  assert.doesNotMatch(p.$("#growthSummary").textContent, /10%/);
  assert.match(p.$("#historyPreview").textContent, /authentication flow is implemented clearly/);
  assert.deepEqual(p.errors, []);
});
test("pending page shows only pending PRs, search works, empty state otherwise", async () => {
  login("rev1", "arun.review@example.com");
  const p = await openPage("pages/pending-reviews.html");
  assert.equal(text(p, "#pendingTotal"), "1");
  assert.equal(p.$$("#pendingList .item").length, 1);
  setValue(p.$("#searchPending"), "zzz");
  assert.match(p.$("#pendingList").textContent, /No matches/);
  setValue(p.$("#searchPending"), "logging");
  assert.equal(p.$$("#pendingList .item").length, 1);
  // reviewer with nothing pending
  login("rev2", "bala@x.com");
  const q = await openPage("pages/pending-reviews.html");
  assert.match(q.$("#pendingList").textContent, /all caught up/);
  assert.equal(text(q, "#pendingTotal"), "0");
});
test("assigned PRs: lists both, filter by status, links carry the PR id", async () => {
  login("rev1", "arun.review@example.com");
  const p = await openPage("pages/assigned-prs.html");
  assert.equal(text(p, "#totalAssigned"), "2"); assert.equal(text(p, "#totalPending"), "1"); assert.equal(text(p, "#totalCompleted"), "1");
  assert.equal(p.$$("#assignedPRList .item").length, 2);
  setValue(p.$("#statusFilter"), "pending", "change");
  assert.equal(p.$$("#assignedPRList .item").length, 1);
  setValue(p.$("#statusFilter"), "all", "change");
  const hrefs = p.$$("#assignedPRList a.btn.sm").map((a) => a.getAttribute("href"));
  assert.ok(hrefs.includes("review-pr.html?id=PR-002") && hrefs.includes("review-pr.html?id=PR-001"));
  assert.ok(p.$$("#assignedPRList a[target=_blank]").every((a) => a.rel.includes("noopener")));
});
test("permission errors are shown, never silently hidden", async () => {
  login("rev1", "arun.review@example.com");
  fakeDb().denyReads.add("pullRequests");
  const p = await openPage("pages/reviewer-dashboard.html");
  assert.match(p.$("#assignedPRList").textContent, /Unable to load pull requests/);
  assert.match(p.$("#pendingReviewList").textContent, /Unable to load pull requests/);
  assert.equal(text(p, "#pendingReviewCount"), "—");
  assert.ok(p.errors.length > 0);
  fakeDb().denyReads.clear(); fakeDb().denyReads.add("reviews");
  const q = await openPage("pages/review-history.html");
  assert.match(q.$("#historyList").textContent, /Unable to load review history/);
});

/* ---------------- REVIEW SUBMISSION ---------------- */
test("review page: missing id / unknown id / not-assigned / already-reviewed", async () => {
  login("rev1", "arun.review@example.com");
  let p = await openPage("pages/review-pr.html");
  assert.match(text(p, "#prTitle"), /ID Missing/);
  p = await openPage("pages/review-pr.html", { search: "?id=NOPE" });
  assert.match(text(p, "#prTitle"), /Not Found/);
  p = await openPage("pages/review-pr.html", { search: "?id=PR-003" });     // unassigned
  assert.match(text(p, "#message"), /not the reviewer assigned/);
  assert.equal(p.$("#approveButton").disabled, true);
  p = await openPage("pages/review-pr.html", { search: "?id=PR-001" });     // already Approved
  assert.match(text(p, "#message"), /already Approved/);
  assert.equal(p.$("#approveButton").disabled, true);
});
test("review form validation blocks empty feedback and missing rating", async () => {
  login("rev1", "arun.review@example.com");
  const p = await openPage("pages/review-pr.html", { search: "?id=PR-002" });
  assert.equal(text(p, "#prTitle"), "Add logging");
  assert.equal(p.$("#githubButton").getAttribute("href"), "https://github.com/o/r/pull/7");
  click(p.$("#approveButton")); await settle();
  assert.match(text(p, "#message"), /enter your review feedback/);
  setValue(p.$("#feedback"), "Looks fine");
  click(p.$("#approveButton")); await settle();
  assert.match(text(p, "#message"), /rate at least one category/);
  assert.equal(all("reviews").length, 1);                                 // nothing saved
});
test("FULL WORKFLOW: submit -> saved -> PR status -> pending/dashboard/history/developer/skills/team all update", async () => {
  // reviewer submits (double-click to prove duplicate protection)
  login("rev1", "arun.review@example.com");
  let p = await openPage("pages/review-pr.html", { search: "?id=PR-002" });
  rate(p, "Testing", 4); rate(p, "Code Quality", 3);
  setValue(p.$("#feedback"), "Please add unit tests for the logger.");
  click(p.$("#changesButton")); click(p.$("#changesButton")); click(p.$("#approveButton"));
  await settle(120);
  const reviews = all("reviews").filter((r) => r.pullRequestId === "PR-002");
  assert.equal(reviews.length, 1, "exactly one review despite repeated clicks");
  const r = reviews[0];
  assert.deepEqual(
    { c: r.category, rating: r.rating, status: r.status, rid: r.reviewerId, aid: r.authorId, an: r.authorName, num: r.pullRequestNumber, t: r.pullRequestTitle },
    { c: "Code Quality", rating: 3, status: "Changes Requested", rid: "rev1", aid: "dev1", an: "Kushmitha N", num: 7, t: "Add logging" });
  assert.deepEqual(r.ratings, { Testing: 4, "Code Quality": 3 }, "per-category ratings are stored");
  assert.equal(r.githubUrl, "https://github.com/o/r/pull/7");
  assert.ok(r.createdAt && typeof r.createdAt.toMillis === "function", "server timestamp");
  assert.equal(get("pullRequests", "PR-002").status, "Changes Requested");   // consistent with review
  assert.ok(get("pullRequests", "PR-002").lastReviewedAt);
  assert.match(text(p, "#message"), /Changes requested/);
  assert.equal(p.$("#approveButton").disabled, true);                         // locked after success

  // second attempt (stale tab) is refused, nothing duplicated
  p = await openPage("pages/review-pr.html", { search: "?id=PR-002" });
  assert.match(text(p, "#message"), /already Changes Requested/);
  assert.equal(all("reviews").length, 2);

  // pending refreshes, dashboard stats change
  let q = await openPage("pages/pending-reviews.html");
  assert.match(q.$("#pendingList").textContent, /all caught up/);
  q = await openPage("pages/reviewer-dashboard.html");
  assert.equal(text(q, "#pendingReviewCount"), "0"); assert.equal(text(q, "#completedReviewCount"), "2");
  assert.match(text(q, "#attentionText"), /all caught up/i);

  // review history (reloaded from "Firestore" on every open)
  for (let i = 0; i < 2; i++) {
    const h = await openPage("pages/review-history.html");
    assert.equal(text(h, "#totalReviews"), "2"); assert.equal(text(h, "#approvedReviews"), "1"); assert.equal(text(h, "#changesReviews"), "1");
    assert.equal(h.$$("#historyList .history-card").length, 2);
    assert.match(h.$("#historyList").textContent, /4\/5\s*Testing/);
    assert.match(h.$("#historyList").textContent, /Not rated/);                     // legacy review handled
    setValue(h.$("#statusFilter"), "changes requested", "change");
    assert.equal(h.$$("#historyList .history-card").length, 1);
    setValue(h.$("#statusFilter"), "all", "change");
    setValue(h.$("#categoryFilter"), "testing", "change");
    assert.equal(h.$$("#historyList .history-card").length, 1);
    setValue(h.$("#categoryFilter"), "all", "change");
    setValue(h.$("#searchReviews"), "authentication");
    assert.equal(h.$$("#historyList .history-card").length, 1);
    assert.equal(h.$("title").textContent.includes("Review History"), true);
    assert.equal(h.$("h1").textContent.trim(), "My review history");
  }

  // developer sees feedback, status, skills
  login("dev1", "dev@x.com");
  const d = await openPage("pages/developer-dashboard.html");
  assert.equal(text(d, "#statTotal"), "2"); assert.equal(text(d, "#statChanges"), "1"); assert.equal(text(d, "#statPending"), "1");
  assert.match(d.$("#feedbackList").textContent, /Please add unit tests/);
  assert.match(d.$("#feedbackList").textContent, /Arun|arun/);
  assert.match(d.$("#historyList").textContent, /Please add unit tests/);
  assert.match(d.$("#skillBlock").textContent, /80%/);                         // Testing 4/5 -> 80%
  assert.match(d.$("#skillBlock").textContent, /70%/);                         // overall = mean(Testing 80, Code Quality 60) = 70
  assert.match(d.$("#skillBlock").textContent, /overall skill score/);
  assert.match(d.$("#skillBlock").textContent, /Not assessed/);                // other categories honestly empty
  assert.doesNotMatch(d.$("#skillBlock").textContent, /10%/);

  // team lead sees the activity
  login("lead1", "lead@x.com");
  const t = await openPage("pages/team-dashboard.html");
  assert.equal(text(t, "#statReviews"), "2"); assert.equal(text(t, "#statMembers"), "4");
  assert.match(t.$("#reviewerTable").textContent, /Arun/);
  assert.match(t.$("#teamSkills").textContent, /Testing/);
  assert.match(t.$("#turnaround").textContent, /average turnaround/);
});
test("failed save leaves PR and reviews untouched (atomic) and re-enables the form", async () => {
  login("rev1", "arun.review@example.com");
  const p = await openPage("pages/review-pr.html", { search: "?id=PR-002" });
  fakeDb().denyWrites.add("reviews");
  rate(p, "Testing", 3); setValue(p.$("#feedback"), "x");
  click(p.$("#approveButton")); await settle(120);
  assert.match(text(p, "#message"), /denied|Unable/i);
  assert.equal(get("pullRequests", "PR-002").status, "Open");
  assert.equal(all("reviews").length, 1);
  assert.equal(p.$("#approveButton").disabled, false);
});
test("GitHub details are fetched and rendered on the review page; failures degrade gracefully", async () => {
  login("rev1", "arun.review@example.com");
  const ok = async (url) => ({ status: 200, ok: true, json: async () => url.includes("/files")
    ? [{ filename: "src/auth.js", status: "modified", additions: 10, deletions: 2 }]
    : { title: "Add logging", user: { login: "kush" }, state: "open", merged: false, created_at: "2026-10-01T00:00:00Z", body: "desc <b>x</b>", changed_files: 1, additions: 10, deletions: 2, commits: 3 } });
  let p = await openPage("pages/review-pr.html", { search: "?id=PR-002", fetchImpl: ok }); await settle(80);
  assert.match(p.$("#githubInfo").textContent, /src\/auth\.js/);
  assert.match(p.$("#githubInfo").textContent, /not synchronised/);
  assert.equal(p.$("#githubInfo").querySelector("b"), null, "body is escaped");
  p = await openPage("pages/review-pr.html", { search: "?id=PR-002", fetchImpl: async () => ({ status: 404, ok: false, json: async () => ({}) }) }); await settle(80);
  assert.match(p.$("#githubInfo").textContent, /private repository|could not find/i);
});

/* ---------------- DEVELOPER DASHBOARD ---------------- */
test("developer: only own PRs, hash views, add PR, duplicates, re-review, legacy notice", async () => {
  seed("pullRequests", "PR-004", { title: "Needs work", number: 9, repository: "r", status: "Changes Requested", authorId: "dev1", authorName: "K", reviewerId: "rev1", githubUrl: "https://github.com/o/r/pull/9" });
  seed("pullRequests", "PR-005", { title: "Other dev", number: 10, repository: "r", status: "Open", authorId: "someone-else", githubUrl: "https://github.com/o/r/pull/10" });
  seed("pullRequests", "PR-006", { title: "Approved no review rec", number: 11, repository: "r", status: "Approved", authorId: "dev1", reviewerId: "rev1", githubUrl: "https://github.com/o/r/pull/11" });
  login("dev1", "dev@x.com");
  const d = await openPage("pages/developer-dashboard.html", { hash: "#skills" });
  assert.ok(d.$("#view-skills").classList.contains("active")); assert.ok(!d.$("#view-prs").classList.contains("active"));
  assert.match(d.$("#skillBlock").textContent, /Not enough assessment data/);       // no rated reviews: empty state, not 0%/10%
  const titles = d.$$("#prList h3").map((e) => e.textContent);
  assert.deepEqual(titles.sort(), ["Add logging", "Approved no review rec", "Needs work", "Unassigned work"]);
  assert.ok(!titles.includes("Other dev"));
  assert.match(text(d, "#pageNotice"), /2 reviewed pull request/);                 // PR-006 has no linked review
  d.dom.window.location.hash = "#history"; await settle();
  assert.ok(d.$("#view-history").classList.contains("active"));
  assert.equal(d.$$(".side-nav .active").length, 1);

  // re-review
  click(d.$$("[data-action=rereview]")[0]); await settle();
  assert.equal(get("pullRequests", "PR-004").status, "In Review");

  // add PR: invalid, valid, duplicate
  const f = d.$("#prForm");
  setValue(d.$("#newPrUrl"), "https://example.com/x"); setValue(d.$("#newPrTitle"), "T");
  f.dispatchEvent(new d.dom.window.Event("submit", { cancelable: true })); await settle();
  assert.match(text(d, "#newPrMessage"), /valid GitHub pull request URL/);
  setValue(d.$("#newPrUrl"), "https://github.com/acme/widgets/pull/42"); setValue(d.$("#newPrTitle"), "New feature");
  f.dispatchEvent(new d.dom.window.Event("submit", { cancelable: true })); await settle(100);
  const created = all("pullRequests").find((p) => p.title === "New feature");
  assert.deepEqual({ n: created.number, repo: created.repository, s: created.status, a: created.authorId, r: created.reviewerId },
    { n: 42, repo: "acme/widgets", s: "Open", a: "dev1", r: null });
  assert.ok(d.$$("#prList h3").some((e) => e.textContent === "New feature"));
  setValue(d.$("#newPrUrl"), "https://github.com/acme/widgets/pull/42"); setValue(d.$("#newPrTitle"), "Again");
  f.dispatchEvent(new d.dom.window.Event("submit", { cancelable: true })); await settle();
  assert.match(text(d, "#newPrMessage"), /already been added/);
  assert.equal(all("pullRequests").filter((p) => p.number === 42).length, 1);

  // search + filter
  setValue(d.$("#searchPrs"), "logging");
  assert.equal(d.$$("#prList .item").length, 1);
});
test("developer: load errors are displayed per section", async () => {
  login("dev1", "dev@x.com");
  fakeDb().denyReads.add("reviews");
  const d = await openPage("pages/developer-dashboard.html");
  assert.match(d.$("#feedbackList").textContent, /Unable to load feedback/);
  assert.match(d.$("#skillBlock").textContent, /Unable to calculate/);
  assert.match(d.$("#historyList").textContent, /Unable to load review history/);
  assert.ok(d.$$("#prList .item").length > 0, "PRs still shown");
});
test("developer cannot see another developer's reviews (query scoped by authorId)", async () => {
  seed("reviews", "R-x", { pullRequestId: "PR-X", reviewerId: "rev1", authorId: "someone-else", category: "Testing", rating: 1, feedback: "secret", status: "Approved", createdAt: "2026-10-01T00:00:00Z" });
  login("dev1", "dev@x.com");
  const d = await openPage("pages/developer-dashboard.html");
  assert.doesNotMatch(d.document.body.textContent, /secret/);
});

/* ---------------- TEAM LEAD ---------------- */
test("team lead: members, PR activity, assignment, reopen, legacy linking", async () => {
  login("lead1", "lead@x.com");
  const t = await openPage("pages/team-dashboard.html");
  assert.equal(text(t, "#statMembers"), "4"); assert.equal(text(t, "#statPrs"), "3"); assert.equal(text(t, "#statPending"), "1");
  assert.equal(t.$$("#membersTable tbody tr").length, 4);
  assert.match(t.$("#membersTable").textContent, /Team Lead/);              // "Team" normalised
  assert.match(t.$("#prStatusBars").textContent, /Approved/);

  // assign PR-003 to Bala
  const manage = () => t.$("#manageTable");
  setValue(t.$("#manageFilter"), "unassigned", "change");
  assert.equal(t.$$("#manageTable tbody tr").length, 1);
  const row = t.$("#manageTable tr[data-row=PR-003]");
  setValue(row.querySelector('[data-field=reviewer]'), "rev2", "change");
  click(row.querySelector("[data-action=save]")); await settle(100);
  const pr3 = get("pullRequests", "PR-003");
  assert.equal(pr3.reviewerId, "rev2"); assert.equal(pr3.reviewerName, "Bala"); assert.ok(pr3.assignedAt);
  assert.equal(text(t, "#statPending"), "2");

  // rev2 now sees it as pending
  login("rev2", "bala@x.com");
  const r2 = await openPage("pages/pending-reviews.html");
  assert.match(r2.$("#pendingList").textContent, /Unassigned work/);

  // legacy: PR-001 has no developer -> link developer, then link legacy review
  login("lead1", "lead@x.com");
  const t2 = await openPage("pages/team-dashboard.html");
  assert.match(t2.$("#legacyBox").textContent, /set the developer below first/);
  assert.equal(t2.$("#linkLegacy"), null);
  const row1 = t2.$("#manageTable tr[data-row=PR-001]");
  setValue(row1.querySelector('[data-field=author]'), "dev1", "change");
  click(row1.querySelector("[data-action=save]")); await settle(100);
  assert.equal(get("pullRequests", "PR-001").authorId, "dev1");
  assert.ok(t2.$("#linkLegacy"), "link button appears");
  click(t2.$("#linkLegacy")); await settle(100);
  assert.equal(get("reviews", "R-old").authorId, "dev1");
  // reopen PR-001
  click(t2.$("#manageTable tr[data-row=PR-001] [data-action=reopen]")); await settle(100);
  assert.equal(get("pullRequests", "PR-001").status, "Open");
  // developer now sees legacy feedback
  login("dev1", "dev@x.com");
  const d = await openPage("pages/developer-dashboard.html");
  assert.match(d.$("#feedbackList").textContent, /authentication flow is implemented clearly/);
});
test("team lead adds a PR for a chosen developer", async () => {
  login("lead1", "lead@x.com");
  const t = await openPage("pages/team-dashboard.html", { hash: "#manage" });
  assert.ok(t.$("#view-manage").classList.contains("active"));
  const f = t.$("#prForm");
  setValue(t.$("#newPrUrl"), "https://github.com/a/b/pull/5"); setValue(t.$("#newPrTitle"), "Lead added");
  f.dispatchEvent(new t.dom.window.Event("submit", { cancelable: true })); await settle();
  assert.match(text(t, "#newPrMessage"), /Choose the developer/);
  setValue(t.$("#newPrAuthor"), "dev1", "change");
  f.dispatchEvent(new t.dom.window.Event("submit", { cancelable: true })); await settle(100);
  const pr = all("pullRequests").find((p) => p.title === "Lead added");
  assert.equal(pr.authorId, "dev1"); assert.equal(pr.authorName, "Kushmitha N");
});
test("team skills: pooled gaps need 3+ ratings; per-developer table", async () => {
  const mk = (id, cat, rating, day) => seed("reviews", id, { pullRequestId: "PR-002", reviewerId: "rev1", authorId: "dev1", category: cat, rating, feedback: "f", status: "Approved", createdAt: { toMillis: () => Date.UTC(2026, 9, day) } });
  mk("a", "Security", 2, 1); mk("b", "Security", 1, 2); mk("c", "Security", 2, 3); mk("d", "Testing", 5, 4);
  login("lead1", "lead@x.com");
  const t = await openPage("pages/team-dashboard.html", { hash: "#skills" });
  assert.match(text(t, "#teamSkills"), /Skill gaps \(below 60%, 3\+ ratings\): Security/);
  assert.match(text(t, "#teamSkills"), /Too little data to judge \(under 3 ratings\): Testing/);
  assert.match(text(t, "#devSkillsTable"), /Kushmitha N/);
});

/* ---------------- LOGOUT / LOGIN / REGISTER ---------------- */
test("logout signs out and returns to login (every role page)", async () => {
  for (const [uid, email, page] of [["rev1", "arun.review@example.com", "pages/reviewer-dashboard.html"], ["dev1", "dev@x.com", "pages/developer-dashboard.html"], ["lead1", "lead@x.com", "pages/team-dashboard.html"], ["rev1", "arun.review@example.com", "pages/review-history.html"]]) {
    world(); login(uid, email);
    const p = await openPage(page);
    click(p.$("#logoutLink")); await settle();
    assert.equal(fakeAuth().currentUser, null, page);
    assert.ok(p.nav.includes("../index.html"), page);
  }
});
test("login redirects by role; bad password and role-less account show messages", async () => {
  for (const [email, expected] of [["dev@x.com", "pages/developer-dashboard.html"], ["arun.review@example.com", "pages/reviewer-dashboard.html"], ["lead@x.com", "pages/team-dashboard.html"]]) {
    const p = await openPage("index.html");
    setValue(p.$("#email"), email); setValue(p.$("#password"), "pw");
    click(p.$("#loginBtn")); await settle(80);
    assert.deepEqual(p.nav, [expected], email);
    fakeAuth().currentUser = null;
  }
  let p = await openPage("index.html");
  setValue(p.$("#email"), "dev@x.com"); setValue(p.$("#password"), "WRONG");
  click(p.$("#loginBtn")); await settle(80);
  assert.match(text(p, "#message"), /Incorrect email or password/);
  fakeAuth().accounts.set("norole@x.com", { uid: "nr", password: "pw" });
  p = await openPage("index.html");
  setValue(p.$("#email"), "norole@x.com"); setValue(p.$("#password"), "pw");
  click(p.$("#loginBtn")); await settle(80);
  assert.match(text(p, "#message"), /profile not found/i);
  p = await openPage("index.html", { search: "?error=norole" });
  assert.match(text(p, "#message"), /no valid role/);
});
test("registration: Developer/Reviewer only; Team Lead cannot self-register", async () => {
  let p = await openPage("pages/register.html");
  assert.equal(p.$$("#role option").map((o) => o.value).join(","), ",Developer,Reviewer");
  setValue(p.$("#name"), "New Dev"); setValue(p.$("#email"), "new@x.com"); setValue(p.$("#password"), "secret1");
  setValue(p.$("#role"), "Reviewer", "change");
  const confirm = p.$("#confirmPassword"); if (confirm) setValue(confirm, "secret1");
  click(p.$("#registerBtn")); await settle(80);
  assert.equal(get("users", "uid-new").role, "Reviewer");
  // forced bad role value is rejected by the script
  world(); p = await openPage("pages/register.html");
  const opt = p.document.createElement("option"); opt.value = "Team"; opt.textContent = "Team"; p.$("#role").appendChild(opt);
  setValue(p.$("#name"), "Sneaky"); setValue(p.$("#email"), "s@x.com"); setValue(p.$("#password"), "secret1"); setValue(p.$("#role"), "Team", "change");
  const c2 = p.$("#confirmPassword"); if (c2) setValue(c2, "secret1");
  click(p.$("#registerBtn")); await settle(80);
  assert.equal(get("users", "uid-s"), undefined);
  assert.match(text(p, "#message"), /Team Lead accounts are created by an administrator/);
});
