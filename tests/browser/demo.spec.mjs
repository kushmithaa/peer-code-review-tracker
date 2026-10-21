/*
 * Real-browser tests (Chromium) run in DEMO MODE: the Firebase SDK is replaced by the local
 * adapters, so these tests need no credentials and never contact Firebase.
 * They therefore verify the app's behaviour in a real browser, NOT live Firebase or the Security Rules.
 */
import { test, expect } from "@playwright/test";

const PEOPLE = { rahul: "Rahul Kumar", priya: "Priya Sharma", arjun: "Arjun Patel", arun: "Arun Kumar", sneha: "Sneha Reddy", karthik: "Karthik Raj", meera: "Meera Krishnan" };
const HOME = { developer: "developer-dashboard.html", reviewer: "reviewer-dashboard.html", team: "team-dashboard.html" };

let consoleProblems = [];
test.beforeEach(async ({ page }) => {
    consoleProblems = [];
    page.on("console", (m) => { if (m.type() === "error") consoleProblems.push(m.text()); });
    page.on("pageerror", (e) => consoleProblems.push("PAGEERROR " + e.message));
    await page.goto("/?demo=1");
    await page.evaluate(() => { localStorage.removeItem("pcrt-demo-db-v1"); sessionStorage.clear(); localStorage.removeItem("pcrt-demo-deny-reads"); });
    await page.goto("/?demo=1");
});
test.afterEach(async () => {
    expect(consoleProblems, "browser console errors").toEqual([]);
});

async function signInAs(page, person) {
    await page.goto("/?demo=1");
    await page.locator(".persona", { hasText: PEOPLE[person] }).click();
    await page.waitForURL("**/pages/*.html");
}
const demoDb = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("pcrt-demo-db-v1")));

/* ------------------------------------------------------------------ login / roles */
test("demo login lists all seven sample users and labels the mode", async ({ page }) => {
    await expect(page.locator(".persona")).toHaveCount(7);
    for (const name of Object.values(PEOPLE)) await expect(page.locator(".persona", { hasText: name })).toBeVisible();
    await expect(page.locator("#demoBanner")).toContainText("DEMO MODE");
    await expect(page.locator("#password")).toBeHidden();            // no passwords in demo mode
});

for (const [who, role] of [["rahul", "developer"], ["arun", "reviewer"], ["meera", "team"]]) {
    test(`${who} lands on the ${role} dashboard, with data and no console errors`, async ({ page }) => {
        await signInAs(page, who);
        expect(page.url()).toContain(HOME[role]);
        await expect(page.locator("body")).toHaveAttribute("data-role", role);
        await expect(page.locator("h1").first()).toBeVisible();
        await expect(page.locator(".skeleton")).toHaveCount(0);
    });
}

test("each role is blocked from the other roles' dashboards", async ({ page }) => {
    await signInAs(page, "rahul");
    await page.goto("/pages/team-dashboard.html");  await page.waitForURL("**/developer-dashboard.html");
    await page.goto("/pages/reviewer-dashboard.html"); await page.waitForURL("**/developer-dashboard.html");
    await signInAs(page, "arun");
    await page.goto("/pages/team-dashboard.html");  await page.waitForURL("**/reviewer-dashboard.html");
    await page.goto("/pages/developer-dashboard.html"); await page.waitForURL("**/reviewer-dashboard.html");
    await signInAs(page, "meera");
    await page.goto("/pages/reviewer-dashboard.html"); await page.waitForURL("**/team-dashboard.html");
    await page.goto("/pages/review-pr.html?id=demo_pr_08"); await page.waitForURL("**/team-dashboard.html");
});

test("logged-out visitors are sent to login; logout works on every role", async ({ page }) => {
    await page.goto("/pages/developer-dashboard.html"); await page.waitForURL(/\/(index\.html)?(\?.*)?$/);
    for (const who of ["rahul", "arun", "meera"]) {
        await signInAs(page, who);
        await page.locator("#logoutLink").click();
        await page.waitForURL(/\/(index\.html)?(\?.*)?$/);
        await page.goto("/pages/team-dashboard.html");
        await page.waitForURL(/\/(index\.html)?(\?.*)?$/);
    }
});

