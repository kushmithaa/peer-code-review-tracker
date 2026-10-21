/*
 * Firestore Security Rules tests - run on the Firebase EMULATOR.
 *     npm run test:rules          (needs Java 11+; first run downloads the emulator)
 * Also runs automatically in GitHub Actions (.github/workflows/verify.yml).
 *
 * Three groups:
 *   1. hand-built allow / deny cases for every collection and role
 *   2. the app's REAL writes (tests/rules/app-payloads.json, captured from the running app)
 *      replayed as the correct user  -> must be ACCEPTED
 *   3. the same real writes replayed as the wrong users -> must be DENIED
 */
import { describe, it, before, after, beforeEach } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import {
    doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, writeBatch, runTransaction,
    serverTimestamp, Timestamp, deleteField
} from "firebase/firestore";
import { buildDemoDataset, reviveTimestamps } from "../../js/demo/dataset.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");
const DAY = 86_400_000;
let env;

before(async () => {
    env = await initializeTestEnvironment({
        projectId: "demo-pcrt-rules",
        firestore: { rules: fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8"), host, port: Number(port) }
    });
});
after(async () => { if (env) await env.cleanup(); });

const EMAILS = { dev1: "d1@x.com", dev2: "d2@x.com", rev1: "r1@x.com", rev2: "r2@x.com", lead: "l@x.com", oldlead: "o@x.com" };
/* Real sign-ins always carry an email claim; the profile-creation rule checks it. */
const as = (uid, email) => env.authenticatedContext(uid, { email: email || EMAILS[uid] || `${uid}@x.com` }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const ok = assertSucceeds, no = assertFails;

/* =============================================================== 1. hand-built cases */
describe("hand-built allow/deny cases", () => {
    const base = (id, o = {}) => ({
        title: "T " + id, number: 1, repository: "o/r", githubUrl: "https://github.com/o/r/pull/1", status: "Open",
        authorId: "dev1", authorName: "Dev One", reviewerId: "rev1", reviewerName: "Rev One", priority: "Medium", ...o
    });

    beforeEach(async () => {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async (ctx) => {
            const db = ctx.firestore(); const put = (p, d) => setDoc(doc(db, p), d);
            const u = (uid, name, role) => put(`users/${uid}`, { uid, name, email: EMAILS[uid], role, createdAt: "2026-01-01" });
            await u("dev1", "Dev One", "Developer"); await u("dev2", "Dev Two", "Developer");
            await u("rev1", "Rev One", "Reviewer"); await u("rev2", "Rev Two", "Reviewer");
            await u("lead", "Lead", "Team Lead"); await u("oldlead", "Old Lead", "Team");
            await put("pullRequests/pr_open", base("pr_open"));
            await put("pullRequests/pr_inreview", base("pr_inreview", { status: "In Review" }));
            await put("pullRequests/pr_approved", base("pr_approved", { status: "Approved" }));
            await put("pullRequests/pr_changes", base("pr_changes", { status: "Changes Requested" }));
            await put("pullRequests/pr_other", base("pr_other", { authorId: "dev2", authorName: "Dev Two", reviewerId: "rev2", reviewerName: "Rev Two" }));
            await put("pullRequests/pr_unassigned", base("pr_unassigned", { reviewerId: null, reviewerName: null }));
            await put("pullRequests/pr_self", base("pr_self", { authorId: "rev1", authorName: "Rev One" }));          // reviewer is also the author
            await put("pullRequests/pr_noauthor", (({ authorId, authorName, ...r }) => r)(base("pr_noauthor")));        // legacy: no author
            await put("pullRequests/pr_nostatus", (({ status, ...r }) => r)(base("pr_nostatus")));                      // legacy: no status
            const rv = (o) => ({ pullRequestId: "pr_approved", pullRequestTitle: "T pr_approved", pullRequestNumber: 1, repository: "o/r",
                githubUrl: "https://github.com/o/r/pull/1", authorId: "dev1", authorName: "Dev One", reviewerId: "rev1", reviewerName: "Rev One",
                category: "Testing", rating: 4, ratings: { Testing: 4 }, feedback: "ok", status: "Approved", createdAt: Timestamp.now(), ...o });
            await put("reviews/rv1", rv({}));
            await put("reviews/rv_other", rv({ pullRequestId: "pr_other", authorId: "dev2", reviewerId: "rev2", ratings: { Testing: 2 }, rating: 2 }));
            await put("reviews/rv_legacy", (({ authorId, ...r }) => r)(rv({})));                                        // no authorId, PR has dev1
            await put("reviews/rv_legacy_noauthor", (({ authorId, ...r }) => r)(rv({ pullRequestId: "pr_noauthor" })));  // PR has no author either
        });
    });

    /* ---- payload builders ---- */
    const review = (prId = "pr_open", over = {}) => ({
        pullRequestId: prId, pullRequestTitle: "T " + prId, pullRequestNumber: 1, repository: "o/r", githubUrl: "https://github.com/o/r/pull/1",
        authorId: "dev1", authorName: "Dev One", reviewerId: "rev1", reviewerName: "Rev One", category: "Testing", rating: 4,
        ratings: { Testing: 4, "Code Quality": 3 }, feedback: "Looks good, add one more test.", status: "Approved", createdAt: serverTimestamp(), ...over
    });
    const decision = (over = {}) => ({ status: "Approved", lastReviewId: "rvNew", lastReviewedAt: serverTimestamp(), updatedAt: serverTimestamp(), ...over });
    const newPr = (over = {}) => ({
        title: "New PR", description: "d", number: 5, repository: "o/r", repositoryUrl: "https://github.com/o/r",
        githubUrl: "https://github.com/o/r/pull/5", status: "Open", priority: "High", dueDate: null,
        authorId: "dev1", authorName: "Dev One", reviewerId: null, reviewerName: null, source: "manual",
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...over
    });
    /* The app's review submission: review + PR decision committed together. */
    const submit = (uid, prId, reviewOver = {}, decisionOver = {}) => {
        const db = as(uid); const b = writeBatch(db);
        b.set(doc(db, "reviews/rvNew"), review(prId, reviewOver));
        b.update(doc(db, `pullRequests/${prId}`), decision(decisionOver));
        return b.commit();
    };

    it("unauthenticated users cannot read or write anything", async () => {
        const db = anon();
        await no(getDoc(doc(db, "users/dev1"))); await no(getDoc(doc(db, "pullRequests/pr_open"))); await no(getDocs(collection(db, "reviews")));
        await no(setDoc(doc(db, "pullRequests/x"), newPr()));
        await no(setDoc(doc(db, "users/n"), { uid: "n", name: "N", email: "n@x.com", role: "Developer", createdAt: "x" }));
    });

    /* ------------------------------- users ------------------------------- */
    it("users: read own profile; others denied; Team Lead (and legacy 'Team') may read all", async () => {
        await ok(getDoc(doc(as("dev1"), "users/dev1")));
        await no(getDoc(doc(as("dev1"), "users/dev2"))); await no(getDoc(doc(as("rev1"), "users/dev1")));
        await no(getDocs(collection(as("dev1"), "users")));
        await ok(getDoc(doc(as("lead"), "users/dev1"))); await ok(getDocs(collection(as("lead"), "users"))); await ok(getDocs(collection(as("oldlead"), "users")));
    });
    it("users: self-registration is Developer/Reviewer only, own uid, exact fields, authenticated email", async () => {
        const mk = (uid, o = {}) => ({ uid, name: "N", email: `${uid}@x.com`, role: "Developer", createdAt: "2026-01-01", ...o });
        await ok(setDoc(doc(as("n1"), "users/n1"), mk("n1")));
        await ok(setDoc(doc(as("n2"), "users/n2"), mk("n2", { role: "Reviewer" })));
        await ok(setDoc(doc(as("n3", "Mixed.Case@X.com"), "users/n3"), mk("n3", { email: "mixed.case@x.com" })));      // email compared case-insensitively
        await no(setDoc(doc(as("n4"), "users/n4"), mk("n4", { role: "Team Lead" })));
        await no(setDoc(doc(as("n5"), "users/n5"), mk("n5", { role: "Team" })));
        await no(setDoc(doc(as("n6"), "users/n6"), mk("n6", { role: "Admin" })));
        await no(setDoc(doc(as("n7"), "users/someoneElse"), mk("someoneElse")));                                      // another uid
        await no(setDoc(doc(as("n8"), "users/n8"), mk("n8", { uid: "other" })));                                      // uid field mismatch
        await no(setDoc(doc(as("n9"), "users/n9"), mk("n9", { isAdmin: true })));                                     // extra field
        await no(setDoc(doc(as("n10"), "users/n10"), mk("n10", { email: "someone.else@x.com" })));                   // claiming another email
        await no(setDoc(doc(as("n11"), "users/n11"), mk("n11", { name: "" })));
        await no(setDoc(doc(as("n12"), "users/n12"), mk("n12", { name: "x".repeat(101) })));
        await no(setDoc(doc(as("n13"), "users/n13"), mk("n13", { createdAt: serverTimestamp() })));                  // wrong type
        const missing = mk("n14"); delete missing.name; await no(setDoc(doc(as("n14"), "users/n14"), missing));
    });
    it("users: only `name` is editable - role, uid, email, createdAt and any other field are protected", async () => {
        const d = (uid) => doc(as(uid), `users/${uid}`);
        await ok(updateDoc(d("dev1"), { name: "Renamed" }));
        await no(updateDoc(d("dev1"), { name: "" })); await no(updateDoc(d("dev1"), { name: 5 })); await no(updateDoc(d("dev1"), { name: "x".repeat(101) }));
        await no(updateDoc(d("dev1"), { role: "Team Lead" })); await no(updateDoc(d("dev1"), { role: "Team" })); await no(updateDoc(d("dev1"), { role: "Reviewer" }));
        await no(updateDoc(d("rev1"), { role: "Team Lead" }));
        await no(updateDoc(d("dev1"), { uid: "lead" })); await no(updateDoc(d("dev1"), { email: "new@x.com" })); await no(updateDoc(d("dev1"), { createdAt: "2030-01-01" }));
        await no(updateDoc(d("dev1"), { isAdmin: true })); await no(updateDoc(d("dev1"), { demo: true }));
        await no(updateDoc(d("dev1"), { name: "Renamed", role: "Team Lead" }));                                       // safe + unsafe together
        await no(updateDoc(d("dev1"), { role: deleteField() }));                                                      // removing a field is also a change
        await no(updateDoc(doc(as("dev1"), "users/dev2"), { name: "Hacked" }));                                       // someone else's profile
        await no(updateDoc(doc(as("lead"), "users/dev1"), { role: "Team Lead" }));                                    // even a lead cannot via the client
        await no(updateDoc(doc(as("lead"), "users/dev1"), { name: "Renamed by lead" }));
        await no(deleteDoc(doc(as("dev1"), "users/dev1"))); await no(deleteDoc(doc(as("lead"), "users/dev1")));
    });

    /* --------------------------- pull requests: read --------------------------- */
    it("pull requests: read access and query scoping by role", async () => {
        await ok(getDoc(doc(as("dev1"), "pullRequests/pr_open")));  await no(getDoc(doc(as("dev2"), "pullRequests/pr_open")));
        await ok(getDoc(doc(as("rev1"), "pullRequests/pr_open")));  await no(getDoc(doc(as("rev2"), "pullRequests/pr_open")));
        await ok(getDoc(doc(as("lead"), "pullRequests/pr_open")));  await ok(getDocs(collection(as("lead"), "pullRequests")));
        await no(getDocs(collection(as("dev1"), "pullRequests")));
        await ok(getDocs(query(collection(as("dev1"), "pullRequests"), where("authorId", "==", "dev1"))));
        await no(getDocs(query(collection(as("dev1"), "pullRequests"), where("authorId", "==", "dev2"))));
        await ok(getDocs(query(collection(as("rev1"), "pullRequests"), where("reviewerId", "==", "rev1"))));
        await no(getDocs(query(collection(as("rev1"), "pullRequests"), where("reviewerId", "==", "rev2"))));
    });

    /* --------------------------- pull requests: create --------------------------- */
    it("pull requests: a developer may add only their own, Open, unassigned PR with a valid shape", async () => {
        const db = as("dev1"); const put = (id, o) => setDoc(doc(db, `pullRequests/${id}`), newPr(o));
        await ok(put("c1", {}));
        await ok(put("c2", { dueDate: Timestamp.fromMillis(Date.now() + 5 * DAY), source: "github", githubUrl: "https://github.com/o/r/pull/9", number: 9 }));
        await no(put("c3", { authorId: "dev2", authorName: "Dev Two" }));                                  // for someone else
        await no(put("c4", { authorName: "Somebody Else" }));                                              // forged display name
        await no(put("c5", { reviewerId: "rev1" }));                                                       // self-assigning
        await no(put("c6", { reviewerName: "Rev One" }));
        await no(put("c7", { status: "Approved" })); await no(put("c8", { status: "In Review" }));
        await no(put("c9", { priority: "Urgent" })); await no(put("c10", { githubUrl: "https://evil.com/o/r/pull/1" }));
        await no(put("c11", { githubUrl: "javascript:alert(1)" })); await no(put("c12", { githubUrl: "https://github.com/o/r/issues/1" }));
        await no(put("c13", { title: "" })); await no(put("c14", { title: "x".repeat(201) })); await no(put("c15", { description: "x".repeat(2001) }));
        await no(put("c16", { number: "5" })); await no(put("c17", { number: 0 })); await no(put("c18", { number: 1.5 }));
        await no(put("c19", { dueDate: "tomorrow" })); await no(put("c20", { source: "hacked" }));
        await no(put("c21", { createdAt: Timestamp.fromMillis(1000) })); await no(put("c22", { updatedAt: Timestamp.fromMillis(1000) }));   // forged timestamps
        await no(put("c23", { assignedAt: serverTimestamp() })); await no(put("c24", { lastReviewedAt: serverTimestamp() }));
        await no(put("c25", { demo: true })); await no(put("c26", { isApproved: true }));                                                  // unknown fields
        const noTitle = newPr(); delete noTitle.title; await no(setDoc(doc(db, "pullRequests/c27"), noTitle));
        await no(setDoc(doc(as("rev1"), "pullRequests/r1"), newPr({ authorId: "rev1", authorName: "Rev One" })));   // reviewers cannot create
    });
    it("pull requests: the Team Lead can create valid PRs, but only referencing real Developers/Reviewers", async () => {
        const put = (uid, id, o) => setDoc(doc(as(uid), `pullRequests/${id}`), newPr(o));
        await ok(put("lead", "l1", {})); await ok(put("oldlead", "l2", {})); await ok(put("lead", "l3", { reviewerId: "rev1", reviewerName: "Rev One", status: "In Review" }));
        await no(put("lead", "l4", { status: "Pending" })); await no(put("lead", "l5", { priority: "Critical" }));
        await no(put("lead", "l6", { authorId: "rev1", authorName: "Rev One" }));                          // author must be a Developer
        await no(put("lead", "l7", { authorId: "ghost", authorName: "Ghost" }));                           // nonexistent user
        await no(put("lead", "l8", { reviewerId: "dev1", reviewerName: "Dev One" }));                      // reviewer must be a Reviewer
        await no(put("lead", "l9", { reviewerId: "ghost" }));
        await no(put("lead", "l10", { createdAt: Timestamp.fromMillis(5) }));
    });

    /* --------------------------- pull requests: update --------------------------- */
    it("pull requests: a decision is allowed ONLY for the assigned reviewer, on a pending PR, together with its review", async () => {
        await ok(submit("rev1", "pr_open"));
        await ok(submit("rev1", "pr_inreview", { status: "Changes Requested" }, { status: "Changes Requested" }));
        await ok(submit("rev1", "pr_noauthor", { authorId: null, authorName: null }));                      // legacy PR without author
        await no(submit("rev1", "pr_approved"));                                                            // already decided
        await no(submit("rev1", "pr_changes"));
        await no(submit("rev1", "pr_nostatus"));                                                            // legacy PR without status
        await no(submit("rev2", "pr_open", { reviewerId: "rev2", reviewerName: "Rev Two" }));               // not assigned
        await no(submit("rev1", "pr_unassigned"));
        await no(submit("rev1", "pr_self", { authorId: "rev1", authorName: "Rev One" }));                   // reviewing your own PR
        await no(submit("dev1", "pr_open", { reviewerId: "dev1", reviewerName: "Dev One" }));               // developer
        await no(submit("lead", "pr_open", { reviewerId: "lead", reviewerName: "Lead" }));                  // team lead
    });
    it("pull requests: a decision cannot be recorded without its review, or with a mismatching one", async () => {
        const db = as("rev1");
        await no(updateDoc(doc(db, "pullRequests/pr_open"), decision()));                                   // no review at all
        await no(updateDoc(doc(db, "pullRequests/pr_open"), { status: "Approved", lastReviewedAt: serverTimestamp(), updatedAt: serverTimestamp() }));   // no lastReviewId
        await no(updateDoc(doc(db, "pullRequests/pr_open"), decision({ lastReviewId: "rv1" })));            // points at an old review of another PR
        await no(updateDoc(doc(db, "pullRequests/pr_open"), decision({ lastReviewId: 5 })));
        const b1 = writeBatch(db);                                                                          // decision says Approved, review says Changes Requested
        b1.set(doc(db, "reviews/rvNew"), review("pr_open", { status: "Changes Requested" })); b1.update(doc(db, "pullRequests/pr_open"), decision());
        await no(b1.commit());
        const b2 = writeBatch(db);                                                                          // someone else's review id
        b2.set(doc(db, "reviews/rvNew"), review("pr_open")); b2.update(doc(db, "pullRequests/pr_open"), decision({ lastReviewId: "rv_other" }));
        await no(b2.commit());
        await no(submit("rev1", "pr_open", {}, { status: "Merged" }));                                      // not a review decision
        await no(submit("rev1", "pr_open", {}, { status: "Open" }));
        await no(submit("rev1", "pr_open", {}, { reviewerId: "rev2" }));                                    // sneaking in a reassignment
        await no(submit("rev1", "pr_open", {}, { title: "Renamed" }));
        await no(submit("rev1", "pr_open", {}, { lastReviewedAt: Timestamp.fromMillis(1000) }));            // forged timestamps
        await no(submit("rev1", "pr_open", {}, { updatedAt: Timestamp.fromMillis(1000) }));
    });
    it("pull requests: only the Team Lead changes assignments, and only to real users with the right role", async () => {
        const L = (id, patch, uid = "lead") => updateDoc(doc(as(uid), `pullRequests/${id}`), { updatedAt: serverTimestamp(), ...patch });
        await ok(L("pr_unassigned", { reviewerId: "rev2", reviewerName: "Rev Two", assignedAt: serverTimestamp() }));
        await ok(L("pr_open", { reviewerId: null, reviewerName: null }));                                    // unassign
        await ok(L("pr_open", { authorId: "dev2", authorName: "Dev Two" }));
        await ok(L("pr_approved", { status: "Open" }));                                                      // reopen
        await ok(L("pr_nostatus", { status: "Open" }));                                                      // repair a legacy PR
        await ok(L("pr_nostatus", { reviewerId: "rev2", reviewerName: "Rev Two" }));                         // assign without touching status
        await ok(L("pr_approved", { status: "Merged" }));
        await ok(L("pr_open", { title: "Better title", priority: "Low", dueDate: null, description: "d" }, "oldlead"));
        await no(L("pr_open", { status: "Approved" })); await no(L("pr_open", { status: "Changes Requested" })); await no(L("pr_open", { status: "In Review" }));
        await no(L("pr_changes", { status: "Merged" }));                                                     // only Approved can become Merged
        await no(L("pr_open", { status: "Pending" })); await no(L("pr_open", { priority: "Urgent" })); await no(L("pr_open", { title: "" }));
        await no(L("pr_open", { reviewerId: "dev1", reviewerName: "Dev One" }));                             // reviewer must have the Reviewer role
        await no(L("pr_open", { reviewerId: "ghost", reviewerName: "Ghost" }));
        await no(L("pr_open", { authorId: "rev1", authorName: "Rev One" }));                                 // author must be a Developer
        await no(L("pr_open", { assignedAt: Timestamp.fromMillis(1000) }));
        await no(updateDoc(doc(as("lead"), "pullRequests/pr_open"), { reviewerId: "rev2" }));               // updatedAt not refreshed with server time
        await no(L("pr_open", { createdAt: serverTimestamp() })); await no(L("pr_open", { githubUrl: "https://github.com/o/r/pull/99" }));
        await no(L("pr_open", { number: 99 })); await no(L("pr_open", { lastReviewId: "x" })); await no(L("pr_open", { lastReviewedAt: serverTimestamp() })); await no(L("pr_open", { demo: true }));
        await no(L("pr_open", { reviewerId: "rev2" }, "dev1")); await no(L("pr_unassigned", { reviewerId: "rev1" }, "dev1"));   // developers
        await no(L("pr_open", { reviewerId: "rev2" }, "rev1"));                                              // reviewers
    });
    it("pull requests: a developer may only request a re-review of their own Changes Requested PR", async () => {
        const D = (uid, id, patch) => updateDoc(doc(as(uid), `pullRequests/${id}`), { updatedAt: serverTimestamp(), ...patch });
        await ok(D("dev1", "pr_changes", { status: "In Review" }));
        await no(D("dev1", "pr_approved", { status: "In Review" })); await no(D("dev1", "pr_open", { status: "In Review" }));
        await no(D("dev1", "pr_changes", { status: "Approved" })); await no(D("dev1", "pr_changes", { status: "Open" }));
        await no(D("dev2", "pr_changes", { status: "In Review" }));
        await no(D("dev1", "pr_changes", { status: "In Review", title: "Renamed" })); await no(D("dev1", "pr_changes", { status: "In Review", reviewerId: "rev2" }));
        await no(updateDoc(doc(as("dev1"), "pullRequests/pr_changes"), { status: "In Review", updatedAt: Timestamp.fromMillis(1000) }));
    });
    it("pull requests: nobody can delete", async () => {
        for (const uid of ["dev1", "rev1", "lead", "oldlead"]) await no(deleteDoc(doc(as(uid), "pullRequests/pr_open")));
    });

    /* ------------------------------- reviews ------------------------------- */
    it("reviews: the assigned reviewer can submit valid reviews (any mix of the six categories)", async () => {
        await ok(submit("rev1", "pr_open"));
        await ok(submit("rev1", "pr_inreview", { ratings: { "Code Quality": 5 }, category: "Code Quality", rating: 5, status: "Changes Requested" }, { status: "Changes Requested" }));
        await ok(submit("rev1", "pr_open", { ratings: { Readability: 3, Performance: 2, Security: 4, Testing: 4, Documentation: 3, "Code Quality": 3 }, category: "Readability", rating: 3 }));
    });
    it("reviews: a review cannot be created on its own (the PR must move to the same decision in the same commit)", async () => {
        await no(setDoc(doc(as("rev1"), "reviews/solo"), review("pr_open")));
        await no(setDoc(doc(as("rev1"), "reviews/solo2"), review("pr_approved")));                          // already decided PR
    });
    it("reviews: forged identity, content or denormalised data is denied", async () => {
        const T = (reviewOver) => submit("rev1", "pr_open", reviewOver);
        await no(T({ reviewerId: "rev2" })); await no(T({ reviewerName: "Rev Two" }));                      // impersonation
        await no(T({ authorId: "dev2" })); await no(T({ authorName: "Dev Two" })); await no(T({ authorId: null }));
        await no(T({ pullRequestTitle: "Another title" })); await no(T({ pullRequestNumber: 99 })); await no(T({ repository: "x/y" }));
        await no(T({ githubUrl: "https://github.com/x/y/pull/1" })); await no(T({ pullRequestId: "pr_other" }));
        await no(T({ rating: 6, ratings: { Testing: 6 } })); await no(T({ rating: 0, ratings: { Testing: 0 } }));
        await no(T({ rating: 3.5, ratings: { Testing: 3.5 } })); await no(T({ ratings: { Testing: "4" } }));
        await no(T({ ratings: { Style: 4 }, category: "Style" })); await no(T({ category: "Security" }));    // not in ratings
        await no(T({ rating: 5 })); await no(T({ ratings: {} })); await no(T({ ratings: [4] }));
        await no(T({ feedback: "" })); await no(T({ feedback: "x".repeat(5001) })); await no(T({ feedback: 7 }));
        await no(T({ status: "Merged" })); await no(T({ status: "Open" }));
        await no(T({ createdAt: Timestamp.fromMillis(1000) })); await no(T({ createdAt: Timestamp.now() })); // never client time
        await no(T({ demo: true })); await no(T({ approved: true }));                                       // unknown fields
        const noRatings = review("pr_open"); delete noRatings.ratings;
        const db = as("rev1"); const b = writeBatch(db); b.set(doc(db, "reviews/rvNew"), noRatings); b.update(doc(db, "pullRequests/pr_open"), decision());
        await no(b.commit());
        const noKey = review("pr_open"); delete noKey.githubUrl;
        const b2 = writeBatch(db); b2.set(doc(db, "reviews/rvNew"), noKey); b2.update(doc(db, "pullRequests/pr_open"), decision());
        await no(b2.commit());
    });
    it("reviews: developers and Team Leads cannot submit reviews, nor anonymous users", async () => {
        await no(setDoc(doc(as("dev1"), "reviews/d1"), review("pr_open", { reviewerId: "dev1", reviewerName: "Dev One" })));
        await no(setDoc(doc(as("lead"), "reviews/l1"), review("pr_open", { reviewerId: "lead", reviewerName: "Lead" })));
        await no(setDoc(doc(anon(), "reviews/a1"), review("pr_open")));
    });
    it("reviews: read access and query scoping by role", async () => {
        await ok(getDoc(doc(as("rev1"), "reviews/rv1"))); await ok(getDoc(doc(as("dev1"), "reviews/rv1"))); await ok(getDoc(doc(as("lead"), "reviews/rv1")));
        await no(getDoc(doc(as("dev2"), "reviews/rv1"))); await no(getDoc(doc(as("rev2"), "reviews/rv1")));
        await ok(getDocs(collection(as("lead"), "reviews"))); await no(getDocs(collection(as("dev1"), "reviews")));
        await ok(getDocs(query(collection(as("dev1"), "reviews"), where("authorId", "==", "dev1"))));
        await no(getDocs(query(collection(as("dev1"), "reviews"), where("authorId", "==", "dev2"))));
        await ok(getDocs(query(collection(as("rev1"), "reviews"), where("reviewerId", "==", "rev1"))));
        await no(getDocs(query(collection(as("rev1"), "reviews"), where("reviewerId", "==", "rev2"))));
    });
    it("reviews: saved reviews are immutable; the Team Lead may only fill in a missing authorId taken from the PR", async () => {
        const U = (uid, id, patch) => updateDoc(doc(as(uid), `reviews/${id}`), patch);
        for (const [uid, patch] of [["rev1", { feedback: "edited" }], ["rev1", { rating: 5 }], ["dev1", { rating: 5, ratings: { Testing: 5 } }], ["lead", { feedback: "edited" }], ["lead", { status: "Approved" }], ["lead", { createdAt: serverTimestamp() }]])
            await no(U(uid, "rv1", patch));
        await ok(U("lead", "rv_legacy", { authorId: "dev1" })); await ok(U("oldlead", "rv_legacy", { authorId: "dev1" }));          // fills the gap from the PR's author
        await no(U("lead", "rv_legacy", { authorId: "dev2" }));                                              // not the PR's author
        await no(U("lead", "rv1", { authorId: "dev2" })); await no(U("lead", "rv1", { authorId: "dev1" }));  // already linked: no overwrite
        await no(U("lead", "rv_legacy_noauthor", { authorId: "dev1" }));                                     // its PR has no author
        await no(U("lead", "rv_legacy", { authorId: "dev1", feedback: "x" })); await no(U("lead", "rv_legacy", { authorId: null }));
        await no(U("dev1", "rv_legacy", { authorId: "dev1" })); await no(U("rev1", "rv_legacy", { authorId: "dev1" }));   // only the Team Lead
        for (const uid of ["dev1", "rev1", "lead"]) await no(deleteDoc(doc(as(uid), "reviews/rv1")));
    });
    it("collections without rules are closed to everyone", async () => {
        await no(setDoc(doc(as("lead"), "secrets/x"), { a: 1 })); await no(getDoc(doc(as("lead"), "secrets/x"))); await no(getDocs(collection(as("lead"), "secrets")));
    });
});

/* ======================================== 2 + 3. replay of the app's REAL writes */
const captured = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "rules", "app-payloads.json"), "utf8")).scenarios;

