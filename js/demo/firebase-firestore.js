/*
 * In-memory Firestore adapter used for:
 *   - Demo Mode in the browser (persisted in localStorage, seeded from dataset.js)
 *   - automated tests (no persistence, no seeding, failure injection)
 * It implements only the Firestore API this app uses.
 */
import { buildDemoDataset, reviveTimestamps } from "./dataset.js";

const KEY = "pcrt-demo-db-v1";
const ls = (() => { try { return globalThis.localStorage || null; } catch { return null; } })();

export class Timestamp {
    constructor(ms) { this.ms = ms; }
    toMillis() { return this.ms; }
    toDate() { return new Date(this.ms); }
    toJSON() { return { __ts: this.ms }; }
    static fromMillis(ms) { return new Timestamp(ms); }
    static now() { return new Timestamp(Date.now()); }
}

const store = globalThis.__fakeDb || (globalThis.__fakeDb = {
    cols: new Map(), clock: Date.now(), denyReads: new Set(), denyWrites: new Set(), log: []
});

const col = (name) => { if (!store.cols.has(name)) store.cols.set(name, new Map()); return store.cols.get(name); };
const persistOn = () => !!(globalThis.__PCRT_DEMO__ && ls);

function persist() {
    if (!persistOn()) return;
    const obj = {};
    for (const [name, docs] of store.cols) obj[name] = Object.fromEntries(docs);
    try { ls.setItem(KEY, JSON.stringify(obj)); } catch (e) { console.warn("Demo data could not be saved:", e); }
}

function fillFrom(obj) {
    store.cols.clear();
    const live = reviveTimestamps(obj, (ms) => new Timestamp(ms));
    for (const [name, docs] of Object.entries(live)) store.cols.set(name, new Map(Object.entries(docs)));
}

function seedDemo() {
    const d = buildDemoDataset(Date.now());
    const obj = { users: {}, pullRequests: {}, reviews: {} };
    d.users.forEach((x) => { obj.users[x.id] = x.data; });
    d.pullRequests.forEach((x) => { obj.pullRequests[x.id] = x.data; });
    d.reviews.forEach((x) => { obj.reviews[x.id] = x.data; });
    fillFrom(obj);
    persist();
}

if (globalThis.__PCRT_DEMO__) {
    let raw = null;
    try { raw = ls && ls.getItem(KEY); } catch { raw = null; }
    if (raw) { try { fillFrom(JSON.parse(raw)); } catch { seedDemo(); } } else seedDemo();
}

/* Demo helpers (not part of the real SDK). */
export function demoReset() { try { ls && ls.removeItem(KEY); ls && ls.removeItem("pcrt-demo-uid"); } catch {} seedDemo(); }
export function demoStore() { return store; }

const SERVER_TS = { __serverTimestamp: true };
export function serverTimestamp() { return SERVER_TS; }
function resolveTs(data) {
    const out = {};
    for (const [k, v] of Object.entries(data)) out[k] = v === SERVER_TS ? new Timestamp(Math.max(Date.now(), store.clock += 1000)) : v;
    return out;
}

function injected(kind, name) {
    if ((kind === "reads" ? store.denyReads : store.denyWrites).has(name)) return true;
    try { return !!ls && JSON.parse(ls.getItem(`pcrt-demo-deny-${kind}`) || "[]").includes(name); } catch { return false; }
}
function denied() { const e = new Error("Missing or insufficient permissions."); e.code = "permission-denied"; return e; }

export function getFirestore() { return { demo: true }; }
export function collection(db, name) { return { type: "collection", name }; }
let autoId = 0;
export function doc(a, b, c) {
    if (a && a.type === "collection") return { type: "doc", col: a.name, id: "auto" + Date.now().toString(36) + (++autoId) };
    return { type: "doc", col: b, id: c };
}
export function where(field, op, value) { return { type: "where", field, op, value }; }
export function query(colRef, ...constraints) { return { type: "query", col: colRef.name, constraints }; }

