/*
 * Drives every real write path of the app against the demo dataset, records the exact payloads
 * (tests/rules/app-payloads.json - replayed against firestore.rules by the emulator tests), and
 * cross-checks them against the field allowlists written in firestore.rules.
 *
 * This does NOT evaluate the rules (that needs the emulator); it proves the app and the rules
 * agree on field names and shapes, and that no write path was forgotten.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
await import("../js/demo/firebase-firestore.js");
await import("../js/demo/firebase-auth.js");
import { Timestamp } from "../js/demo/firebase-firestore.js";
import { buildDemoDataset, reviveTimestamps } from "../js/demo/dataset.js";
const H = await import("./helpers.mjs");
const { openPage, resetFirebase, seed, login, fakeDb, click, setValue, settle } = H;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RULES = fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8");
const OUT = path.join(ROOT, "tests", "rules", "app-payloads.json");
const DAY = 86_400_000;
const slug = (c) => c.toLowerCase().replace(/\s+/g, "-");

const WORLD = buildDemoDataset(Date.now());
const person = (key) => WORLD.users.find((u) => u.id === `demo-${key}`);

function seedWorld(prepare) {
  resetFirebase();
  const revive = (d) => reviveTimestamps(d, (ms) => new Timestamp(ms));
  WORLD.users.forEach((u) => seed("users", u.id, revive(u.data)));
  WORLD.pullRequests.forEach((p) => seed("pullRequests", p.id, revive(p.data)));
  WORLD.reviews.forEach((r) => seed("reviews", r.id, revive(r.data)));
  if (prepare === "stripReviewAuthorIds") {
    for (const id of ["demo_rv_01", "demo_rv_02", "demo_rv_03"]) delete fakeDb().cols.get("reviews").get(id).authorId;
  }
}
const as = (key) => { const u = person(key); login(u.id, u.data.email); };
const rate = (page, category, value) => {
  const input = page.$(`input[name="rating-${slug(category)}"][value="${value}"]`);
  input.checked = true; input.dispatchEvent(new page.dom.window.Event("change", { bubbles: true }));
};
const submit = (page, selector) => page.$(selector).dispatchEvent(new page.dom.window.Event("submit", { cancelable: true }));
const isoDay = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

/* ---- normalise one scenario's write log into a stable, replayable form ---- */
function normalise(log) {
  const ids = new Set();
  log.forEach((w) => { const id = w.path.split("/")[1]; if (id.startsWith("auto")) ids.add(id); });
  const now = Date.now();
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      if (Object.keys(v).length === 1 && "__ts" in v) return { __tsFromNowDays: Math.round((v.__ts - now) / DAY) };
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    if (typeof v === "string") { let s = v; ids.forEach((id) => { s = s.split(id).join("<NEW_ID>"); }); return s; }
    return v;
  };
  return log.map((w) => ({ op: w.op, path: walk(w.path), via: w.via, group: w.group ? 1 : null, data: walk(w.raw) }));
}

const scenarios = [];
async function run(name, { prepare, actor, act }) {
  seedWorld(prepare);
  if (actor) as(actor);
  fakeDb().log.length = 0;
  await act();
  await settle(120);
  const log = [...fakeDb().log];
  assert.ok(log.length > 0, `${name}: the app wrote nothing`);
  const uid = log[0].actor;
  const groups = new Set(log.map((w) => w.group).filter(Boolean));
  assert.ok(groups.size <= 1, `${name}: more than one batch`);
  scenarios.push({ name, prepare: prepare || null, actor: uid, writes: normalise(log) });
  return log;
}