async function seedDataset(prepare) {
    await env.clearFirestore();
    const data = buildDemoDataset(Date.now());
    const revive = (d) => reviveTimestamps(d, (ms) => Timestamp.fromMillis(ms));
    await env.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        for (const u of data.users) await setDoc(doc(db, `users/${u.id}`), revive(u.data));
        for (const p of data.pullRequests) await setDoc(doc(db, `pullRequests/${p.id}`), revive(p.data));
        for (const r of data.reviews) await setDoc(doc(db, `reviews/${r.id}`), revive(r.data));
        if (prepare === "stripReviewAuthorIds") for (const id of ["demo_rv_01", "demo_rv_02", "demo_rv_03"]) await updateDoc(doc(db, `reviews/${id}`), { authorId: deleteField() });
    });
    return data;
}

const revivePayload = (v, newId) => {
    if (Array.isArray(v)) return v.map((x) => revivePayload(x, newId));
    if (v && typeof v === "object") {
        if (v.__serverTimestamp) return serverTimestamp();
        if ("__tsFromNowDays" in v) return Timestamp.fromMillis(Date.now() + v.__tsFromNowDays * DAY);
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revivePayload(x, newId)]));
    }
    return typeof v === "string" ? v.split("<NEW_ID>").join(newId) : v;
};