function matches(data, c) {
    const v = data[c.field];
    switch (c.op) {
        case "==": return v === c.value;
        case "!=": return v !== c.value;
        case "in":
            if (c.value.length > 30) throw new Error("Firestore 'in' supports at most 30 values");
            return c.value.includes(v);
        case "array-contains": return Array.isArray(v) && v.includes(c.value);
        default: throw new Error("Unsupported operator " + c.op);
    }
}
const snapDoc = (id, data, colName) => ({ id, ref: { type: "doc", col: colName, id }, exists: () => true, data: () => ({ ...data }) });

export async function getDocs(q) {
    const name = q.type === "query" ? q.col : q.name;
    if (injected("reads", name)) throw denied();
    const cs = q.type === "query" ? q.constraints : [];
    const docs = [];
    for (const [id, data] of col(name)) if (cs.every((c) => matches(data, c))) docs.push(snapDoc(id, data, name));
    return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn) => docs.forEach(fn) };
}
export async function getDoc(ref) {
    if (injected("reads", ref.col)) throw denied();
    const data = col(ref.col).get(ref.id);
    return data
        ? { id: ref.id, exists: () => true, data: () => ({ ...data }), ref }
        : { id: ref.id, exists: () => false, data: () => undefined, ref };
}

/* Audit log of every write: the exact payload (server timestamps kept as markers), who wrote it, and how. */
const actorUid = () => { try { return globalThis.__fakeAuth?.currentUser?.uid ?? null; } catch { return null; } };
const rawCopy = (data) => JSON.parse(JSON.stringify(data));
function logWrite(op, ref, data, next, meta) {
    store.log.push({ op, path: `${ref.col}/${ref.id}`, data: next, raw: rawCopy(data), actor: actorUid(), via: meta?.via || "single", group: meta?.group ?? null });
}

function applySet(ref, data, merge, meta) {
    if (injected("writes", ref.col)) throw denied();
    const next = resolveTs(data);
    col(ref.col).set(ref.id, merge ? { ...(col(ref.col).get(ref.id) || {}), ...next } : next);
    logWrite("set", ref, data, next, meta);
}
function applyUpdate(ref, patch, meta) {
    if (injected("writes", ref.col)) throw denied();
    const cur = col(ref.col).get(ref.id);
    if (!cur) { const e = new Error("No document to update"); e.code = "not-found"; throw e; }
    const next = resolveTs(patch);
    col(ref.col).set(ref.id, { ...cur, ...next });
    logWrite("update", ref, patch, next, meta);
}
let groupSeq = 0;
const snapshot = () => new Map([...store.cols].map(([k, v]) => [k, new Map(v)]));

export async function setDoc(ref, data, opts) { applySet(ref, data, opts && opts.merge); persist(); }
export async function updateDoc(ref, patch) { applyUpdate(ref, patch); persist(); }
export async function addDoc(colRef, data) {
    const ref = doc(colRef); applySet(ref, data); persist(); return ref;
}
export function writeBatch() {
    const ops = [];
    const meta = { via: "batch", group: ++groupSeq };
    return {
        set(ref, data, opts) { ops.push(() => applySet(ref, data, opts && opts.merge, meta)); return this; },
        update(ref, patch) { ops.push(() => applyUpdate(ref, patch, meta)); return this; },
        async commit() {
            const snap = snapshot();
            try { ops.forEach((f) => f()); } catch (e) { store.cols = snap; throw e; }
            persist();
        }
    };
}
export async function runTransaction(db, fn) {
    const writes = [];
    const meta = { via: "transaction", group: ++groupSeq };
    const tx = {
        async get(ref) { return getDoc(ref); },
        set(ref, data, opts) { writes.push(() => applySet(ref, data, opts && opts.merge, meta)); return tx; },
        update(ref, patch) { writes.push(() => applyUpdate(ref, patch, meta)); return tx; }
    };
    const result = await fn(tx);
    const snap = snapshot();
    try { writes.forEach((f) => f()); } catch (e) { store.cols = snap; throw e; }
    persist();
    return result;
}
