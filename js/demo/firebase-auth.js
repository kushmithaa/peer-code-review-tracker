/*
 * In-memory Auth adapter.
 * Demo Mode has NO passwords: people sign in by choosing a demo persona
 * (demoSignIn). Passwords only exist in automated tests.
 */
import { demoStore } from "./firebase-firestore.js";

const SKEY = "pcrt-demo-uid";
const ss = (() => { try { return globalThis.sessionStorage || null; } catch { return null; } })();

const state = globalThis.__fakeAuth || (globalThis.__fakeAuth = {
    accounts: new Map(),   // email -> { uid, password? }
    currentUser: null,
    listeners: new Set()
});

function userDocs() { return demoStore().cols.get("users") || new Map(); }

if (globalThis.__PCRT_DEMO__ && ss) {
    const uid = ss.getItem(SKEY);
    const u = uid && userDocs().get(uid);
    if (u) state.currentUser = { uid, email: u.email, displayName: u.name };
}

const authObj = { get currentUser() { return state.currentUser; } };
export function getAuth() { return authObj; }

function notify() { for (const cb of [...state.listeners]) Promise.resolve().then(() => cb(state.currentUser)); }
function remember() { try { state.currentUser ? ss && ss.setItem(SKEY, state.currentUser.uid) : ss && ss.removeItem(SKEY); } catch {} }
function fail(code) { const e = new Error(code); e.code = code; return e; }

export function onAuthStateChanged(auth, cb) {
    state.listeners.add(cb);
    Promise.resolve().then(() => cb(state.currentUser));
    return () => state.listeners.delete(cb);
}
export async function signOut() { state.currentUser = null; remember(); notify(); }

export async function signInWithEmailAndPassword(auth, email, password) {
    const a = state.accounts.get(email);
    if (!a || a.password === undefined || a.password !== password) throw fail("auth/invalid-credential");
    state.currentUser = { uid: a.uid, email, displayName: null };
    remember(); notify();
    return { user: state.currentUser };
}

export async function createUserWithEmailAndPassword(auth, email, password) {
    if (state.accounts.has(email) || [...userDocs().values()].some((u) => u.email === email)) throw fail("auth/email-already-in-use");
    if (String(password).length < 6) throw fail("auth/weak-password");
    const uid = "uid-" + email.split("@")[0];
    state.accounts.set(email, { uid });                    // password is never stored
    state.currentUser = { uid, email, displayName: null };
    remember(); notify();
    return { user: state.currentUser };
}

/* ---- demo-only helpers (not in the real SDK) ---- */
export function demoPersonas() {
    return [...userDocs().entries()].map(([uid, u]) => ({ uid, name: u.name, email: u.email, role: u.role }));
}
export async function demoSignIn(uid) {
    const u = userDocs().get(uid);
    if (!u) throw fail("auth/user-not-found");
    state.currentUser = { uid, email: u.email, displayName: u.name };
    remember(); notify();
    return { user: state.currentUser };
}
