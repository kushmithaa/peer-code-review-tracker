import test from "node:test";
import assert from "node:assert/strict";
import { computeSkills, reviewActivity, computeTeamSkills, trendOf, ratingOf } from "../js/skills.js";
import { normalizeRole, normalizeStatus, isPending, toMillis } from "../js/common.js";
import { parsePullUrl, fetchPullDetails } from "../js/github.js";

const R = (category, rating, day, extra = {}) => ({
  category, rating, status: "Approved", createdAt: { toMillis: () => Date.UTC(2026, 0, day) }, ...extra });

test("no reviews -> no score (empty state, not 0% or 10%)", () => {
  const s = computeSkills([]);
  assert.equal(s.overall, null);
  assert.ok(s.categories.every((c) => c.score === null && c.n === 0));
});

test("legacy text-only reviews are excluded from scores", () => {
  const s = computeSkills([{ category: "Testing", status: "Approved", feedback: "ok" }]);
  assert.equal(s.overall, null);
  assert.equal(s.unassessedCount, 1);
});

test("category score = mean rating / 5 * 100", () => {
  const s = computeSkills([R("Testing", 4, 1), R("Testing", 5, 2)]);
  const t = s.categories.find((c) => c.category === "Testing");
  assert.equal(t.score, 90);               // (4+5)/2/5*100 = 90
  assert.equal(t.n, 2);
  assert.equal(t.lowConfidence, true);      // n < 3
});

test("overall equals mean of displayed category scores (consistency)", () => {
  const s = computeSkills([R("Testing", 4, 1), R("Security", 2, 2), R("Code Quality", 5, 3)]);
  const shown = s.categories.filter((c) => c.score !== null).map((c) => c.score);
  assert.deepEqual(shown.sort((a, b) => a - b), [40, 80, 100]);
  assert.equal(s.overall.score, Math.round((40 + 80 + 100) / 3)); // 73
  assert.equal(s.overall.categoriesAssessed, 3);
});

test("unassessed categories do not drag the overall score down", () => {
  const s = computeSkills([R("Testing", 5, 1)]);
  assert.equal(s.overall.score, 100);
});

test("invalid ratings (0, 6, 3.5, text, null) are ignored", () => {
  for (const bad of [0, 6, 3.5, "x", null, undefined, ""]) assert.equal(ratingOf({ rating: bad }), null);
  assert.equal(ratingOf({ rating: "4" }), 4);
});

test("trend needs >= 4 ratings, compares older vs newer half", () => {
  assert.equal(trendOf([3, 3, 3]).status, "insufficient");
  assert.deepEqual(trendOf([2, 2, 4, 4]), { status: "improving", change: 40, previous: 40, current: 80 });
  assert.equal(trendOf([4, 4, 2, 2]).status, "declining");
  assert.equal(trendOf([3, 3, 3, 3]).status, "stable");
});

test("trend uses chronological order regardless of input order", () => {
  const s = computeSkills([R("Testing", 4, 4), R("Testing", 2, 1), R("Testing", 4, 3), R("Testing", 2, 2)]);
  assert.equal(s.categories.find((c) => c.category === "Testing").trend.status, "improving");
});

test("strengths >= 80, improvements < 60", () => {
  const s = computeSkills([R("Testing", 5, 1), R("Security", 2, 2)]);
  assert.deepEqual(s.strengths, ["Testing"]);
  assert.deepEqual(s.improvements, ["Security"]);
});

test("reviewer activity is counts only", () => {
  const a = reviewActivity([R("Testing", 4, 1), { ...R("Security", 2, 2), status: "Changes Requested" }, { status: "Approved" }]);
  assert.equal(a.total, 3); assert.equal(a.approved, 2); assert.equal(a.changesRequested, 1);
  assert.equal(a.byCategory.Testing, 1); assert.equal(a.uncategorised, 1);
});

test("team skill statuses: gap needs n>=3", () => {
  const few = computeTeamSkills([R("Security", 1, 1), R("Security", 1, 2)]);
  assert.equal(few.categories.find((c) => c.category === "Security").status, "insufficient");
  const many = computeTeamSkills([R("Security", 1, 1), R("Security", 2, 2), R("Security", 2, 3)]);
  assert.equal(many.categories.find((c) => c.category === "Security").status, "gap");
});

test("role normalisation: Team == Team Lead; unknown -> null", () => {
  assert.equal(normalizeRole("Developer"), "Developer");
  assert.equal(normalizeRole(" reviewer "), "Reviewer");
  assert.equal(normalizeRole("Team"), "Team Lead");
  assert.equal(normalizeRole("Team Lead"), "Team Lead");
  assert.equal(normalizeRole("admin"), null);
  assert.equal(normalizeRole(undefined), null);
});

test("status normalisation and pending rule", () => {
  assert.equal(normalizeStatus(undefined), "Open");
  assert.equal(normalizeStatus("in-review"), "In Review");
  assert.equal(normalizeStatus("approved"), "Approved");
  assert.equal(isPending({ reviewerId: "r", status: "Open" }), true);
  assert.equal(isPending({ reviewerId: "r", status: "In Review" }), true);
  assert.equal(isPending({ reviewerId: "r", status: "Approved" }), false);
  assert.equal(isPending({ reviewerId: "r", status: "Changes Requested" }), false);
  assert.equal(isPending({ reviewerId: null, status: "Open" }), false);   // unassigned is not pending for anyone
});

test("toMillis handles Timestamp, ISO string, missing", () => {
  assert.equal(toMillis({ toMillis: () => 5 }), 5);
  assert.equal(toMillis("2026-01-01T00:00:00.000Z"), Date.UTC(2026, 0, 1));
  assert.equal(toMillis(null), 0);
  assert.equal(toMillis("garbage"), 0);
});

