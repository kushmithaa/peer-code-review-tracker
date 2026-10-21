// Maps the Firebase CDN URLs to the local in-memory adapters (same ones Demo Mode uses).
const MAP = {
  "firebase-app.js": "../js/demo/firebase-app.js",
  "firebase-auth.js": "../js/demo/firebase-auth.js",
  "firebase-firestore.js": "../js/demo/firebase-firestore.js"
};
export async function resolve(specifier, context, next) {
  const m = /^https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/(firebase-[a-z]+\.js)$/.exec(specifier);
  if (m) return { url: new URL(MAP[m[1]], import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
