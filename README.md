# Peer Code Review & Skill-Growth Tracker

Plain HTML, CSS and JavaScript modules on **Firebase Authentication + Cloud Firestore**. No build step.
Three role-based workspaces, each with its own layout and colour identity:

| Role | Workspace | Look |
|---|---|---|
| **Developer** | `pages/developer-dashboard.html` | violet, sidebar: overview, pull requests, feedback, skill growth, history |
| **Reviewer** | `pages/reviewer-dashboard.html` (+ 5 pages) | teal, top bar: priority queue, assigned, pending, history, activity, review form |
| **Team Lead** | `pages/team-dashboard.html` | amber, icon rail: filters, KPIs, charts, members, skills, reviewer/PR management |

---------------------------------------------------------------------------------------------------

## 1. Quick start on Windows (PowerShell)

You need **Node.js 20 or newer** (`node --version`). Open PowerShell in the project folder:

```powershell
cd C:\Users\kushm\OneDrive\Desktop\Peer-Code-Review-Tracker
npm install
npm start
```

Open **http://localhost:3000/?demo=1** to explore everything with sample data (no Firebase needed).
Open **http://localhost:3000/** for the real Firebase-backed app.

`npm start` runs a small built-in file server (`scripts/dev-server.mjs`). `npx serve .` also still works.

---------------------------------------------------------------------------------------------------

## 2. The two data modes (they never mix)

### DEMO MODE (local only)
* Switch on with `?demo=1`; switch off with `?demo=0` or the banner's **Exit demo mode**.
* An import map swaps the Firebase SDK for local in-memory adapters (`js/demo/`). **Nothing is sent to Firebase.**
* Data lives in this browser's `localStorage` (`pcrt-demo-db-v1`). **Reset demo data** in the banner restores the original set.
* **No passwords.** You sign in by choosing a sample user on the login page.
* A yellow banner on every page says "DEMO MODE".

### FIREBASE SEED MODE (writes to your real project, only when you ask)
`scripts/seed-firebase.mjs` writes the same dataset into Firestore. It is **dry-run by default**.

* Needs `--confirm peer-code-review-tracker` to write, and only accepts that project (or `--emulator`).
* **Never overwrites or deletes** anything: existing Auth users, user profiles and `demo_` documents are skipped. Safe to re-run.
* Every seeded record has `demo: true`, `demoNamespace: "pcrt-demo-v1"` and an id starting `demo_`, so it can never be mistaken for a genuine review. The Team Lead's filter bar gets a "Real data only / Demo data only" switch whenever demo records exist.
* **No passwords are created or printed.** New Auth users get no password; the script prints a password-reset link for each so people choose their own.
* It creates the Auth users first. If that fails (for example no permission) nothing is written to Firestore.
* It reports exactly how many records it created or skipped.

**Credentials (never paste them into chat or commit them).** Pick one:

1. *Recommended:* install the Google Cloud CLI, then run `gcloud auth application-default login` (a browser opens; sign in with the Google account that owns the Firebase project) and `gcloud auth application-default set-quota-project peer-code-review-tracker`.
2. A service-account key: Firebase Console -> Project settings -> Service accounts -> Generate new private key. Save it **outside** this folder, then in PowerShell: `$env:GOOGLE_APPLICATION_CREDENTIALS="C:\secure\key.json"`. Delete the key when finished.

```powershell
npm run seed:dry      # 1. shows what would happen, contacts nothing
npm run seed:live     # 2. writes to peer-code-review-tracker (after you have checked step 1)
```

Practise first against the local emulator (needs Java 11+): in one window `npx --yes firebase-tools@13 emulators:start --only firestore,auth --project demo-pcrt`, in another `npm run seed:emulator`.

> **Status:** the seed script has been tested against an in-memory Admin adapter (idempotency, refusals, no passwords, consistency). It has **not** been run against live Firebase or the emulator, so no demo data is in your Firestore yet.

---------------------------------------------------------------------------------------------------

## 3. Firebase setup for the live app

1. Firebase Console -> Authentication -> **Sign-in method** -> enable **Email/Password**.
2. Publish the security rules (see "Deploying" below).
3. Register users on `pages/register.html` (Developer or Reviewer).
4. **Create the first Team Lead** (self-registration cannot create one): register normally, then in Firestore -> `users` -> that user's document, change `role` to `Team Lead`. (The older value `Team` is still understood.)
5. As Team Lead, use **Reviewer / PR management** to link developers and assign reviewers.