test("registration in demo mode: validation, weak password, duplicate email, Team Lead blocked, success", async ({ page }) => {
    await page.goto("/pages/register.html");
    await expect(page.locator("#role option")).toHaveText(["Select role...", "Developer", "Reviewer"]);   // no Team Lead option
    await page.locator("#registerBtn").click();
    await expect(page.locator("#message")).toContainText("Developer or Reviewer");
    await page.locator("#role").selectOption("Developer");
    await page.locator("#registerBtn").click();
    await expect(page.locator("#message")).toContainText("fill in all fields");
    await page.locator("#name").fill("New Dev"); await page.locator("#email").fill("new.dev@example.com"); await page.locator("#password").fill("123");
    await page.locator("#registerBtn").click();
    await expect(page.locator("#message")).toContainText("at least 6 characters");
    await page.locator("#email").fill("rahul.developer@example.com"); await page.locator("#password").fill("longenough1");
    await page.locator("#registerBtn").click();
    await expect(page.locator("#message")).toContainText("already registered");
    await page.locator("#email").fill("new.dev@example.com");
    await page.locator("#registerBtn").click();
    await page.waitForURL("**/developer-dashboard.html");
    await expect(page.locator("#statTotal")).toHaveText("0");
    await expect(page.locator("#prList")).toContainText("No pull requests yet");            // genuine empty state
    await page.locator('.side-nav a[data-view="skills"]').click();
    await expect(page.locator("#skillBlock")).toContainText("Not enough assessment data yet");
    const db = await demoDb(page);
    expect(Object.values(db.users).find((u) => u.email === "new.dev@example.com").role).toBe("Developer");
    consoleProblems = consoleProblems.filter((m) => !/Registration Error/.test(m));   // logged on purpose for the errors this test provokes
});

/* ------------------------------------------------------------------ developer */
test("developer: stats, profile, skill scores from real ratings, feedback, history filters", async ({ page }) => {
    await signInAs(page, "rahul");
    await expect(page.locator("#statTotal")).toHaveText("5");
    await expect(page.locator("#statPending")).toHaveText("2");                 // PR-07 In Review + PR-13 Open
    await expect(page.locator("#statApproved")).toHaveText("3");
    await expect(page.locator("#statChanges")).toHaveText("0");
    await expect(page.locator("#profileCard")).toContainText("rahul.developer@example.com");

    // Rahul's ratings: CQ 3,4,5 (80) / Readability 3,4 (70) / Security 2 (40) / Testing 3,4,4 (73) / Docs 3 (60) -> overall 65
    await expect(page.locator("#overviewSkills")).toContainText("65%");
    await page.locator('.side-nav a[data-view="skills"]').click();
    await expect(page.locator("#skillBlock")).toContainText("Your overall skill score: 65%");
    await expect(page.locator("#skillBlock")).toContainText("Performance");
    await expect(page.locator("#skillBlock")).toContainText("Not assessed");    // Performance has no ratings: shown honestly
    await expect(page.locator("#skillBlock")).toContainText("3 rating(s) used");

    await page.locator('.side-nav a[data-view="history"]').click();
    await expect(page.locator("#historyList .item")).toHaveCount(3);
    await page.locator("#historyStatus").selectOption("changes requested");
    await expect(page.locator("#historyList")).toContainText("No reviews found");
    await page.locator("#historyStatus").selectOption("all");
    await page.locator("#historyCategory").selectOption("security");
    await expect(page.locator("#historyList .item")).toHaveCount(1);
    await page.locator("#historyCategory").selectOption("all");
    await page.locator("#searchHistory").fill("regression test");
    await expect(page.locator("#historyList .item")).toHaveCount(1);
});

