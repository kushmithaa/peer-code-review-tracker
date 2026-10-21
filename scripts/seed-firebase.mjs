#!/usr/bin/env node
/*
 * FIREBASE SEED MODE - writes the demonstration dataset to Firebase.
 *
 * SAFE BY DEFAULT
 *   - Without --confirm it is a DRY RUN: nothing is contacted or written.
 *   - Writing requires  --confirm <projectId>  to exactly match  --project <projectId>.
 *   - Only the project "peer-code-review-tracker" is accepted (or the local emulator).
 *   - Never overwrites or deletes: existing Auth users, user profiles and demo
 *     documents are skipped. Safe to run again.
 *   - Demo documents are clearly marked: ids start with "demo_", and every record has
 *     demo: true and demoNamespace: "pcrt-demo-v1".
 *   - No passwords are created or printed. New Auth users get NO password; a password-reset
 *     link is printed so each person can choose their own.
 *
 * USAGE (see README.md)
 *   node scripts/seed-firebase.mjs --project peer-code-review-tracker                       (dry run)
 *   node scripts/seed-firebase.mjs --project peer-code-review-tracker --confirm peer-code-review-tracker
 *   node scripts/seed-firebase.mjs --emulator --project demo-pcrt --confirm demo-pcrt       (local emulator)
 */
import { fileURLToPath } from "node:url";
import { buildDemoDataset, reviveTimestamps, DEMO_USERS, DEMO_NAMESPACE } from "../js/demo/dataset.js";

export const ALLOWED_PROJECT = "peer-code-review-tracker";

/*
 * adapter: {
 *   getAuthUserByEmail(email) -> { uid } | null
 *   createAuthUser({ email, displayName }) -> { uid }
 *   passwordResetLink(email) -> string | null
 *   createDoc(path, data) -> "created" | "exists"
 *   makeTimestamp(ms)
 * }
 */
/* Safety checks. Run BEFORE any credential or network access. */
export function assertTarget({ projectId, confirm, emulator = false }) {
    if (!projectId) throw new Error("--project is required.");
    if (!emulator && projectId !== ALLOWED_PROJECT) {
        throw new Error(`Refusing to run: this seed only targets "${ALLOWED_PROJECT}" (got "${projectId}"). Use --emulator for a local emulator.`);
    }
    if (confirm !== undefined && confirm !== projectId) {
        throw new Error(`Refusing to write: --confirm must equal the project id "${projectId}".`);
    }
}

export async function runSeed({ adapter, projectId, confirm, emulator = false, nowMs = Date.now(), log = () => {} }) {
    assertTarget({ projectId, confirm, emulator });

    const sample = buildDemoDataset(nowMs);
    const plan = { users: sample.users.length, pullRequests: sample.pullRequests.length, reviews: sample.reviews.length };

    if (confirm === undefined) {
        return { dryRun: true, projectId, plan, wrote: false };
    }

    const report = {
        dryRun: false, projectId, plan, wrote: true,
        auth: { created: 0, existing: 0 }, users: { created: 0, skipped: 0 },
        pullRequests: { created: 0, skipped: 0 }, reviews: { created: 0, skipped: 0 },
        resetLinks: []
    };

    /* 1. Resolve every Auth uid FIRST. If this fails, nothing is written to Firestore. */
    const uidByEmail = {};
    for (const u of DEMO_USERS) {
        const existing = await adapter.getAuthUserByEmail(u.email);
        if (existing) {
            uidByEmail[u.email] = existing.uid;
            report.auth.existing += 1;
            log(`Auth: ${u.email} already exists - reusing, not modified`);
        } else {
            const created = await adapter.createAuthUser({ email: u.email, displayName: u.name });
            uidByEmail[u.email] = created.uid;
            report.auth.created += 1;
            log(`Auth: created ${u.email} (no password set)`);
            const link = await adapter.passwordResetLink(u.email);
            if (link) report.resetLinks.push({ email: u.email, link });
        }
    }

    /* 2. Firestore documents, create-if-absent only. */
    const data = buildDemoDataset(nowMs, { uidByEmail });
    const revive = (d) => reviveTimestamps(d, (ms) => adapter.makeTimestamp(ms));
    const put = async (bucket, path, doc) => {
        const result = await adapter.createDoc(path, revive(doc));
        report[bucket][result === "created" ? "created" : "skipped"] += 1;
    };
    for (const u of data.users) await put("users", `users/${u.id}`, u.data);
    for (const p of data.pullRequests) await put("pullRequests", `pullRequests/${p.id}`, p.data);
    for (const r of data.reviews) await put("reviews", `reviews/${r.id}`, r.data);

    return report;
}

