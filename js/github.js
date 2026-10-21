/* =====================================================
   GitHub helpers. Uses the PUBLIC GitHub REST API from the
   browser WITHOUT a token (so no secret is ever shipped).
   Limits: public repositories only, about 60 requests/hour
   per IP. Private repos or rate limiting simply return a
   clear "unavailable" result - the "View on GitHub" link
   still works.
===================================================== */

const PR_URL = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)\/?$/i;

export function parsePullUrl(url) {
    const m = PR_URL.exec(String(url ?? "").trim());
    return m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : null;
}

export function isValidGitHubPullUrl(url) {
    return parsePullUrl(url) !== null;
}

async function getJson(url, fetchImpl) {
    const response = await fetchImpl(url, {
        headers: { Accept: "application/vnd.github+json" }
    });
    if (response.status === 404) return { error: "not-found" };
    if (response.status === 403 || response.status === 429) {
        return { error: "rate-limited" };
    }
    if (!response.ok) return { error: "error", status: response.status };
    return { data: await response.json() };
}

export async function fetchPullDetails(url, fetchImpl) {
    const doFetch = fetchImpl || ((...args) => fetch(...args));
    const parsed = parsePullUrl(url);

    if (!parsed) {
        return { ok: false, reason: "invalid-url", message: "Not a valid GitHub pull request URL." };
    }

    const base = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`;

    try {
        const pull = await getJson(base, doFetch);

        if (pull.error === "not-found") {
            return {
                ok: false,
                reason: "not-found",
                message: "GitHub could not find this PR (it may be in a private repository)."
            };
        }
        if (pull.error === "rate-limited") {
            return {
                ok: false,
                reason: "rate-limited",
                message: "GitHub API rate limit reached. Try again later or use the GitHub link."
            };
        }
        if (pull.error) {
            return { ok: false, reason: "error", message: `GitHub returned an error (${pull.status}).` };
        }

        const p = pull.data;
        const filesResult = await getJson(`${base}/files?per_page=30`, doFetch);
        const files = Array.isArray(filesResult.data)
            ? filesResult.data.map((f) => ({
                filename: f.filename,
                status: f.status,
                additions: f.additions,
                deletions: f.deletions
            }))
            : [];

        return {
            ok: true,
            data: {
                owner: parsed.owner,
                repo: parsed.repo,
                number: parsed.number,
                repository: `${parsed.owner}/${parsed.repo}`,
                title: p.title,
                authorLogin: p.user ? p.user.login : "",
                state: p.merged ? "merged" : p.state,
                createdAt: p.created_at,
                body: p.body || "",
                changedFiles: p.changed_files,
                additions: p.additions,
                deletions: p.deletions,
                commits: p.commits,
                files,
                filesTruncated: Number(p.changed_files) > files.length
            }
        };
    } catch (error) {
        return {
            ok: false,
            reason: "network",
            message: "Could not reach GitHub from the browser."
        };
    }
}
