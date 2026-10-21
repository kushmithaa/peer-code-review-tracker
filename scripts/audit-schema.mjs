#!/usr/bin/env node
/*
 * READ-ONLY schema audit of the live Firestore data against what firestore.rules needs.
 *
 *   - Performs ONLY reads (collection .get()). It never writes, updates, creates or deletes anything,
 *     and it never touches Authentication. tests/audit.test.mjs enforces that statically.
 *   - Prints document ids and issue codes only - never document contents (no emails, no feedback text).
 *   - Only accepts the project "peer-code-review-tracker".
 *
 * Credentials: see README ("Credentials"). Typical: gcloud auth application-default login
 *
 *   node scripts/audit-schema.mjs --project peer-code-review-tracker
 */
import { fileURLToPath } from "node:url";
import { auditDataset } from "./schema-audit-lib.mjs";

const PROJECT = "peer-code-review-tracker";

async function main() {
    const args = process.argv.slice(2);
    const project = args[args.indexOf("--project") + 1];
    if (!args.includes("--project") || project !== PROJECT) {
        console.log(`Usage: node scripts/audit-schema.mjs --project ${PROJECT}\n(read-only: this script never writes to Firebase)`);
        process.exit(args.includes("--project") ? 1 : 0);
    }

    let admin;
    try { admin = (await import("firebase-admin")).default; }
    catch { console.error('The "firebase-admin" package is missing. Run: npm install'); process.exit(1); }

    const app = admin.initializeApp({ projectId: project });
    const db = admin.firestore(app);
    const read = async (name) => (await db.collection(name).get()).docs.map((d) => ({ id: d.id, data: d.data() }));

    console.log(`READ-ONLY audit of project "${project}" (no writes are performed)\n`);
    const result = auditDataset({ users: await read("users"), pullRequests: await read("pullRequests"), reviews: await read("reviews") });

    console.log(`Read: ${result.counts.users} users, ${result.counts.pullRequests} pull requests, ${result.counts.reviews} reviews\n`);
    for (const sev of ["blocker", "warning", "info"]) {
        const list = result.findings.filter((f) => f.severity === sev);
        console.log(`${sev.toUpperCase()}: ${list.length}`);
        list.forEach((f) => console.log(`  [${f.collection}/${f.id}] ${f.code}: ${f.message}`));
        console.log("");
    }
    console.log(result.blockers + result.warnings === 0
        ? "No blockers or warnings: existing data is compatible with the rules."
        : "Fix blockers/warnings (usually via the Team Lead page) BEFORE publishing the new rules, or those records will misbehave.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((e) => { console.error("Audit failed: " + e.message); process.exit(1); });
}
