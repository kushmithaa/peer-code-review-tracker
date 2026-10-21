# Security audit: Firestore rules vs. the real application

Scope: `firestore.rules`, `firestore.indexes.json`, `firebase.json`, `js/firebase-config.js`, every read and write in `js/`,
`pages/`, `tests/`. Nothing was deployed and no production data was read or changed.

## Urgent context
The **live** project still runs Firebase "test mode" rules: *anyone who has the public web config can read, change and
delete every record until 25 October 2026*, and **after that date every client request is denied and the app stops working**.
Publishing reviewed rules before then is not optional. Order of work: run the checks below, run `npm run audit:schema`
against the live data (read-only), fix what it reports, then publish (see README "Deploying").

## What the application actually does against Firestore
| Where | Operation | Rule that governs it |
|---|---|---|
| `common.js` requireRole, `app.js` login | `getDoc users/{uid}` | users read (own, or Team Lead) |
| `register.js` | `setDoc users/{uid}` (create) | users create |
| developer / reviewer / pending / history / skill pages | `where(authorId \| reviewerId == uid)` on `pullRequests`, `reviews` | PR/review read (query is provably scoped) |
| `review-pr.js` | `getDoc pullRequests/{id}` | PR read (assigned reviewer) |
| Team Lead page | full-collection reads of `users`, `pullRequests`, `reviews` | read (Team Lead only) |
| `pr-actions.js` addPullRequest | `addDoc pullRequests` | PR create (developer own / Team Lead) |
| `requestReReview` | `updateDoc` status + updatedAt | PR update, author clause |
| `reopenPullRequest`, `assignPullRequest` | `updateDoc` | PR update, Team Lead clause |
| `linkLegacyReviews` | `writeBatch` of `update reviews {authorId}` (10 per batch) | review update, Team Lead clause |
| `review-pr.js` | **one `runTransaction`**: `get PR`, `set review`, `update PR` | review create + PR update, reviewer clause |

The app never deletes anything, uses no `orderBy`, `limit` or `in`, and the only transaction is the review submission.

## Indexes
Every query is a **single-field equality** filter or a whole-collection read. Firestore serves these from its automatic
single-field indexes, so **no composite index is required** and `firestore.indexes.json` is correctly empty. The static test
suite and `grep` of `js/` show no `orderBy`/`limit`/`in`/second `where`. If a future feature adds one of those, Firestore will
return an error containing a link that creates the exact index; then add it to `firestore.indexes.json`.

## Findings (against the rules shipped before this audit) and fixes
| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | **High** | Profile update only protected `role`. A user could rewrite their own `uid`, `email`, `createdAt` or add fields such as `isAdmin`. | Update allowed **only** for `name` (1-100 chars). Any other added, changed or removed field is denied. |
| 2 | **High** | Review creation did not check that the PR was still pending. An assigned reviewer could write extra reviews on already-decided PRs by calling Firestore directly (the pending check lived only in browser code). | Rules require the PR to be `Open`/`In Review`. |
| 3 | **High** | A PR decision could be recorded **without** a review (no history, no skill data), and a review could exist without the PR status changing. | A decision must carry `lastReviewId` pointing at a review written **in the same commit** by the same reviewer with the same status; a review is only accepted if the PR ends in that same status (`getAfter`). |
| 4 | Medium | Review fields copied from the PR (`pullRequestTitle`, `pullRequestNumber`, `repository`, `githubUrl`, `authorName`, `reviewerName`) were not verified, and any extra fields were accepted, so forged text could appear on other people's dashboards. | Exact key allowlist; every denormalised field must equal the real PR / the reviewer's profile. |
| 5 | Medium | `lastReviewedAt`, `updatedAt`, PR `createdAt` could be set to any value (forged history, turnaround and activity). | All client-written timestamps must equal server time (`request.time`). |
| 6 | Medium | A developer could create a PR containing extra fields (`assignedAt`, `lastReviewedAt`, `demo`, anything), a forged `authorName`, a non-integer `number`, or arbitrary values. | PR creation has an exact shape (allowlist + required fields + types), `authorName` must equal the profile name, URL must match `https://github.com/<o>/<r>/pull/<n>`. |
| 7 | Medium | Team Lead updates were unrestricted: any status (e.g. `Approved` with no review), reviewers that are not Reviewers or do not exist, rewriting `createdAt`, `githubUrl`, `number`. | Allowed keys listed; status may only stay, reopen to `Open`, or `Approved` -> `Merged`; referenced reviewer/developer must exist with the right role. |
| 8 | Medium | The "Link legacy reviews" update let a Team Lead set `authorId` on any review to any value, re-attributing feedback. | Allowed only when `authorId` is missing, and only to the review's own PR's author. |
| 9 | Medium | Profile creation did not bind the stored email to the authenticated email. | `email` must equal `request.auth.token.email` (case-insensitive); app now stores the authenticated email. |
| 10 | Low | A reviewer could review their own PR (a Team Lead could assign it). | `authorId != request.auth.uid` on review creation. |
| 11 | Low | No explicit catch-all. | Added `match /{document=**} { allow read, write: if false; }`. |
| 12 | App | Legacy back-fill batched 400 updates; once rules look up each PR this exceeds the rules' 20 document-lookup limit. | Batches of 10. |
| 13 | App | **Reopen** was hidden for PRs with a non-canonical status, so a Team Lead could not repair them. | Reopen is offered for anything that is not `Open`/`In Review`. |
| 14 | App | Profile stored the typed email, not the authenticated one. | Uses `user.email`. |

