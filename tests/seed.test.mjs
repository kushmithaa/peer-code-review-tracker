import test from "node:test";
import assert from "node:assert/strict";
import { runSeed, assertTarget, ALLOWED_PROJECT } from "../scripts/seed-firebase.mjs";
import { buildDemoDataset, DEMO_USERS, DEMO_NAMESPACE } from "../js/demo/dataset.js";

/* In-memory stand-in for the Admin SDK adapter. */
function memoryAdapter({ authUsers = {}, existingDocs = {}, failAuthCreate = false } = {}) {
  const state = { auth: { ...authUsers }, docs: new Map(Object.entries(existingDocs)), authCreates: [], docWrites: [] };
  return {
    state,
    async getAuthUserByEmail(email) { return state.auth[email] ? { uid: state.auth[email] } : null; },
    async createAuthUser({ email, displayName }) {
      if (failAuthCreate) throw new Error("PERMISSION_DENIED: insufficient permissions");
      const uid = "auth-" + email.split("@")[0]; state.auth[email] = uid; state.authCreates.push({ email, displayName, hadPassword: false }); return { uid };
    },
    async passwordResetLink(email) { return `https://example.test/reset?email=${email}`; },
    async createDoc(path, data) { if (state.docs.has(path)) return "exists"; state.docs.set(path, data); state.docWrites.push(path); return "created"; },
    makeTimestamp: (ms) => ({ ts: ms })
  };
}
const NOW = Date.UTC(2026, 9, 17);
const go = (adapter, over = {}) => runSeed({ adapter, projectId: ALLOWED_PROJECT, confirm: ALLOWED_PROJECT, nowMs: NOW, ...over });