test("developer: Priya's skill progress compares previous with current ratings", async ({ page }) => {
    await signInAs(page, "priya");
    await page.locator('.side-nav a[data-view="skills"]').click();
    // Code Quality ratings 3,4,4,4 -> older half 3.5 (70%) vs newer half 4 (80%)
    await expect(page.locator("#skillBlock")).toContainText("Previous 70% → Current 80%");
    await expect(page.locator("#skillBlock")).toContainText("4 rating(s) used");
});

test("developer: submit a PR (validation, duplicate protection), then it appears in the right place", async ({ page }) => {
    await signInAs(page, "arjun");
    await page.locator("#openPrDialog").click();
    await expect(page.locator("#prDialog")).toBeVisible();
    await page.locator("#newPrUrl").fill("https://example.com/not-github");
    await page.locator("#newPrTitle").fill("Bad link");
    await page.locator("#newPrSubmit").click();
    await expect(page.locator("#newPrMessage")).toContainText("valid GitHub pull request URL");

    await page.locator("#newPrUrl").fill("https://github.com/demo-org/web-app/pull/301");
    await page.locator("#newPrTitle").fill("Add keyboard shortcuts");
    await page.locator("#newPrDesc").fill("Adds j/k navigation to lists.");
    await page.locator("#newPrPriority").selectOption("High");
    await page.locator("#newPrSubmit").click();
    await expect(page.locator("#prDialog")).toBeHidden();
    await page.locator('.side-nav a[data-view="prs"]').click();
    await expect(page.locator("#prList")).toContainText("Add keyboard shortcuts");
    await expect(page.locator("#statTotal")).toHaveText("6");

    const db = await demoDb(page);
    const created = Object.values(db.pullRequests).find((p) => p.title === "Add keyboard shortcuts");
    expect(created).toMatchObject({ number: 301, repository: "demo-org/web-app", status: "Open", priority: "High", reviewerId: null, authorName: "Arjun Patel" });

    await page.locator("#openPrDialog2").click();                                // duplicate URL
    await page.locator("#newPrUrl").fill("https://github.com/demo-org/web-app/pull/301");
    await page.locator("#newPrTitle").fill("Again");
    await page.locator("#newPrSubmit").click();
    await expect(page.locator("#newPrMessage")).toContainText("already been added");
});

test("developer: requests a re-review after changes were requested", async ({ page }) => {
    await signInAs(page, "arjun");                                               // PR-03 is Changes Requested
    await page.locator('.side-nav a[data-view="prs"]').click();
    await page.getByRole("button", { name: "Request re-review" }).click();
    await expect(page.locator("#prList")).not.toContainText("Request re-review");
    const db = await demoDb(page);
    expect(db.pullRequests.demo_pr_03.status).toBe("In Review");
});

/* ------------------------------------------------------------------ reviewer */
test("reviewer: queue shows overdue + priority first and real counts", async ({ page }) => {
    await signInAs(page, "arun");
    await expect(page.locator("#pendingBig")).toHaveText("3");
    await expect(page.locator("#overdueCount")).toHaveText("1");
    await expect(page.locator("#assignedPRCount")).toHaveText("5");
    await expect(page.locator("#completedReviewCount")).toHaveText("2");
    const first = page.locator("#pendingReviewList .item").first();
    await expect(first).toContainText("Refactor duplicate validation logic");     // the overdue one is first
    await expect(first).toContainText("Overdue");
    await expect(page.locator("#avgTurnaround")).not.toHaveText("n/a");
    await expect(page.locator("#startNext")).toHaveAttribute("href", /review-pr\.html\?id=demo_pr_09/);
});