### Self-granting Team Lead (item 6 of the brief)
Closed on every path: creation allows only `Developer`/`Reviewer`; after creation only `name` can change (so `role` can never
be edited, by anyone, from the client, including a Team Lead); Team Lead status is read from the stored profile, which the
client cannot alter. A Team Lead is created **only** in the Firebase console / Admin SDK.

## Things the rules cannot do (remaining risks)
* **Open registration.** Anyone can create an Auth account with the public API key and a Developer/Reviewer profile. They see
  only their own data, but they can add PRs. Options: disable sign-up and invite users, add an email-domain check to the create rule,
  or an `approved` flag set by a Team Lead. This is a product decision.
* **Duplicate PRs** (same URL) are prevented by the UI only; rules cannot query for uniqueness.
* **Denormalised names** on Team Lead edits (`reviewerName`, `authorName`) are checked for type only.
* **API key / abuse controls:** restrict the web API key to your site's domains in Google Cloud Console, and consider App Check.
* **Existing data** must match what the rules expect. `npm run audit:schema` (read-only) checks this against production.

## Verification status (be precise)
| Check | Status |
|---|---|
| Every write the app performs captured and compared with the rules' field allowlists | **Executed, passing** (`tests/payloads.test.mjs`, 7 tests) |
| Rules lint (no open rules, catch-all deny, name-only profile update, review-create conditions) | **Executed, passing** (`tests/static.test.mjs`) |
| Existing-data audit logic | **Executed, passing** (`tests/audit.test.mjs`, 5 tests); the tool itself has **not** been run against production |
| 76 Node tests, 23 Playwright browser tests | **Executed, passing** |
| **Security Rules on the Firebase Emulator** (`npm run test:rules`: 18 hand-built tests + 12 replays accepted + 12 replays denied) | **NOT EXECUTED.** The sandbox cannot download the emulator (`storage.googleapis.com` is blocked). The suite is written, syntax-checked, and wired into GitHub Actions. Until it runs green the rules are **unverified**. |
| Rules syntax | Not compiled here (the compiler ships inside the emulator). Publishing will reject a syntax error, but run `npm run test:rules` first. |

## Manual steps
1. `git push`, open the repo's **Actions** tab: the `verify` workflow runs the emulator tests on GitHub's servers. Or install Java 11+ and run `npm run test:rules` locally.
2. Authenticate (README "Credentials") and run `npm run audit:schema`; fix blockers/warnings through the Team Lead page.
3. Only then publish: `npx firebase-tools deploy --only firestore:rules,firestore:indexes --project peer-code-review-tracker`
   (publishes `firestore.rules` and the empty `firestore.indexes.json`). **Do this before 25 October 2026.**
4. Restrict the API key; decide on open registration.
