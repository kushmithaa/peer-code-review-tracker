import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const pages = ["index.html", ...fs.readdirSync(path.join(ROOT, "pages")).map((f) => "pages/" + f)].filter((f) => f.endsWith(".html"));
const walkJs = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walkJs(dir + "/" + e.name) : e.name.endsWith(".js") ? [dir + "/" + e.name] : []);
const jsFiles = walkJs("js");

test("every JS file passes a syntax check", () => {
  for (const f of jsFiles) {
    const tmp = path.join(ROOT, "tests", "__syntax.mjs");
    fs.writeFileSync(tmp, read(f));
    try { execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" }); }
    catch (e) { assert.fail(`${f}: ${e.stderr}`); }
    finally { fs.rmSync(tmp, { force: true }); }
  }
});

test("every local href/src/import resolves to a real file", () => {
  for (const f of pages) {
    const html = read(f);
    for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const u = m[1];
      if (/^(https?:|mailto:|#)/.test(u)) continue;
      const clean = u.split("#")[0].split("?")[0];
      if (!clean) continue;
      assert.ok(fs.existsSync(path.join(ROOT, path.dirname(f), clean)), `${f}: broken link ${u}`);
    }
  }
  for (const f of jsFiles) {
    for (const m of read(f).matchAll(/from\s+"(\.[^"]+)"/g))
      assert.ok(fs.existsSync(path.join(ROOT, path.dirname(f), m[1])), `${f}: missing import ${m[1]}`);
  }
});

test("no placeholder href=\"#\" except the JS-managed GitHub button; hash links only for in-page views", () => {
  for (const f of pages) {
    const html = read(f);
    const bare = [...html.matchAll(/<a[^>]*href="#"[^>]*>/g)].map((m) => m[0]);
    for (const a of bare) assert.ok(/id="githubButton"/.test(a), `${f}: placeholder link ${a}`);
    for (const m of html.matchAll(/href="(#[a-z]+)"/g)) {
      if (m[1] === "#main") continue;                       // skip-to-content link
      assert.ok(/data-view=|class="view/.test(html), `${f}: hash link ${m[1]} without a view handler`);
    }
  }
});

test("every id a page's scripts use exists in that page's HTML", () => {
  const ALLOW = new Set(["linkLegacy", "toastHost"]);              // created dynamically on purpose
  // ids created inside JS templates (e.g. the shared "add pull request" form markup)
  const templated = new Set(jsFiles.flatMap((f) => [...read(f).matchAll(/\bid="([A-Za-z][\w-]*)"/g)].map((m) => m[1])));
  for (const f of pages) {
    const html = read(f);
    const src = /type="module"\s+src="([^"]+)"/.exec(html);
    if (!src) continue;
    const entry = "js/" + path.basename(src[1]);
    const code = [entry];
    const queue = [entry];
    while (queue.length) {                                         // follow local imports
      const cur = queue.pop();
      for (const m of read(cur).matchAll(/from\s+"\.\/([^"]+)"/g)) {
        const dep = "js/" + m[1];
        if (!code.includes(dep)) { code.push(dep); queue.push(dep); }
      }
    }
    // ids from the page script itself, plus pr-actions only if the page imports bindPrForm
    const used = new Set();
    for (const file of code) {
      if (file === "js/pr-actions.js" && !read(entry).includes("bindPrForm")) continue;
      if (["js/common.js", "js/ui.js", "js/skills.js", "js/github.js", "js/firebase-config.js"].includes(file) && file !== "js/common.js") continue;
      for (const m of read(file).matchAll(/(?:getElementById\(|\$\()\s*["'`]([A-Za-z][\w-]*)["'`]\s*\)/g)) used.add(m[1]);
      for (const m of read(file).matchAll(/\$\(\s*["'`]([A-Za-z][\w-]*)["'`]\s*\)/g)) used.add(m[1]);
      if (file === "js/pr-actions.js") for (const m of read(file).matchAll(/\$\("([A-Za-z]+)"\)/g)) used.add(m[1]);
    }
    // common.js ids are optional (legacy sidebar fallbacks) so skip them
    const commonOnly = new Set([...read("js/common.js").matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]));
    for (const id of used) {
      if (ALLOW.has(id) || templated.has(id)) continue;
      if (commonOnly.has(id) && !read(entry).includes(`"${id}"`)) continue;
      assert.ok(new RegExp(`id="${id}"`).test(html), `${f}: script needs #${id}, missing from HTML`);
    }
  }
});

test("each page loads exactly one page script; history page does not load dashboard script", () => {
  for (const f of pages) {
    const scripts = [...read(f).matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    const pageScripts = scripts.filter((x) => !x.endsWith("js/mode.js"));
    assert.equal(pageScripts.length, 1, `${f}: ${pageScripts.length} page scripts`);
    assert.ok(scripts.some((x) => x.endsWith("js/mode.js")), `${f}: mode.js bootstrap missing`);
    assert.ok(read(f).indexOf("js/mode.js") < read(f).indexOf(pageScripts[0]), `${f}: mode.js must load before the module`);
  }
  const h = read("pages/review-history.html");
  assert.ok(!h.includes("reviewer-dashboard.js"));
  assert.ok(h.includes("../js/review-history.js"));
  assert.match(h, /<title>My Review History/);
});

test("no hard-coded demo analytics, TODOs, empty handlers or placeholder text", () => {
  const files = [...jsFiles, ...pages];
  for (const f of files) {
    const s = read(f);
    assert.ok(!/Demonstration score|snapshot\.size \* 10/.test(s), `${f}: demo score`);
    assert.ok(!/TODO|FIXME|XXX/.test(s), `${f}: TODO marker`);
    assert.ok(!/Waiting for Firebase data/.test(s), `${f}: placeholder`);
    assert.ok(!/addEventListener\("click",\s*\(\)\s*=>\s*\{\s*\}\)/.test(s), `${f}: empty handler`);
    if (!/^js\/(demo\/|mode\.js)/.test(f)) assert.ok(!/localStorage|sessionStorage/.test(s), `${f}: browser storage`);
  }
  for (const f of ["pages/reviewer-dashboard.html", "pages/developer-dashboard.html", "pages/team-dashboard.html"]) {
    assert.ok(!/>\s*(10|0)%\s*</.test(read(f)), `${f}: static percentage`);
  }
});

test("pages use no role/email/UID hard-coding", () => {
  for (const f of jsFiles) {
    const s = read(f);
    assert.ok(!/arun\.review@example\.com|Kushmitha/.test(s), `${f}: hard-coded account`);
    assert.ok(!/uid\s*===?\s*["'][A-Za-z0-9]{20,}["']/.test(s), `${f}: hard-coded UID`);
  }
  for (const f of pages) assert.ok(!/>\s*Arun\s*<|Good morning, Arun/.test(read(f)), `${f}: hard-coded name`);
});

test("no secrets: no private keys, GitHub tokens or service accounts in the project", () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    ["node_modules", ".git"].includes(e.name) ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const file of walk(ROOT)) {
    if (/package-lock\.json$|static\.test\.mjs$/.test(file)) continue;
    const s = fs.readFileSync(file, "utf8");
    assert.ok(!/BEGIN (RSA |EC )?PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|github_pat_|"private_key"|client_secret/.test(s), `${file}: secret-like text`);
  }
  assert.ok(!fs.existsSync(path.join(ROOT, "serviceAccountKey.json")));
});

test("rules file exists, is not open, and covers every collection the app uses", () => {
  const rules = read("firestore.rules");
  assert.ok(!/allow [^;]*:\s*if\s+true/.test(rules), "open rule found");
  for (const c of ["users", "pullRequests", "reviews"]) assert.ok(rules.includes(`match /${c}/`), `no rules for ${c}`);
  const used = new Set();
  for (const f of jsFiles) for (const m of read(f).matchAll(/(?:collection\(db,\s*|queryDocs\(\s*|listDocs\(\s*|doc\(db,\s*)"(\w+)"/g)) used.add(m[1]);
  for (const c of used) assert.ok(["users", "pullRequests", "reviews"].includes(c), `app uses unknown collection ${c}`);
});

test("Firestore query fields used by pages are the ones the rules allow", () => {
  assert.match(read("js/developer-dashboard.js"), /queryDocs\("pullRequests", "authorId"/);
  assert.match(read("js/developer-dashboard.js"), /queryDocs\("reviews", "authorId"/);
  assert.match(read("js/reviewer-dashboard.js"), /queryDocs\("pullRequests", "reviewerId"/);
  assert.match(read("js/review-history.js"), /queryDocs\("reviews", "reviewerId"/);
});

test("firestore.rules lint: no open access, every collection closed to deletes, protected fields enforced", () => {
  const rules = read("firestore.rules");
  assert.match(rules, /rules_version = '2'/);
  assert.ok(!/allow[^;\n]*:\s*if\s+true/.test(rules), "an allow rule is unconditionally true");
  assert.ok(!/request\.time\s*<\s*timestamp/.test(rules), "time-limited test-mode rule left in");
  assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/, "no catch-all deny");
  for (const c of ["users", "pullRequests", "reviews"]) {
    const block = new RegExp(`match /${c}/\\{\\w+\\} \\{[\\s\\S]*?allow delete: if false;`).exec(rules);
    assert.ok(block, `${c}: deletes are not explicitly denied`);
  }
  // users: profile updates limited to `name`; creation limited to Developer/Reviewer
  assert.match(rules, /allow update: if signedIn\(\)\s*&& request\.auth\.uid == uid\s*&& changedKeys\(\)\.hasOnly\(\['name'\]\)/);
  assert.match(rules, /request\.resource\.data\.role in \['Developer', 'Reviewer'\]/);
  assert.ok(!/role in \[[^\]]*Team/.test(rules.split("match /pullRequests")[0]), "self-registration allows a Team role");
  // reviews: assigned reviewer, pending PR, server time, same-commit decision
  const create = /match \/reviews\/\{reviewId\}[\s\S]*?allow create:([\s\S]*?);\n/.exec(rules)[1];
  for (const needle of ["isReviewer()", "reviewerId == request.auth.uid", "request.time", "'Open', 'In Review'", "prAfter(", "authorId != request.auth.uid", "validRatings("])
    assert.ok(create.includes(needle), `review create rule is missing: ${needle}`);
  // every client-written timestamp must be server time
  assert.ok((rules.match(/== request\.time/g) || []).length >= 8);
});