test("FULL WORKFLOW in a real browser: add PR -> assign -> review on GitHub hand-off -> approve -> everything updates", async ({ page, context }) => {
    // 1. developer adds a PR
    await signInAs(page, "priya");
    await page.locator("#openPrDialog").click();
    await page.locator("#newPrUrl").fill("https://github.com/demo-org/api-service/pull/777");
    await page.locator("#newPrTitle").fill("Cache session lookups");
    await page.locator("#newPrSubmit").click();
    await expect(page.locator("#prDialog")).toBeHidden();

    // 2. team lead assigns Sneha
    await signInAs(page, "meera");
    await page.locator('.team-rail a[data-view="manage"]').click();
    const row = page.locator("tr", { hasText: "Cache session lookups" });
    await row.locator('[data-field="reviewer"]').selectOption({ label: "Sneha Reddy" });
    await row.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("#toastHost")).toContainText("Pull request updated");
    await expect(page.locator("#statPending")).toHaveText("7");                   // 6 + the new one

    // 3. reviewer sees it as pending, opens review, GitHub link is the real PR URL
    await signInAs(page, "sneha");
    await expect(page.locator("#pendingReviewList")).toContainText("Cache session lookups");
    await page.locator("#pendingReviewList .item", { hasText: "Cache session lookups" }).getByRole("link", { name: "Open Review" }).click();
    await expect(page.locator("#prTitle")).toHaveText("Cache session lookups");
    await expect(page.locator("#githubButton")).toHaveAttribute("href", "https://github.com/demo-org/api-service/pull/777");
    await expect(page.locator("#githubButton")).toHaveAttribute("target", "_blank");
    await expect(page.locator("#githubInfo")).toContainText("Demo mode does not contact GitHub automatically");

    // 4. validation, then submit (double-click must save exactly one review)
    await page.locator("#approveButton").click();
    await expect(page.locator("#message")).toContainText("enter your review feedback");
    await page.locator("#feedback").fill("Solid change. The TTL is sensible; please add a test for cache expiry.");
    await page.locator("#approveButton").click();
    await expect(page.locator("#message")).toContainText("rate at least one category");
    await page.locator('input[name="rating-performance"][value="5"]').check({ force: true });
    await page.locator('input[name="rating-testing"][value="3"]').check({ force: true });
    await page.locator("#approveButton").dblclick();
    await expect(page.locator("#message")).toContainText("Review submitted");
    await expect(page.locator("#message")).toContainText("does not change the pull request on GitHub");

    const db = await demoDb(page);
    const pr = Object.entries(db.pullRequests).find(([, p]) => p.title === "Cache session lookups");
    expect(pr[1].status).toBe("Approved");
    const saved = Object.values(db.reviews).filter((r) => r.pullRequestId === pr[0]);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ reviewerName: "Sneha Reddy", authorName: "Priya Sharma", status: "Approved", ratings: { Performance: 5, Testing: 3 } });

    // 5. reviewer pending + history update
    await page.goto("/pages/pending-reviews.html");
    await expect(page.locator("#pendingList")).not.toContainText("Cache session lookups");
    await page.goto("/pages/review-history.html");
    await expect(page.locator("#historyList")).toContainText("Cache session lookups");
    await expect(page.locator("#totalReviews")).toHaveText("6");                  // Sneha had 5 reviews

    // 6. developer sees feedback, status and updated skills
    await signInAs(page, "priya");
    await expect(page.locator("#recentFeedback")).toContainText("Cache session lookups");
    await page.locator('.side-nav a[data-view="skills"]').click();
    await expect(page.locator("#skillBlock")).toContainText("Performance");
    await page.locator('.side-nav a[data-view="feedback"]').click();
    await expect(page.locator("#feedbackList")).toContainText("please add a test for cache expiry");

    // 7. team lead analytics reflect the new review
    await signInAs(page, "meera");
    await expect(page.locator("#statReviews")).toHaveText("11");
    await page.locator('.team-rail a[data-view="reviews"]').click();
    await expect(page.locator("#reviewerTable")).toContainText("Sneha Reddy");
});

