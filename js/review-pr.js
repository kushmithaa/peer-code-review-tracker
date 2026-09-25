import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import {
    collection,
    query,
    where,
    getDocs
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

import {
    auth,
    db
} from "./firebase-config.js";


/* ==================================================
   DASHBOARD ELEMENTS
================================================== */

const assignedPRList =
    document.getElementById("assignedPRList");

const assignedPRCount =
    document.getElementById("assignedPRCount");

const pendingReviewCount =
    document.getElementById("pendingReviewCount");

const completedReviewCount =
    document.getElementById("completedReviewCount");

const reviewerSkillScore =
    document.getElementById("reviewerSkillScore");


/* ==================================================
   CHECK AUTHENTICATION
================================================== */

onAuthStateChanged(auth, async (user) => {

    if (!user) {

        window.location.href =
            "../index.html";

        return;
    }


    console.log(
        "Reviewer logged in:",
        user.email
    );


    await loadReviewerData(
        user.uid
    );

});


/* ==================================================
   LOAD REVIEWER DATA
================================================== */

async function loadReviewerData(uid) {

    try {

        /*
         * Find pull requests assigned
         * to the currently logged-in reviewer.
         */

        const prQuery = query(
            collection(
                db,
                "pullRequests"
            ),
            where(
                "reviewerId",
                "==",
                uid
            )
        );


        const snapshot =
            await getDocs(prQuery);


        console.log(
            "Assigned PRs:",
            snapshot.size
        );


        /*
         * Update assigned PR count.
         */

        if (assignedPRCount) {

            assignedPRCount.textContent =
                snapshot.size;

        }


        /*
         * Clear existing sample PRs.
         */

        if (assignedPRList) {

            assignedPRList.innerHTML = "";

        }


        /*
         * No assigned PRs.
         */

        if (snapshot.empty) {

            if (assignedPRList) {

                assignedPRList.innerHTML = `

                    <div class="empty-pr">

                        <div class="empty-icon">
                            📂
                        </div>

                        <strong>
                            No PRs Assigned Yet
                        </strong>

                        <span>
                            Pull requests assigned to you
                            will appear here.
                        </span>

                    </div>

                `;

            }


            if (pendingReviewCount) {

                pendingReviewCount.textContent =
                    "0";

            }


            await loadCompletedReviews(uid);

            return;
        }


        let pending = 0;


        /*
         * Display every assigned PR.
         */

        snapshot.forEach((docSnapshot) => {

            const pr =
                docSnapshot.data();


            const status =
                pr.status || "Open";


            /*
             * Count pending reviews.
             */

            if (
                status === "Open" ||
                status === "In Review"
            ) {

                pending++;

            }


            /*
             * Decide status styling.
             */

            let statusClass =
                "open";

            let statusBadge =
                "open-status";


            if (
                status === "In Review"
            ) {

                statusClass =
                    "review";

                statusBadge =
                    "review-status";

            }


            if (
                status === "Merged" ||
                status === "Approved"
            ) {

                statusClass =
                    "merged";

                statusBadge =
                    "merged-status";

            }


            if (
                status === "Changes Requested"
            ) {

                statusClass =
                    "review";

                statusBadge =
                    "review-status";

            }


            /*
             * Create PR card.
             */

            const item =
                document.createElement("div");


            item.className =
                "pr-item";


            item.innerHTML = `

                <div class="pr-status ${statusClass}">
                    ●
                </div>


                <div class="pr-info">

                    <strong>
                        ${escapeHTML(
                            pr.title ||
                            "Untitled Pull Request"
                        )}
                    </strong>


                    <span>
                        #PR-${escapeHTML(
                            pr.number ||
                            docSnapshot.id
                        )}

                        ·

                        ${escapeHTML(
                            pr.repository ||
                            "GitHub"
                        )}
                    </span>


                    <div class="tags">

                        <span class="tag blue-tag">

                            ${escapeHTML(
                                pr.category ||
                                "Code Review"
                            )}

                        </span>


                        <span class="tag purple-tag">

                            ${escapeHTML(
                                pr.language ||
                                "GitHub"
                            )}

                        </span>

                    </div>

                </div>


                <div class="pr-state">

                    <span class="status ${statusBadge}">

                        ${escapeHTML(
                            status
                        )}

                    </span>

                </div>

            `;


            /*
             * Clicking the PR opens
             * our Review PR page.
             */

            item.addEventListener(
                "click",
                () => {

                    window.location.href =
                        `review-pr.html?id=${encodeURIComponent(
                            docSnapshot.id
                        )}`;

                }
            );


            /*
             * Make it look clickable.
             */

            item.style.cursor =
                "pointer";


            if (assignedPRList) {

                assignedPRList.appendChild(
                    item
                );

            }

        });


        /*
         * Update pending count.
         */

        if (pendingReviewCount) {

            pendingReviewCount.textContent =
                pending;

        }


        /*
         * Load completed reviews.
         */

        await loadCompletedReviews(
            uid
        );


    } catch (error) {

        console.error(
            "Reviewer dashboard error:",
            error
        );


        if (assignedPRList) {

            assignedPRList.innerHTML = `

                <div class="empty-pr">

                    <strong>
                        Unable to load reviewer data
                    </strong>

                    <span>
                        Check your Firebase connection
                        and Firestore data.
                    </span>

                </div>

            `;

        }

    }

}


/* ==================================================
   LOAD COMPLETED REVIEWS
================================================== */

async function loadCompletedReviews(uid) {

    try {

        const reviewQuery = query(
            collection(
                db,
                "reviews"
            ),
            where(
                "reviewerId",
                "==",
                uid
            )
        );


        const snapshot =
            await getDocs(reviewQuery);


        if (completedReviewCount) {

            completedReviewCount.textContent =
                snapshot.size;

        }


        /*
         * Simple reviewer score.
         *
         * For now:
         * 1 completed review = 10%
         * maximum = 100%
         */

        const score =
            Math.min(
                snapshot.size * 10,
                100
            );


        if (reviewerSkillScore) {

            reviewerSkillScore.textContent =
                `${score}%`;

        }


        const scoreCircle =
            document.getElementById(
                "skillScoreCircle"
            );


        if (scoreCircle) {

            scoreCircle.textContent =
                `${score}%`;

        }


    } catch (error) {

        console.log(
            "No review history yet:",
            error
        );


        if (completedReviewCount) {

            completedReviewCount.textContent =
                "0";

        }

    }

}


/* ==================================================
   ESCAPE HTML
================================================== */

function escapeHTML(value) {

    const div =
        document.createElement(
            "div"
        );


    div.textContent =
        value ?? "";


    return div.innerHTML;

}