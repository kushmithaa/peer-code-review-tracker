// Test helpers: fake DOM + fake Firebase state per scenario.
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
export const fakeDb = () => globalThis.__fakeDb;
export const fakeAuth = () => globalThis.__fakeAuth;

export function resetFirebase() {
  const db = fakeDb(); const au = fakeAuth();
  if (db) { db.cols.clear(); db.denyReads.clear(); db.denyWrites.clear(); db.log.length = 0; }
  if (au) { au.accounts.clear(); au.currentUser = null; au.listeners.clear(); }
}
export function seed(colName, id, data) {
  const db = fakeDb();
  if (!db.cols.has(colName)) db.cols.set(colName, new Map());
  db.cols.get(colName).set(id, data);
}
export function addAccount(uid, email, role, name) {
  fakeAuth().accounts.set(email, { uid, password: "pw" });
  seed("users", uid, { uid, name, email, role, createdAt: "2026-01-01T00:00:00.000Z" });
}
export function login(uid, email) { fakeAuth().currentUser = { uid, email, displayName: null }; }
export const get = (c, id) => fakeDb().cols.get(c)?.get(id);
export const all = (c) => [...(fakeDb().cols.get(c) || new Map()).entries()].map(([id, d]) => ({ id, ...d }));

/* Load a page's HTML into a global DOM, import its script, return handles. */
export async function openPage(relPath, { search = "", hash = "", fetchImpl } = {}) {
  const file = path.join(ROOT, relPath);
  const html = fs.readFileSync(file, "utf8").replace(/<script[^>]*src=[^>]*><\/script>/g, "");
  const url = `http://localhost:3000/${relPath.replace(/\\/g, "/")}${search}${hash}`;
  const dom = new JSDOM(html, { url, pretendToBeVisual: true });
  const nav = [];
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.__testNavigate = (u) => nav.push(u);
  globalThis.alert = () => {};
  globalThis.URLSearchParams = dom.window.URLSearchParams;
  if (fetchImpl) globalThis.fetch = fetchImpl;
  const errors = [];
  const origErr = console.error;
  console.error = (...a) => { errors.push(a.map(String).join(" ")); };
  const scriptSrc = (/<script[^>]*type="module"[^>]*src="([^"]+)"/.exec(fs.readFileSync(file, "utf8")) ||
                     /src="([^"]+)"[^>]*type="module"/.exec(fs.readFileSync(file, "utf8")) || [])[1];
  const jsUrl = new URL(scriptSrc, "file://" + file).href + "?t=" + Math.random();
  // A page that redirects (route guard) intentionally never finishes loading, so don't wait forever.
  let importError = null;
  await Promise.race([
    import(jsUrl).catch((e) => { importError = e; }),
    settle(500)
  ]);
  await settle();
  console.error = origErr;
  if (importError) throw importError;
  return { dom, document: dom.window.document, nav, errors, scriptSrc,
           $: (s) => dom.window.document.querySelector(s), $$: (s) => [...dom.window.document.querySelectorAll(s)] };
}
export const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
export function click(el) { el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent("click", { bubbles: true, cancelable: true })); }
export function setValue(el, v, evt = "input") {
  el.value = v; el.dispatchEvent(new el.ownerDocument.defaultView.Event(evt, { bubbles: true }));
}