/* Executes exactly what the app did: single writes, a batch, or a transaction (re-reading the PR first). */
async function replay(scenario, uid, email) {
    const db = as(uid, email);
    const newId = "replay_" + scenario.name.replace(/\W/g, "_");
    const writes = scenario.writes.map((w) => ({ ...w, path: w.path.split("<NEW_ID>").join(newId), data: revivePayload(w.data, newId) }));
    const apply = (target, w) => (w.op === "set" ? target.set(doc(db, w.path), w.data) : target.update(doc(db, w.path), w.data));
    if (!writes.some((w) => w.group)) {
        for (const w of writes) await (w.op === "set" ? setDoc(doc(db, w.path), w.data) : updateDoc(doc(db, w.path), w.data));
    } else if (writes[0].via === "transaction") {
        await runTransaction(db, async (tx) => {
            for (const w of writes.filter((x) => x.op === "update")) await tx.get(doc(db, w.path));
            writes.forEach((w) => apply(tx, w));
        });
    } else {
        const batch = writeBatch(db); writes.forEach((w) => apply(batch, w)); await batch.commit();
    }
}

const registerEmail = (s) => s.writes[0].data.email;
/* Users who legitimately could repeat a PR creation (a Team Lead may create any valid PR). */
const ALSO_ALLOWED = { "developer.addPullRequest": ["demo-meera"], "lead.addPullRequest": ["demo-rahul"] };   // Rahul is that PR's author, so the same payload is valid for him

describe("replay of the app's real writes as the CORRECT user is accepted", () => {
    for (const s of captured) {
        it(`${s.name}`, async () => {
            await seedDataset(s.prepare);
            await ok(replay(s, s.actor, s.name.startsWith("register.") ? registerEmail(s) : undefined));
        });
    }
});

describe("replay of the same real writes as the WRONG user is denied", () => {
    for (const s of captured) {
        it(`${s.name}`, async () => {
            const data = buildDemoDataset(Date.now());
            const wrong = data.users.filter((u) => u.id !== s.actor && !(ALSO_ALLOWED[s.name] || []).includes(u.id));
            const targets = s.name.startsWith("register.") ? [{ id: "demo-rahul", data: { email: "rahul.developer@example.com" } }, { id: "intruder", data: { email: registerEmail(s) } }] : wrong;
            for (const u of targets) {
                await seedDataset(s.prepare);
                await no(replay(s, u.id, u.data.email));
            }
        });
    }
});