test("dry run (no --confirm) contacts and writes nothing", async () => {
  const a = memoryAdapter();
  const r = await runSeed({ adapter: a, projectId: ALLOWED_PROJECT, nowMs: NOW });
  assert.equal(r.dryRun, true); assert.equal(r.wrote, false);
  assert.deepEqual(r.plan, { users: 7, pullRequests: 15, reviews: 10 });
  assert.equal(a.state.docWrites.length, 0); assert.equal(a.state.authCreates.length, 0);
});
test("refuses another project, a wrong confirmation and a missing project", async () => {
  await assert.rejects(go(memoryAdapter(), { projectId: "someone-elses-project", confirm: "someone-elses-project" }), /only targets/);
  await assert.rejects(go(memoryAdapter(), { confirm: "typo" }), /--confirm must equal/);
  await assert.rejects(runSeed({ adapter: memoryAdapter() }), /--project is required/);
  assert.doesNotThrow(() => assertTarget({ projectId: "demo-pcrt", confirm: "demo-pcrt", emulator: true }));   // emulator may use any project id
});
test("first run creates everything and reports exact counts", async () => {
  const a = memoryAdapter(); const r = await go(a);
  assert.deepEqual([r.auth.created, r.auth.existing], [7, 0]);
  assert.deepEqual([r.users.created, r.pullRequests.created, r.reviews.created], [7, 15, 10]);
  assert.deepEqual([r.users.skipped, r.pullRequests.skipped, r.reviews.skipped], [0, 0, 0]);
  assert.equal(a.state.docs.size, 32);
  assert.equal(r.resetLinks.length, 7);
});
test("rerun is idempotent: everything skipped, nothing duplicated or overwritten", async () => {
  const a = memoryAdapter(); await go(a);
  const before = JSON.stringify([...a.state.docs]);
  const r = await go(a);
  assert.deepEqual([r.auth.created, r.auth.existing], [0, 7]);
  assert.deepEqual([r.users.created, r.pullRequests.created, r.reviews.created], [0, 0, 0]);
  assert.deepEqual([r.users.skipped, r.pullRequests.skipped, r.reviews.skipped], [7, 15, 10]);
  assert.equal(r.resetLinks.length, 0);
  assert.equal(JSON.stringify([...a.state.docs]), before);
});
test("never creates passwords: Auth users are created without one", async () => {
  const a = memoryAdapter(); await go(a);
  assert.ok(a.state.authCreates.every((c) => c.hadPassword === false));
  for (const [path, data] of a.state.docs) {
    assert.ok(!Object.keys(data).some((k) => /password|secret|token|credential|apikey/i.test(k)), `${path} has a credential-like field`);
  }
});
test("existing Auth accounts and profiles are reused, never overwritten", async () => {
  const email = "meera.lead@example.com";
  const a = memoryAdapter({ authUsers: { [email]: "REAL-UID" }, existingDocs: { "users/REAL-UID": { name: "Real Meera", role: "Team Lead", precious: true } } });
  const r = await go(a);
  assert.equal(r.auth.existing, 1); assert.equal(a.state.authCreates.some((c) => c.email === email), false);
  assert.deepEqual(a.state.docs.get("users/REAL-UID"), { name: "Real Meera", role: "Team Lead", precious: true });
  assert.equal(r.users.skipped, 1);
  // PRs/reviews still reference the real uid where the user is involved
  assert.ok(![...a.state.docs.values()].some((d) => d.reviewerId === "demo-meera" || d.authorId === "demo-meera"));
});
test("Auth failure aborts BEFORE any Firestore write", async () => {
  const a = memoryAdapter({ failAuthCreate: true });
  await assert.rejects(go(a), /PERMISSION_DENIED/);
  assert.equal(a.state.docWrites.length, 0);
});
test("every seeded record is clearly marked as demo data and uses demo_ ids", async () => {
  const a = memoryAdapter(); await go(a);
  for (const [path, data] of a.state.docs) {
    assert.equal(data.demo, true, path); assert.equal(data.demoNamespace, DEMO_NAMESPACE, path);
    if (!path.startsWith("users/")) assert.match(path, /^(pullRequests|reviews)\/demo_/);
  }
});
test("seed data is internally consistent (references, assignments, dates, statuses)", async () => {
  const d = buildDemoDataset(NOW);
  const uids = new Set(d.users.map((u) => u.id)); const prs = new Map(d.pullRequests.map((p) => [p.id, p.data]));
  const STATUS = new Set(["Open", "In Review", "Changes Requested", "Approved", "Merged"]);
  assert.equal(d.users.length, 7); assert.ok(d.pullRequests.length >= 12);
  assert.deepEqual(d.users.map((u) => [u.data.name, u.data.email, u.data.role]),
    DEMO_USERS.map((u) => [u.name, u.email, u.role]));
  for (const p of prs.values()) {
    assert.ok(STATUS.has(p.status), p.status); assert.ok(uids.has(p.authorId) && uids.has(p.reviewerId));
    assert.match(p.githubUrl, /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/);
    assert.ok(p.createdAt.__ts < NOW);
  }
  for (const r of d.reviews) {
    const p = prs.get(r.data.pullRequestId); assert.ok(p, "review points at an existing PR");
    assert.equal(r.data.authorId, p.authorId); assert.equal(r.data.reviewerId, p.reviewerId);
    assert.ok(r.data.createdAt.__ts > p.assignedAt.__ts && r.data.createdAt.__ts < NOW);
    for (const v of Object.values(r.data.ratings)) assert.ok(Number.isInteger(v) && v >= 1 && v <= 5);
    assert.equal(r.data.ratings[r.data.category], r.data.rating);
    assert.ok(r.data.feedback.length > 40);
  }
  const reviewed = new Set(d.reviews.map((r) => r.data.pullRequestId));
  const pendingNoReview = [...prs].filter(([id, p]) => ["Open", "In Review"].includes(p.status) && !reviewed.has(id));
  assert.ok(pendingNoReview.length >= 4, "enough PRs awaiting review to demo the queue");
  for (const [id, p] of prs) if (["Approved", "Changes Requested"].includes(p.status)) assert.ok(reviewed.has(id), `${id} is decided but has no review`);
  const states = new Set([...prs.values()].map((p) => p.status));
  for (const s of ["Open", "In Review", "Approved", "Changes Requested"]) assert.ok(states.has(s), s);
});