test("GitHub URL parsing", () => {
  assert.deepEqual(parsePullUrl("https://github.com/kushmithaa/peer-code-review-tracker/pull/1"),
    { owner: "kushmithaa", repo: "peer-code-review-tracker", number: 1 });
  assert.deepEqual(parsePullUrl("https://github.com/a/b/pull/1/"), { owner: "a", repo: "b", number: 1 });  // trailing slash ok
  for (const bad of ["", null, "http://github.com/a/b/pull/1", "https://github.com/a/b/issues/1", "https://evil.com/a/b/pull/1", "javascript:alert(1)"])
    assert.equal(parsePullUrl(bad), null, String(bad));
});

test("fetchPullDetails maps success / 404 / rate limit / network error", async () => {
  const mk = (map) => async (url) => {
    const hit = Object.entries(map).find(([k]) => url.includes(k));
    if (!hit) throw new Error("net");
    const [status, body] = hit[1];
    return { status, ok: status < 400, json: async () => body };
  };
  const url = "https://github.com/o/r/pull/7";
  const ok = await fetchPullDetails(url, mk({
    "/files": [200, [{ filename: "a.js", status: "modified", additions: 3, deletions: 1 }]],
    "/pulls/7": [200, { title: "T", user: { login: "dev" }, state: "open", merged: false, created_at: "2026-01-01T00:00:00Z", body: "b", changed_files: 1, additions: 3, deletions: 1, commits: 2 }]
  }));
  assert.equal(ok.ok, true); assert.equal(ok.data.additions, 3); assert.equal(ok.data.files[0].filename, "a.js"); assert.equal(ok.data.filesTruncated, false);
  assert.equal((await fetchPullDetails(url, mk({ "/pulls/7": [404, {}] }))).reason, "not-found");
  assert.equal((await fetchPullDetails(url, mk({ "/pulls/7": [403, {}] }))).reason, "rate-limited");
  assert.equal((await fetchPullDetails(url, mk({}))).reason, "network");
  assert.equal((await fetchPullDetails("nope", mk({}))).reason, "invalid-url");
});

/* ---------------- multi-category ratings (ratings map) ---------------- */
import { ratingsOf } from "../js/skills.js";
import { buildDemoDataset } from "../js/demo/dataset.js";

test("a ratings map is read per category and takes precedence over legacy single fields", () => {
  const review = { category: "Testing", rating: 1, ratings: { "Code Quality": 4, Readability: 5 }, createdAt: { toMillis: () => 1 } };
  assert.deepEqual(ratingsOf(review), [["Code Quality", 4], ["Readability", 5]]);       // legacy rating:1 ignored
  const s = computeSkills([review]);
  assert.equal(s.categories.find((c) => c.category === "Testing").score, null);          // not double counted
  assert.equal(s.categories.find((c) => c.category === "Readability").score, 100);
  assert.equal(s.overall.n, 1);                                                          // one review, two categories
  assert.equal(s.overall.score, 90);
});
test("invalid entries inside a ratings map are ignored individually", () => {
  assert.deepEqual(ratingsOf({ ratings: { Testing: 4, Security: 9, Style: 3, Readability: "2", Performance: 2.5 } }), [["Testing", 4], ["Readability", 2]]);
});
test("six categories are supported", () => {
  assert.deepEqual(computeSkills([]).categories.map((c) => c.category), ["Code Quality", "Readability", "Performance", "Security", "Testing", "Documentation"]);
});
test("trend reports previous and current scores", () => {
  const reviews = [3, 3, 5, 5].map((v, i) => ({ ratings: { Testing: v }, createdAt: { toMillis: () => i + 1 } }));
  const t = computeSkills(reviews).categories.find((c) => c.category === "Testing").trend;
  assert.deepEqual(t, { status: "improving", change: 40, previous: 60, current: 100 });
});

/* ---------------- the demo dataset produces the documented numbers ---------------- */
test("demo dataset: Rahul's skills are 80/70/40/73/60 -> overall 65 (hand-computed)", () => {
  const d = buildDemoDataset(Date.now());
  const rahul = d.users.find((u) => u.data.name === "Rahul Kumar").id;
  const mine = d.reviews.map((r) => ({ ...r.data, createdAt: { toMillis: () => r.data.createdAt.__ts } })).filter((r) => r.authorId === rahul);
  const s = computeSkills(mine);
  const by = Object.fromEntries(s.categories.map((c) => [c.category, c.score]));
  assert.deepEqual(by, { "Code Quality": 80, Readability: 70, Performance: null, Security: 40, Testing: 73, Documentation: 60 });
  assert.equal(s.overall.score, 65);
  assert.equal(s.overall.n, 3);
  assert.deepEqual(s.improvements, ["Security"]);
  assert.deepEqual(s.strengths, ["Code Quality"]);
});
test("demo dataset: Priya's Code Quality goes 70% -> 80% (improving), but Testing has too few ratings for a trend", () => {
  const d = buildDemoDataset(Date.now());
  const priya = d.users.find((u) => u.data.name === "Priya Sharma").id;
  const mine = d.reviews.map((r) => ({ ...r.data, createdAt: { toMillis: () => r.data.createdAt.__ts } })).filter((r) => r.authorId === priya);
  const cq = computeSkills(mine).categories.find((c) => c.category === "Code Quality");
  assert.deepEqual([cq.n, cq.trend.status, cq.trend.previous, cq.trend.current], [4, "improving", 70, 80]);
  assert.equal(computeSkills(mine).categories.find((c) => c.category === "Testing").trend.status, "insufficient");
});
