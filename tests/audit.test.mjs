import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditDataset } from "../scripts/schema-audit-lib.mjs";
import { buildDemoDataset } from "../js/demo/dataset.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const codes = (r) => new Set(r.findings.map((f) => f.code));
const doc = (id, data) => ({ id, data });

test("the demo dataset itself has no blockers or warnings", () => {
  const d = buildDemoDataset(Date.now());
  const r = auditDataset({ users: d.users, pullRequests: d.pullRequests, reviews: d.reviews });
  assert.deepEqual(r.findings.filter((f) => f.severity !== "info").map((f) => `${f.id}:${f.code}`), []);
  assert.equal(r.counts.pullRequests, 15);
});

test("the original hand-made PR-001 style data is classified correctly", () => {
  const r = auditDataset({
    users: [doc("rev", { name: "Arun", role: "Reviewer", email: "arun.review@example.com" }), doc("old", { name: "Lead", role: "Team" })],
    pullRequests: [doc("PR-001", { title: "Improve authentication flow", number: 142, repository: "peer-code-review", status: "Approved",
      authorName: "Kushmitha N", reviewerId: "rev", githubUrl: "https://github.com/kushmithaa/peer-code-review-tracker/pull/1" })],
    reviews: [doc("r1", { pullRequestId: "PR-001", reviewerId: "rev", category: "Code Quality", status: "Approved", feedback: "ok" })]
  });
  const c = codes(r);
  assert.ok(c.has("authorId-missing"), "PR without authorId must be flagged");
  assert.ok(c.has("authorId-missing-blocked"), "review whose PR has no developer cannot be linked yet");
  assert.ok(c.has("unrated")); assert.ok(c.has("role-legacy-team"));
  assert.equal(r.blockers, 0);
});

test("detects each problem that would make the rules reject or hide real data", () => {
  const r = auditDataset({
    users: [doc("dev", { name: "D", role: "Developer" }), doc("rev", { name: "R", role: "Reviewer" }), doc("noname", { role: "Reviewer" }), doc("weird", { name: "W", role: "admin" })],
    pullRequests: [
      doc("p_nostatus", { title: "t", authorId: "dev", reviewerId: "rev" }),
      doc("p_lower", { title: "t", status: "pending", authorId: "dev", reviewerId: "rev" }),
      doc("p_prio", { title: "t", status: "Open", priority: "urgent", authorId: "dev", reviewerId: "rev" }),
      doc("p_noreviewerfield", { title: "t", status: "Open", authorId: "dev" }),
      doc("p_self", { title: "t", status: "Open", authorId: "rev", reviewerId: "rev" }),
      doc("p_badroles", { title: "t", status: "Open", authorId: "rev", reviewerId: "dev" }),
      doc("p_ghost", { title: "t", status: "Open", authorId: "ghost", reviewerId: "ghost2" }),
      doc("p_ok", { title: "t", status: "Open", authorId: "dev", reviewerId: null })
    ],
    reviews: [
      doc("r_orphan", { pullRequestId: "nope", reviewerId: "rev", authorId: "dev", ratings: { Testing: 4 } }),
      doc("r_bad", { pullRequestId: "p_ok", reviewerId: "rev", authorId: "dev", ratings: { Testing: 9, Style: 3 } }),
      doc("r_mismatch", { pullRequestId: "p_ok", reviewerId: "rev", authorId: "someone", ratings: { Testing: 4 } }),
      doc("r_empty", { pullRequestId: "p_ok", reviewerId: "rev", authorId: "dev", ratings: {} })
    ]
  });
  const c = codes(r);
  for (const code of ["role-invalid", "name-missing", "status-missing", "status-noncanonical", "priority-invalid", "reviewerId-missing", "self-review",
    "author-not-developer", "reviewer-not-reviewer", "author-unknown", "reviewer-unknown", "pr-missing", "ratings-out-of-range", "ratings-unknown-category", "author-mismatch", "ratings-empty", "unassigned"])
    assert.ok(c.has(code), `missing finding: ${code}`);
  assert.ok(r.blockers >= 3);                          // invalid role, nameless reviewer, invalid priority
  assert.ok(!r.findings.some((f) => f.id === "p_ok" && f.severity !== "info"), "a valid PR must not be flagged");
});

test("the audit tool is READ-ONLY: no write, delete or auth-management API appears in it", () => {
  for (const f of ["scripts/audit-schema.mjs", "scripts/schema-audit-lib.mjs"]) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    for (const forbidden of [/\.set\(/, /\.update\(/, /\.create\(/, /\.delete\(/, /\.add\(/, /\.batch\(/, /runTransaction/, /createUser/, /deleteUser/, /updateUser/, /setCustomUserClaims/, /generate\w*Link/, /recursiveDelete/, /bulkWriter/i])
      assert.ok(!forbidden.test(src), `${f} contains ${forbidden}`);
  }
});
test("the audit tool prints ids and codes only, never document contents", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts/audit-schema.mjs"), "utf8");
  assert.ok(!/console\.log\([^)]*\.data\b/.test(src));
  const r = auditDataset({ users: [doc("u", { name: "Secret Name", email: "secret@example.com", role: "admin" })], pullRequests: [], reviews: [doc("r", { pullRequestId: "x", feedback: "private feedback", ratings: { Testing: 3 } })] });
  assert.ok(!JSON.stringify(r.findings).match(/Secret Name|secret@example\.com|private feedback/), "findings leak document contents");
});