### Roles and what the rules allow
| | Developer | Reviewer | Team Lead |
|---|---|---|---|
| Read own profile | yes | yes | all profiles |
| Edit own profile | `name` only | `name` only | `name` only |
| Read pull requests | own (`authorId`) | assigned (`reviewerId`) | all |
| Add a pull request | own, `Open`, unassigned | no | any valid |
| Assign / reassign reviewer, reopen | no | no | yes |
| Decide a PR | no | only its assigned reviewer, only while `Open`/`In Review`, only together with its review | no |
| Request re-review | own PR in `Changes Requested` | no | no |
| Submit a review | no | yes, for assigned PRs, validated ratings/category/feedback, server timestamp | no |
| Edit or delete a saved review | no | no | only fill in a *missing* `authorId` from the PR |
| Change own role | **never** | **never** | not via the app |

Statuses are `Open`, `In Review`, `Changes Requested`, `Approved`, `Merged`. **"Pending" means `Open` or `In Review` with a reviewer assigned** (the stored word is `Open`, not "Pending", to stay compatible with existing data).

---------------------------------------------------------------------------------------------------

## 4. Data model

`users/{uid}`: `uid, name, email, role, createdAt`

`pullRequests/{id}`: `title, description, number, repository, repositoryUrl, githubUrl, status, priority (High|Medium|Low), dueDate, authorId, authorName, reviewerId, reviewerName, source (manual|github), createdAt, assignedAt, lastReviewedAt, updatedAt`

`reviews/{id}`: `pullRequestId, pullRequestTitle, pullRequestNumber, repository, githubUrl, authorId, authorName, reviewerId, reviewerName, ratings { "<category>": 1-5 }, category, rating (the first rated category, kept for older queries), feedback, status, createdAt`

Categories: Code Quality, Readability, Performance, Security, Testing, Documentation. Older reviews with a single `category`+`rating`, or none, still display; reviews with no rating never count towards skill scores.

Review submission is **one Firestore transaction**: it re-checks the PR is still pending and assigned to you, saves the review and updates the PR status together, so repeated clicks or a stale tab cannot create duplicates or disagreement.

### Skill scores (the documented formula, `js/skills.js`)
* Evidence = the 1-5 ratings reviewers saved. Approval alone proves nothing.
* Category score = `round(average rating / 5 x 100)`. Overall = average of the categories that have data (unassessed categories are shown as "Not assessed", never 0).
* Progress needs 4+ ratings in a category: older half vs newer half by date, shown as "Previous 70% -> Current 80%". Otherwise it says more ratings are needed.
* Fewer than 3 ratings = "low confidence". Team "gap" needs a pooled score under 60% from 3+ ratings; "strength" is 80%+.
* **Reviewer activity is separate**: counts and turnaround only, no skill percentage for reviewers.

---------------------------------------------------------------------------------------------------

## 5. GitHub integration (what is real and what is not)

* Every PR stores its `githubUrl`; **View on GitHub** opens the real pull request in a new tab for the code inspection.
* "Import from GitHub" (add-PR form) and the live details panel use GitHub's **public REST API directly from the browser, with no token**. This works for **public repositories only** and is limited to about 60 requests per hour per IP. Private repositories and API failures show a clear message and you type the details yourself. **No token is ever placed in browser code or the repository.**
* **There is no synchronisation.** Submitting a review here does **not** approve, comment on or merge the real GitHub PR, and the app's status is separate from GitHub's. Real two-way sync needs a small backend (for example a Cloud Function holding a GitHub App secret and a webhook); it is not implemented. The review page says this explicitly.
* In demo mode the app never contacts GitHub automatically (the demo links point at example repositories); a button lets you try anyway.

---------------------------------------------------------------------------------------------------

## 6. Tests

```powershell
npm test                  # 76 tests: unit, simulated-Firebase pages, static + rules lint, seed, write-payload capture, schema audit
npx playwright install chromium     # one time
npm run test:browser      # 23 real-browser tests in Chromium (demo mode)
npm run test:rules        # Firestore Security Rules tests on the emulator (needs Java 11+)
npm run test:all
```