test("capture every real write path of the app", async () => {
  // ---------- registration ----------
  for (const [name, role, email] of [["register.developer", "Developer", "new.dev@example.com"], ["register.reviewer", "Reviewer", "new.rev@example.com"]]) {
    await run(name, { act: async () => {
      const p = await openPage("pages/register.html");
      setValue(p.$("#name"), "New Person"); setValue(p.$("#email"), email); setValue(p.$("#password"), "longenough1");
      setValue(p.$("#role"), role, "change"); click(p.$("#registerBtn"));
    } });
  }

  // ---------- developer ----------
  const fillPrForm = (p, url, title, extra = {}) => {
    setValue(p.$("#newPrUrl"), url); setValue(p.$("#newPrTitle"), title);
    setValue(p.$("#newPrDesc"), "Adds keyboard shortcuts."); setValue(p.$("#newPrPriority"), "High", "change");
    setValue(p.$("#newPrDue"), isoDay(10));
    if (extra.author) setValue(p.$("#newPrAuthor"), extra.author, "change");
    submit(p, "#prForm");
  };
  await run("developer.addPullRequest", { actor: "arjun", act: async () => {
    fillPrForm(await openPage("pages/developer-dashboard.html"), "https://github.com/demo-org/web-app/pull/301", "Add keyboard shortcuts");
  } });
  await run("developer.requestReReview", { actor: "arjun", act: async () => {
    const p = await openPage("pages/developer-dashboard.html"); click(p.$("[data-action=rereview]"));
  } });

  // ---------- team lead ----------
  await run("lead.addPullRequest", { actor: "meera", act: async () => {
    fillPrForm(await openPage("pages/team-dashboard.html"), "https://github.com/demo-org/api-service/pull/302", "Cache lookups", { author: "demo-rahul" });
  } });
  const manage = async (rowId, edit, button = "save") => {
    const p = await openPage("pages/team-dashboard.html", { hash: "#manage" });
    const row = p.$(`tr[data-row="${rowId}"]`);
    edit(row, p);
    click(row.querySelector(`[data-action=${button}]`));
  };
  await run("lead.assignReviewer", { actor: "meera", act: () => manage("demo_pr_08", (row) => setValue(row.querySelector("[data-field=reviewer]"), "demo-karthik", "change")) });
  await run("lead.changeDeveloper", { actor: "meera", act: () => manage("demo_pr_08", (row) => setValue(row.querySelector("[data-field=author]"), "demo-rahul", "change")) });
  await run("lead.unassignReviewer", { actor: "meera", act: () => manage("demo_pr_09", (row) => setValue(row.querySelector("[data-field=reviewer]"), "", "change")) });
  await run("lead.reopen", { actor: "meera", act: () => manage("demo_pr_01", () => {}, "reopen") });
  await run("lead.linkLegacyReviews", { actor: "meera", prepare: "stripReviewAuthorIds", act: async () => {
    const p = await openPage("pages/team-dashboard.html", { hash: "#manage" }); click(p.$("#linkLegacy"));
  } });

  // ---------- reviewer ----------
  await run("reviewer.approve", { actor: "arun", act: async () => {
    const p = await openPage("pages/review-pr.html", { search: "?id=demo_pr_09" });
    rate(p, "Code Quality", 4); rate(p, "Security", 3); setValue(p.$("#feedback"), "Clear refactor; please add one more table-driven test case.");
    click(p.$("#approveButton"));
  } });
  await run("reviewer.requestChanges", { actor: "sneha", act: async () => {
    const p = await openPage("pages/review-pr.html", { search: "?id=demo_pr_12" });
    rate(p, "Readability", 2); rate(p, "Testing", 3); setValue(p.$("#feedback"), "Labels are linked, but errors are not announced to screen readers.");
    click(p.$("#changesButton"));
  } });

  fs.writeFileSync(OUT, JSON.stringify({
    note: "Generated by tests/payloads.test.mjs from the app's real write paths against the demo dataset. Do not edit by hand.",
    scenarios
  }, null, 2) + "\n");
  assert.equal(scenarios.length, 12);
});

/* ---------------- cross-check against the allowlists written in firestore.rules ---------------- */
const listFrom = (re) => { const m = re.exec(RULES); assert.ok(m, `pattern not found in rules: ${re}`); return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]); };
const pathOf = (w) => w.path.split("/");
const writesOf = (name) => scenarios.find((s) => s.name === name).writes;
const keysOf = (w) => Object.keys(w.data).sort();
const sorted = (a) => [...a].sort();