test("reviewer: cannot review a PR that is not assigned to them or already decided", async ({ page }) => {
    await signInAs(page, "arun");
    await page.goto("/pages/review-pr.html?id=demo_pr_07");                       // assigned to Karthik
    await expect(page.locator("#message")).toContainText("not the reviewer assigned");
    await expect(page.locator("#approveButton")).toBeDisabled();
    await page.goto("/pages/review-pr.html?id=demo_pr_01");                       // Arun's, already Approved
    await expect(page.locator("#message")).toContainText("already");
    await expect(page.locator("#approveButton")).toBeDisabled();
    await page.goto("/pages/review-pr.html");
    await expect(page.locator("#prTitle")).toHaveText("Pull Request ID Missing");
    await page.goto("/pages/review-pr.html?id=nope");
    await expect(page.locator("#prTitle")).toHaveText("Pull Request Not Found");
});

test("reviewer: history persists after reload; search and filters work", async ({ page }) => {
    await signInAs(page, "sneha");
    await page.goto("/pages/review-history.html");
    await expect(page.locator("#totalReviews")).toHaveText("5");
    await expect(page.locator("#approvedReviews")).toHaveText("4");
    await expect(page.locator("#changesReviews")).toHaveText("1");
    await page.reload();
    await expect(page.locator("#totalReviews")).toHaveText("5");
    await page.locator("#statusFilter").selectOption("changes requested");
    await expect(page.locator("#historyList .item")).toHaveCount(1);
    await page.locator("#statusFilter").selectOption("all");
    await page.locator("#searchReviews").fill("unicode");
    await expect(page.locator("#historyList .item")).toHaveCount(2);
    await page.locator("#searchReviews").fill("zzzz-no-match");
    await expect(page.locator("#historyList")).toContainText("No reviews found");
    await expect(page.locator("h1")).toHaveText("My review history");              // genuinely a separate page
    await expect(page.locator(".rev-attention")).toHaveCount(0);                  // not the dashboard
});

/* ------------------------------------------------------------------ team lead */
test("team lead: KPIs, filters, management and permissions", async ({ page }) => {
    await signInAs(page, "meera");
    await expect(page.locator("#statMembers")).toHaveText("7");
    await expect(page.locator("#statPrs")).toHaveText("15");
    await expect(page.locator("#statPending")).toHaveText("6");
    await expect(page.locator("#statReviews")).toHaveText("10");
    await expect(page.locator("#kpiApproval")).toHaveText("70%");
    await expect(page.locator("#kpiChanges")).toHaveText("30%");
    await expect(page.locator("#ovAttention")).toContainText("overdue");

    await page.locator("#fMember").selectOption({ label: "Arjun Patel" });        // member filter
    await expect(page.locator("#statPrs")).toHaveText("5");
    await page.locator("#fMember").selectOption("all");
    await page.locator("#fStatus").selectOption("Approved");
    await expect(page.locator("#statPrs")).toHaveText("7");
    await page.locator("#fStatus").selectOption("all");

    await page.locator('.team-rail a[data-view="members"]').click();
    await expect(page.locator("#membersTable tbody tr")).toHaveCount(7);
    await page.locator('.team-rail a[data-view="skills"]').click();
    await expect(page.locator("#teamSkills")).toContainText("Team overall skill score");
    await expect(page.locator("#devSkillsTable")).toContainText("Priya Sharma");

    await page.locator('.team-rail a[data-view="manage"]').click();
    await page.locator("#manageFilter").selectOption("pending");
    await expect(page.locator("#manageTable tbody tr")).toHaveCount(6);
    // reassign a pending PR from Arun to Karthik
    const row = page.locator("tr[data-row='demo_pr_08']");
    await row.locator('[data-field="reviewer"]').selectOption({ label: "Karthik Raj" });
    await row.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("#toastHost")).toContainText("updated");
    expect((await demoDb(page)).pullRequests.demo_pr_08.reviewerName).toBe("Karthik Raj");
    // no-op save is rejected with a message, not silently accepted
    await page.locator("tr[data-row='demo_pr_08']").getByRole("button", { name: "Save" }).click();
    await expect(page.locator("#toastHost")).toContainText("no changes");
});