| Suite | What it proves | What it does not |
|---|---|---|
| `tests/unit`, `e2e`, `static`, `seed`, `payloads`, `audit` | scoring formula, roles, every page's logic against an in-memory Firestore, link/ID/placeholder/secret checks, seed safety, **the app's real write payloads vs. the rules' field allowlists**, schema-audit logic | real Firebase; evaluating the rules |
| `tests/browser` (Playwright) | the real pages in Chromium: login, role protection, all three workflows end to end, filters, errors, accessibility basics, responsive layouts at 390/820/1440 px, console errors | real Firebase, Security Rules |
| `tests/rules` (emulator) | hand-built allow/deny cases for every collection and role, **plus the app's real captured writes replayed as the right user (must pass) and as every wrong user (must fail)** | needs the emulator and Java. **Also runs in GitHub Actions** (`.github/workflows/verify.yml`) so you do not need Java locally |

---------------------------------------------------------------------------------------------------

## 7. Deploying (nothing has been deployed for you)

> **Deadline:** your live project still has test-mode rules that allow anyone to read and write everything **until 25 October 2026**. After that date all client access is denied and the app stops. Publish reviewed rules before then. Read `SECURITY-AUDIT.md` first.

Recommended order: (1) push to GitHub and let the **verify** workflow run the emulator rules tests (or `npm run test:rules` with Java); (2) `npm run audit:schema` - a **read-only** check of your existing live data against the rules; (3) fix what it reports from the Team Lead page; (4) deploy.

Only run these when you are ready. They publish **exactly**:

* `firestore.rules` - the security rules in this folder
* `firestore.indexes.json` - currently empty (no composite indexes are needed; every query filters on one field)
* optionally Hosting - every file except those listed in `firebase.json -> hosting.ignore` (tests, scripts, docs, package files)

```powershell
npx firebase-tools login
npx firebase-tools deploy --only firestore:rules,firestore:indexes --project peer-code-review-tracker
npx firebase-tools deploy --only hosting --project peer-code-review-tracker        # optional
```

Your existing Firestore database is used as it is; nothing here creates a second database.

---------------------------------------------------------------------------------------------------

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| `npm start` says port in use | `node scripts/dev-server.mjs 3001` |
| Login says "profile not found" / "no valid role" | the user has no `users/{uid}` document or an unknown `role`; fix it in the console |
| A reviewer cannot submit: "Firestore denied" | publish `firestore.rules`; the PR must be `Open`/`In Review`, have a `status` and be assigned to that reviewer |
| Developer sees no feedback for old reviews | Team Lead -> Manage -> set the developer on the PR -> **Link legacy reviews** |
| Page shows "Unable to load ..." | open the browser console (F12); usually the rules or the network |
| Demo data looks stale or odd | banner -> **Reset demo data** |
| `npm run test:browser` cannot find a browser | `npx playwright install chromium` |
| `npm run test:rules` fails to start | install Java 11+ (`java -version`) |
| Seed: "Refusing to run" | the project id or `--confirm` does not match `peer-code-review-tracker` |
| Seed: auth or permission errors | re-run `gcloud auth application-default login` with the project owner account |

---------------------------------------------------------------------------------------------------

## 9. Project layout

```
index.html                 login (demo persona picker in demo mode)
pages/                     register, developer-, reviewer-, team-dashboard, assigned-prs, pending-reviews,
                           review-pr, review-history, skill-growth
css/app.css  roles.css     design system (tokens, components) + the three role layouts
js/common.js               roles, route guard, formatting, demo banner, navigation helper
js/skills.js  charts.js    scoring formula; dependency-free SVG charts
js/ui.js  pr-actions.js    shared renderers; add/assign/re-review actions and the add-PR form
js/github.js               public-API PR import (no token)
js/mode.js  js/demo/       demo-mode switch, in-memory Firebase adapters, dataset.js (single source of sample data)
scripts/                   dev-server.mjs, seed-firebase.mjs
tests/                     unit, e2e (jsdom), static, seed, browser (Playwright), rules (emulator)
firestore.rules  firestore.indexes.json  firebase.json  .firebaserc
```