/* ---------------------------- CLI ---------------------------- */

function parseArgs(argv) {
    const out = { emulator: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--emulator") out.emulator = true;
        else if (a === "--project") out.project = argv[++i];
        else if (a === "--confirm") out.confirm = argv[++i];
        else if (a === "--help" || a === "-h") out.help = true;
        else throw new Error(`Unknown argument: ${a}`);
    }
    return out;
}

async function firebaseAdminAdapter({ projectId, emulator }) {
    if (emulator) {
        process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
        process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";
    }
    let admin;
    try { admin = await import("firebase-admin"); }
    catch { throw new Error('The "firebase-admin" package is missing. Run:  npm install'); }

    const app = admin.default.initializeApp({ projectId });
    const auth = admin.default.auth(app);
    const db = admin.default.firestore(app);
    const { Timestamp } = admin.default.firestore;

    return {
        async getAuthUserByEmail(email) {
            try { const u = await auth.getUserByEmail(email); return { uid: u.uid }; }
            catch (e) { if (e.code === "auth/user-not-found") return null; throw e; }
        },
        async createAuthUser({ email, displayName }) {
            const u = await auth.createUser({ email, displayName, emailVerified: false, disabled: false });   // no password
            return { uid: u.uid };
        },
        async passwordResetLink(email) {
            try { return await auth.generatePasswordResetLink(email); } catch { return null; }
        },
        async createDoc(path, data) {
            try { await db.doc(path).create(data); return "created"; }
            catch (e) { if (e.code === 6 || /already exists/i.test(e.message || "")) return "exists"; throw e; }
        },
        makeTimestamp: (ms) => Timestamp.fromMillis(ms)
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || !args.project) {
        console.log(`Usage:
  node scripts/seed-firebase.mjs --project <id> [--confirm <id>] [--emulator]

  Dry run (default):  node scripts/seed-firebase.mjs --project ${ALLOWED_PROJECT}
  Write for real:     node scripts/seed-firebase.mjs --project ${ALLOWED_PROJECT} --confirm ${ALLOWED_PROJECT}
  Local emulator:     node scripts/seed-firebase.mjs --emulator --project demo-pcrt --confirm demo-pcrt`);
        process.exit(args.help ? 0 : 1);
    }

    assertTarget({ projectId: args.project, confirm: args.confirm, emulator: args.emulator });
    const target = args.emulator ? `LOCAL EMULATOR (${args.project})` : `LIVE FIREBASE project "${args.project}"`;
    console.log(`Target: ${target}`);

    if (args.confirm === undefined) {
        const r = await runSeed({ adapter: null, projectId: args.project, emulator: args.emulator });
        console.log("\nDRY RUN - nothing was contacted or written.");
        console.log(`Would ensure: ${r.plan.users} Auth users + user profiles, ${r.plan.pullRequests} pull requests, ${r.plan.reviews} reviews`);
        console.log(`Namespace: ${DEMO_NAMESPACE} (ids start with "demo_"; every record has demo: true)`);
        console.log("Existing accounts and documents are never overwritten or deleted.");
        console.log(`\nTo write for real, add:  --confirm ${args.project}`);
        return;
    }

    const adapter = await firebaseAdminAdapter({ projectId: args.project, emulator: args.emulator });
    const r = await runSeed({ adapter, projectId: args.project, confirm: args.confirm, emulator: args.emulator, log: (m) => console.log("  " + m) });

    console.log("\nRESULT (records actually written by this run)");
    console.log(`  Auth users      created ${r.auth.created}, already existed ${r.auth.existing}`);
    console.log(`  user profiles   created ${r.users.created}, skipped ${r.users.skipped}`);
    console.log(`  pull requests   created ${r.pullRequests.created}, skipped ${r.pullRequests.skipped}`);
    console.log(`  reviews         created ${r.reviews.created}, skipped ${r.reviews.skipped}`);
    if (r.resetLinks.length) {
        console.log("\nNew Auth users have NO password. Open each link once to let that person choose one:");
        r.resetLinks.forEach((x) => console.log(`  ${x.email}\n    ${x.link}`));
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((e) => { console.error("\nSeed failed: " + e.message); process.exit(1); });
}