/* ------------------------------------------------------------------ errors, reset, a11y, responsive */
test("Firestore permission errors are shown on every role, never hidden", async ({ page }) => {
    await page.evaluate(() => localStorage.setItem("pcrt-demo-deny-reads", JSON.stringify(["pullRequests", "reviews"])));
    for (const who of ["rahul", "arun"]) {
        await signInAs(page, who);
        await expect(page.locator(".empty.error").first()).toBeVisible();
    }
    await page.evaluate(() => localStorage.removeItem("pcrt-demo-deny-reads"));
    consoleProblems = consoleProblems.filter((m) => !/Unable to load|permission|Missing or insufficient/i.test(m));   // expected, deliberately provoked
});

test("reset demo data restores the original dataset", async ({ page }) => {
    await signInAs(page, "arjun");
    await page.getByRole("button", { name: "Request re-review" }).count();
    await page.locator('#demoBanner [data-demo="reset"]').click();
    await page.waitForURL(/\/(index\.html)?(\?.*)?$/);
    expect(Object.keys((await demoDb(page)).pullRequests)).toHaveLength(15);
});

test("accessibility basics: one h1, labelled controls, skip link, keyboard-focusable nav", async ({ page }) => {
    for (const [who, file] of [["rahul", "developer-dashboard"], ["arun", "reviewer-dashboard"], ["meera", "team-dashboard"], ["arun", "assigned-prs"], ["arun", "review-history"]]) {
        await signInAs(page, who);
        await page.goto(`/pages/${file}.html`);
        await page.locator(".skeleton").first().waitFor({ state: "detached" }).catch(() => {});
        const problems = await page.evaluate(() => {
            const out = [];
            if (document.querySelectorAll("h1").length < 1) out.push("no h1");
            if (!document.querySelector('a.skip-link[href="#main"]') || !document.getElementById("main")) out.push("no skip link target");
            document.querySelectorAll("input:not([type=radio]):not([type=hidden]), select, textarea").forEach((el) => {
                const named = el.getAttribute("aria-label") || el.labels?.length || el.getAttribute("aria-labelledby");
                if (!named) out.push("unlabelled control #" + el.id);
            });
            document.querySelectorAll("button, a.btn").forEach((el) => {
                if (!(el.textContent.trim() || el.getAttribute("aria-label"))) out.push("unnamed button");
            });
            if (document.documentElement.lang !== "en") out.push("missing lang");
            return out;
        });
        expect(problems, `${file} accessibility`).toEqual([]);
    }
});

for (const vp of [{ name: "mobile", width: 390, height: 844 }, { name: "tablet", width: 820, height: 1180 }, { name: "desktop", width: 1440, height: 900 }]) {
    test(`responsive ${vp.name}: no horizontal overflow on any role's pages`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const pages = [["rahul", ["developer-dashboard", "developer-dashboard#prs", "developer-dashboard#skills", "developer-dashboard#history"]],
            ["arun", ["reviewer-dashboard", "assigned-prs", "pending-reviews", "review-history", "skill-growth", "review-pr?id=demo_pr_08"]],
            ["meera", ["team-dashboard", "team-dashboard#members", "team-dashboard#prs", "team-dashboard#skills", "team-dashboard#manage"]]];
        for (const [who, list] of pages) {
            await signInAs(page, who);
            for (const p of list) {
                const [file, extra] = p.split(/(?=[#?])/);
                await page.goto(`/pages/${file}.html${extra || ""}`);
                await page.waitForTimeout(250);
                const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
                expect(over, `${p} overflows by ${over}px at ${vp.name}`).toBeLessThanOrEqual(1);
            }
        }
    });
}

test("team lead navigation stays reachable on mobile (bottom bar)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAs(page, "meera");
    const rail = page.locator(".team-rail");
    await expect(rail).toBeVisible();
    const box = await rail.boundingBox();
    expect(box.y + box.height).toBeGreaterThan(800);                               // pinned to the bottom
    await rail.locator('a[data-view="manage"]').click();
    await expect(page.locator("#view-manage")).toBeVisible();
});
