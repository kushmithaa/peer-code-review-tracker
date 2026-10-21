/* =====================================================
   Skill-growth scoring (pure functions, no Firebase).

   FORMULA (documented in README.md)
   ---------------------------------
   Evidence  : a review's `ratings` map ({ "Testing": 4, ... }) holds one
               integer 1..5 per category the reviewer assessed. Older
               reviews that only have a single `category` + `rating` are
               read as a one-entry map. Reviews with no valid rating
               (e.g. text-only legacy reviews) are never counted.
   Category  : score = round( mean(ratings in category) / 5 * 100 )
   Overall   : score = round( mean(category scores that have data) )
               -> equal weight per assessed category, so the overall
                  score always agrees with the category scores shown.
   Trend     : needs >= 4 ratings. Older half vs newer half (by date);
               change = difference of the means in score points.
               |change| < 5 points = "stable".
   Confidence: a category with fewer than 3 ratings is flagged
               "low confidence".
===================================================== */

import { toMillis } from "./common.js";

export const SKILL_CATEGORIES = [
    "Code Quality",
    "Readability",
    "Performance",
    "Security",
    "Testing",
    "Documentation"
];

export const THRESHOLDS = {
    strength: 80,
    weakness: 60,
    lowConfidenceBelow: 3,
    minForTrend: 4,
    stableWithin: 5
};

function toRating(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

export function ratingOf(review) {
    return toRating(review ? review.rating : null);
}

function matchCategory(name) {
    const raw = String(name ?? "").trim().toLowerCase();
    return SKILL_CATEGORIES.find((c) => c.toLowerCase() === raw) || null;
}

export function categoryOf(review) {
    return matchCategory(review && review.category);
}

/* [[category, rating], ...] for one review (new multi-rating form or legacy single rating). */
export function ratingsOf(review) {
    if (review && review.ratings && typeof review.ratings === "object") {
        const out = [];
        for (const [name, value] of Object.entries(review.ratings)) {
            const category = matchCategory(name);
            const rating = toRating(value);
            if (category && rating !== null) out.push([category, rating]);
        }
        return out;
    }
    const category = categoryOf(review);
    const rating = ratingOf(review);
    return category && rating !== null ? [[category, rating]] : [];
}

function mean(numbers) {
    return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}

function toScore(ratingMean) {
    return Math.round((ratingMean / 5) * 100);
}

/* ratings must already be in chronological order */
export function trendOf(ratings) {
    if (ratings.length < THRESHOLDS.minForTrend) {
        return { status: "insufficient", change: null, previous: null, current: null };
    }
    const mid = Math.floor(ratings.length / 2);
    const older = ratings.slice(0, mid);
    const newer = ratings.slice(mid);
    const previous = toScore(mean(older));
    const current = toScore(mean(newer));
    const change = Math.round(((mean(newer) - mean(older)) / 5) * 100);

    let status = "stable";
    if (change >= THRESHOLDS.stableWithin) status = "improving";
    if (change <= -THRESHOLDS.stableWithin) status = "declining";
    return { status, change, previous, current };
}

/* One developer's skills from the reviews written about their PRs. */
export function computeSkills(reviews) {
    const all = Array.isArray(reviews) ? reviews : [];

    const entries = [];
    let assessedReviews = 0;
    all.forEach((review) => {
        const pairs = ratingsOf(review);
        if (!pairs.length) return;
        assessedReviews += 1;
        pairs.forEach(([category, rating]) => entries.push({ category, rating, t: toMillis(review.createdAt) }));
    });
    entries.sort((a, b) => a.t - b.t);

    const categories = SKILL_CATEGORIES.map((category) => {
        const ratings = entries.filter((e) => e.category === category).map((e) => e.rating);
        return {
            category,
            n: ratings.length,
            score: ratings.length ? toScore(mean(ratings)) : null,
            lowConfidence: ratings.length > 0 && ratings.length < THRESHOLDS.lowConfidenceBelow,
            trend: trendOf(ratings)
        };
    });

    const withData = categories.filter((c) => c.score !== null);

    return {
        overall: withData.length
            ? {
                score: Math.round(mean(withData.map((c) => c.score))),
                categoriesAssessed: withData.length,
                n: assessedReviews,
                trend: trendOf(entries.map((e) => e.rating))
            }
            : null,
        categories,
        strengths: withData.filter((c) => c.score >= THRESHOLDS.strength).map((c) => c.category),
        improvements: withData.filter((c) => c.score < THRESHOLDS.weakness).map((c) => c.category),
        assessedCount: assessedReviews,
        unassessedCount: all.length - assessedReviews
    };
}

/* Reviewer ACTIVITY (counts only - this is not a skill score). */
export function reviewActivity(reviews) {
    const all = Array.isArray(reviews) ? reviews : [];
    const byCategory = {};
    SKILL_CATEGORIES.forEach((c) => { byCategory[c] = 0; });
    let uncategorised = 0;

    all.forEach((r) => {
        const rated = ratingsOf(r).map(([c]) => c);
        const cats = rated.length ? rated : (categoryOf(r) ? [categoryOf(r)] : []);
        if (cats.length) cats.forEach((c) => { byCategory[c] += 1; }); else uncategorised += 1;
    });

    const statusOf = (r) => String(r.status || "").toLowerCase();
    const last = all.reduce((m, r) => Math.max(m, toMillis(r.createdAt)), 0);

    return {
        total: all.length,
        approved: all.filter((r) => statusOf(r) === "approved").length,
        changesRequested: all.filter((r) => statusOf(r) === "changes requested").length,
        byCategory,
        uncategorised,
        lastReviewAt: last || null
    };
}

/* Team-level: pool every assessed rating per category. */
export function computeTeamSkills(reviews) {
    const pooled = computeSkills(reviews);

    return {
        ...pooled,
        categories: pooled.categories.map((c) => ({
            ...c,
            status:
                c.n === 0 ? "no-data"
                : c.n < THRESHOLDS.lowConfidenceBelow ? "insufficient"
                : c.score < THRESHOLDS.weakness ? "gap"
                : c.score >= THRESHOLDS.strength ? "strength"
                : "adequate"
        }))
    };
}
