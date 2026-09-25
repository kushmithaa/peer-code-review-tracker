import { onAuthStateChanged } from
    "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import {
    collection,
    query,
    where,
    getDocs
} from
    "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

import {
    auth,
    db
} from "./firebase-config.js";


/* ===============================
   Get Dashboard Elements
================================ */

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


/* ===============================
   Check Login
================================ */

onAuthStateChanged(auth, async (user) => {

    if (!user) {

        window.location.href = "../index.html";

        return;
    }

    console.log(
        "Reviewer logged in:",
        user.email
    );

    await loadReviewerData(user.uid);

});


/* ===============================
   Load Reviewer Data
================================ */

async function loadReviewerData(uid) {

    try {

        /*
         * Find PRs assigned to this reviewer
         */

        const prQuery = query(
            collection(db, "pullRequests"),
            where("reviewerId", "==", uid)
        );


        const snapshot =
            await getDocs(prQuery);


        console.log(
            "Assigned PRs:",
            snapshot.size
        );


        /*
         * Update PR count
         */

        assignedPRCount.textContent =
            snapshot.size;


        /*
         * Clear sample PRs
         */

        assignedPRList.innerHTML = "";


        /*
         * No assigned PRs
         */

        if (snapshot.empty) {

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

            pendingReviewCount.textContent = "0";

            return;
        }


        let pending = 0;


        /*
         * Display assigned PRs
         */

        snapshot.forEach((docSnapshot) => {

            const pr =
                docSnapshot.data();


            const status =
                pr.status || "Open";


            if (
                status === "Open" ||
                status === "In Review"
            ) {

                pending++;

            }


            let statusClass = "open";

            let statusBadge = "open-status";


            if (status === "In Review") {

                statusClass = "review";

                statusBadge = "review-status";

            }


            if (status === "Merged") {

                statusClass = "merged";

                statusBadge = "merged-status";

            }


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
                        ${escapeHTML(pr.title)}
                    </strong>

                    <span>
                        #PR-${escapeHTML(pr.number)}
                        ·
                        ${escapeHTML(
                            pr.repository || "GitHub"
                        )}
                    </span>


                    <div class="tags">

                        <span class="tag blue-tag">
                            ${escapeHTML(
                                pr.category || "Code Review"
                            )}
                        </span>

                        <span class="tag purple-tag">
                            ${escapeHTML(
                                pr.language || "GitHub"
                            )}
                        </span>

                    </div>

                </div>


                <div class="pr-state">

                    <span class="status ${statusBadge}">
                        ${escapeHTML(status)}
                    </span>

                </div>

            `;


            /*
             * Open GitHub PR
             */

            item.addEventListener(
                "click",
                () => {

                    if (pr.githubUrl) {

                        window.open(
                            pr.githubUrl,
                            "_blank"
                        );

                    }

                }
            );


            assignedPRList.appendChild(item);

        });


        /*
         * Update pending count
         */

        pendingReviewCount.textContent =
            pending;


        /*
         * Completed reviews
         */

        await loadCompletedReviews(uid);


    } catch (error) {

        console.error(
            "Reviewer dashboard error:",
            error
        );


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


/* ===============================
   Completed Reviews
================================ */

async function loadCompletedReviews(uid) {

    try {

        const reviewQuery = query(
            collection(db, "reviews"),
            where("reviewerId", "==", uid)
        );


        const snapshot =
            await getDocs(reviewQuery);


        completedReviewCount.textContent =
            snapshot.size;


    } catch (error) {

        console.log(
            "No review history yet."
        );

        completedReviewCount.textContent =
            "0";

    }

}


/* ===============================
   HTML Safety
================================ */

function escapeHTML(value) {

    const div =
        document.createElement("div");

    div.textContent =
        value ?? "";

    return div.innerHTML;

}