/*
 * Classic script - must run BEFORE any module script.
 * Chooses between LIVE Firebase and DEMO mode (local only).
 *   ?demo=1  -> switch to demo mode (remembered in this browser)
 *   ?demo=0  -> back to live Firebase
 * In demo mode an import map redirects the Firebase SDK imports to
 * local in-memory adapters, so nothing is ever sent to Firebase.
 */
(function () {
    var demo = false;
    try {
        var q = new URLSearchParams(window.location.search).get("demo");
        if (q === "1") localStorage.setItem("pcrt-mode", "demo");
        if (q === "0") localStorage.setItem("pcrt-mode", "live");
        demo = localStorage.getItem("pcrt-mode") === "demo";
    } catch (e) { demo = false; }

    window.__PCRT_DEMO__ = demo;
    if (!demo) return;

    var here = document.currentScript.src;
    var cdn = "https://www.gstatic.com/firebasejs/12.19.0/";
    var map = {};
    ["firebase-app.js", "firebase-auth.js", "firebase-firestore.js"].forEach(function (f) {
        map[cdn + f] = new URL("demo/" + f, here).href;
    });
    var tag = document.createElement("script");
    tag.type = "importmap";
    tag.textContent = JSON.stringify({ imports: map });
    document.head.appendChild(tag);
})();