test("user profile payloads use exactly the fields the rules allow, and never a privileged role", () => {
  const allowed = listFrom(/match \/users\/\{uid\}[\s\S]*?keys\(\)\.hasOnly\((\[[^\]]*\])\)/);
  for (const n of ["register.developer", "register.reviewer"]) {
    const [w] = writesOf(n);
    assert.equal(w.op, "set"); assert.equal(pathOf(w)[0], "users");
    assert.deepEqual(keysOf(w), sorted(allowed), n);
    assert.ok(["Developer", "Reviewer"].includes(w.data.role));
    assert.equal(w.data.uid, pathOf(w)[1]);
  }
});
test("pull request creation payloads match the rules' key allowlist and required keys", () => {
  const allowed = listFrom(/function prKeys\(\)\s*\{\s*return (\[[^\]]*\])/);
  const required = listFrom(/function prRequired\(\)\s*\{\s*return (\[[^\]]*\])/);
  for (const n of ["developer.addPullRequest", "lead.addPullRequest"]) {
    const [w] = writesOf(n);
    assert.equal(w.op, "set");
    assert.ok(keysOf(w).every((k) => allowed.includes(k)), `${n} sends a key the rules do not allow: ${keysOf(w).filter((k) => !allowed.includes(k))}`);
    assert.ok(required.every((k) => k in w.data), `${n} misses a required key`);
    assert.equal(w.data.status, "Open"); assert.equal(w.data.reviewerId, null);
    assert.deepEqual(w.data.createdAt, { __serverTimestamp: true }); assert.deepEqual(w.data.updatedAt, { __serverTimestamp: true });
    assert.ok(Number.isInteger(w.data.number));
  }
});
test("pull request updates only touch fields allowed for the acting role", () => {
  const pr = /match \/pullRequests\/\{prId\}[\s\S]*?\n    \}\n/.exec(RULES)[0];
  const sets = [...pr.matchAll(/changedKeys\(\)\.hasOnly\((\[[^\]]*\])\)/g)].map((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  const [lead, reviewer, developer] = sets;
  assert.equal(sets.length, 3);
  const changed = (w) => Object.keys(w.data);
  for (const n of ["lead.assignReviewer", "lead.changeDeveloper", "lead.unassignReviewer", "lead.reopen"]) {
    const [w] = writesOf(n); assert.equal(w.op, "update");
    assert.ok(changed(w).every((k) => lead.includes(k)), `${n}: ${changed(w).filter((k) => !lead.includes(k))}`);
    assert.deepEqual(w.data.updatedAt, { __serverTimestamp: true });
  }
  const [reReview] = writesOf("developer.requestReReview");
  assert.ok(changed(reReview).every((k) => developer.includes(k))); assert.equal(reReview.data.status, "In Review");
  for (const n of ["reviewer.approve", "reviewer.requestChanges"]) {
    const upd = writesOf(n).find((w) => w.op === "update");
    assert.ok(changed(upd).every((k) => reviewer.includes(k)), n);
    assert.equal(upd.data.lastReviewId, "<NEW_ID>");
  }
});
test("review submission is ONE transaction: a review plus a PR decision that points at it, same status", () => {
  const allowed = listFrom(/function reviewKeys\(\)\s*\{\s*return (\[[^\]]*\])/);
  for (const n of ["reviewer.approve", "reviewer.requestChanges"]) {
    const ws = writesOf(n);
    assert.equal(ws.length, 2, n); assert.ok(ws.every((w) => w.via === "transaction" && w.group === ws[0].group), `${n} is not a single transaction`);
    const review = ws.find((w) => w.path.startsWith("reviews/")), pr = ws.find((w) => w.path.startsWith("pullRequests/"));
    assert.equal(review.op, "set"); assert.equal(pr.op, "update");
    assert.deepEqual(keysOf(review), sorted(allowed), `${n}: review keys differ from the rules`);
    assert.equal(review.path, "reviews/<NEW_ID>");
    assert.equal(pr.data.lastReviewId, "<NEW_ID>");
    assert.equal(review.data.status, pr.data.status);
    assert.deepEqual(review.data.createdAt, { __serverTimestamp: true });
    assert.equal(review.data.ratings[review.data.category], review.data.rating);
    for (const v of Object.values(review.data.ratings)) assert.ok(Number.isInteger(v) && v >= 1 && v <= 5);
  }
});
test("legacy link is a batch of review updates that change ONLY authorId", () => {
  const ws = writesOf("lead.linkLegacyReviews");
  assert.equal(ws.length, 3);
  assert.ok(ws.every((w) => w.op === "update" && w.via === "batch" && w.path.startsWith("reviews/") && Object.keys(w.data).join() === "authorId"));
  assert.ok(ws.length <= 10, "batch exceeds the rules' document-access budget");
});
test("every write the app performs belongs to a captured scenario (no forgotten write path)", () => {
  const sources = ["js/register.js", "js/pr-actions.js", "js/review-pr.js"].map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");
  const found = [...sources.matchAll(/\b(addDoc|setDoc|updateDoc|deleteDoc|runTransaction|writeBatch)\(/g)].map((m) => m[1]);
  assert.ok(!found.includes("deleteDoc"), "the app deletes documents; the rules forbid it");
  const allSrc = fs.readdirSync(path.join(ROOT, "js")).filter((f) => f.endsWith(".js")).map((f) => fs.readFileSync(path.join(ROOT, "js", f), "utf8")).join("\n");
  const everywhere = new Set([...allSrc.matchAll(/\b(addDoc|setDoc|updateDoc|deleteDoc|runTransaction|writeBatch)\(/g)].map((m) => m[1]));
  assert.deepEqual([...everywhere].sort(), ["addDoc", "runTransaction", "setDoc", "updateDoc", "writeBatch"]);
  const pathsWritten = new Set(scenarios.flatMap((s) => s.writes.map((w) => `${w.op}:${w.path.split("/")[0]}`)));
  for (const p of ["set:users", "set:pullRequests", "update:pullRequests", "set:reviews", "update:reviews"]) assert.ok(pathsWritten.has(p), `no scenario covers ${p}`);
});
