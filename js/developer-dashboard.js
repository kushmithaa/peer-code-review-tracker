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


const pullRequestContainer =
    document.getElementById("pullRequestList");


onAuthStateChanged(auth, async (user) => {

    if (!user) {
        window.location.href = "../index.html";
        return;
    }

    console.log("Logged-in user:", user.email);

    await loadPullRequests(user.uid);
});


async function loadPullRequests(userId) {

    try {

        const pullRequestsQuery = query(
            collection(db, "pullRequests"),
            where("authorId", "==", userId)
        );

        const snapshot =
            await getDocs(pullRequestsQuery);


        if (snapshot.empty) {

            pullRequestContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📂</div>

                    <h3>No Pull Requests Yet</h3>

                    <p>
                        Your GitHub pull requests will appear here.
                    </p>
                </div>
            `;

            return;
        }


        pullRequestContainer.innerHTML = "";


        snapshot.forEach((docSnapshot) => {

            const pr = docSnapshot.data();


            const card = document.createElement("div");

            card.className = "pull-request-item";


            card.innerHTML = `
                <div class="pr-left">

                    <div class="pr-status"></div>

                    <div>
                        <h3>
                            ${escapeHTML(pr.title)}
                        </h3>

                        <p>
                            #${escapeHTML(pr.number)}
                            ·
                            ${escapeHTML(pr.repository)}
                        </p>

                        <div class="pr-tags">
                            <span class="tag">
                                GitHub
                            </span>

                            <span class="tag">
                                ${escapeHTML(pr.status)}
                            </span>
                        </div>
                    </div>

                </div>

                <div class="pr-right">

                    <span class="status">
                        ${escapeHTML(pr.status)}
                    </span>

                    <a
                        href="${escapeHTML(pr.githubUrl)}"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="github-link"
                    >
                        View on GitHub ↗
                    </a>

                </div>
            `;


            pullRequestContainer.appendChild(card);

        });


    } catch (error) {

        console.error(
            "Error loading pull requests:",
            error
        );

        pullRequestContainer.innerHTML = `
            <div class="error-state">
                Unable to load pull requests.
            </div>
        `;
    }
}


function escapeHTML(value) {

    const div = document.createElement("div");

    div.textContent = value ?? "";

    return div.innerHTML;
}