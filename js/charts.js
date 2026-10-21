/* Dependency-free SVG/HTML charts. Each function returns an HTML string.
   Every chart carries an aria-label that summarises its data. */

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const STATUS_COLORS = {
    "Open": "#60a5fa", "In Review": "#a78bfa", "Changes Requested": "#fbbf24",
    "Approved": "#34d399", "Merged": "#2dd4bf"
};

export function legend(items) {
    return `<div class="legend">${items.map((i) => `<span><i style="background:${i.color}"></i>${esc(i.label)}${i.value !== undefined ? ` (${esc(i.value)})` : ""}</span>`).join("")}</div>`;
}

/* ---------- Donut ---------- */
export function donut(segments, { size = 170, thickness = 20, top = "", bottom = "", label = "Distribution" } = {}) {
    const r = (size - thickness) / 2, c = 2 * Math.PI * r, mid = size / 2;
    const total = segments.reduce((a, s) => a + s.value, 0);
    let offset = 0;
    const arcs = total
        ? segments.filter((s) => s.value > 0).map((s) => {
            const len = (s.value / total) * c;
            const el = `<circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${thickness}" stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${mid} ${mid})"/>`;
            offset += len;
            return el;
        }).join("")
        : "";
    const summary = `${label}: ` + segments.map((s) => `${s.label} ${s.value}`).join(", ");
    return `<svg class="chart" role="img" aria-label="${esc(summary)}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="rgba(148,163,184,.14)" stroke-width="${thickness}"/>
        ${arcs}
        <text x="${mid}" y="${mid + (bottom ? 2 : 8)}" text-anchor="middle" class="strong" style="font-size:${size / 6}px">${esc(top)}</text>
        ${bottom ? `<text x="${mid}" y="${mid + 20}" text-anchor="middle">${esc(bottom)}</text>` : ""}
    </svg>${legend(segments.map((s) => ({ label: s.label, color: s.color, value: s.value })))}`;
}

/* ---------- Columns ---------- */
export function columns(items, { height = 160, label = "Counts" } = {}) {
    const n = Math.max(items.length, 1), w = Math.max(300, n * 46), pad = 22, innerH = height - pad - 20;
    const max = Math.max(...items.map((i) => i.value), 1);
    const bw = Math.min(28, (w / n) * 0.55);
    const bars = items.map((it, i) => {
        const x = (w / n) * i + (w / n - bw) / 2, h = (it.value / max) * innerH, y = height - 20 - h;
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw}" height="${Math.max(h, 0).toFixed(1)}" rx="5" fill="${it.color || "var(--accent)"}" opacity=".92"/>
                <text x="${(x + bw / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" class="strong" style="font-size:11px">${it.value}</text>
                <text x="${(x + bw / 2).toFixed(1)}" y="${height - 4}" text-anchor="middle">${esc(it.label)}</text>`;
    }).join("");
    return `<svg class="chart" role="img" aria-label="${esc(label + ": " + items.map((i) => `${i.label} ${i.value}`).join(", "))}" width="100%" viewBox="0 0 ${w} ${height}" preserveAspectRatio="xMidYMid meet" style="max-height:${height}px">${bars}</svg>`;
}

/* ---------- Line / area ---------- */
export function line(points, { height = 150, label = "Trend" } = {}) {
    const w = 360, padX = 14, top = 14, bottom = 24, innerH = height - top - bottom;
    const max = Math.max(...points.map((p) => p.value), 1);
    const step = points.length > 1 ? (w - padX * 2) / (points.length - 1) : 0;
    const xy = points.map((p, i) => [padX + step * i, top + innerH - (p.value / max) * innerH]);
    const path = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
    const area = xy.length ? `${path} L${xy[xy.length - 1][0].toFixed(1)} ${height - bottom} L${xy[0][0].toFixed(1)} ${height - bottom} Z` : "";
    const every = Math.ceil(points.length / 6);
    return `<svg class="chart" role="img" aria-label="${esc(label + ": " + points.map((p) => `${p.label} ${p.value}`).join(", "))}" width="100%" viewBox="0 0 ${w} ${height}" style="max-height:${height}px">
        <path d="${area}" fill="var(--accent)" opacity=".14"/>
        <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
        ${xy.map(([x, y], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.6" fill="var(--accent)"/>${i % every === 0 ? `<text x="${x.toFixed(1)}" y="${height - 6}" text-anchor="middle">${esc(points[i].label)}</text>` : ""}`).join("")}
    </svg>`;
}

/* ---------- Radar (values 0-100 or null) ---------- */
export function radar(items, { size = 270, label = "Skill scores" } = {}) {
    const n = items.length, mid = size / 2, R = size / 2 - 46, pad = 78;
    const pt = (i, v) => { const a = (Math.PI * 2 * i) / n - Math.PI / 2; return [mid + Math.cos(a) * R * v, mid + Math.sin(a) * R * v]; };
    const ring = (f) => items.map((_, i) => pt(i, f).map((v) => v.toFixed(1)).join(",")).join(" ");
    const poly = items.map((it, i) => pt(i, (it.value ?? 0) / 100).map((v) => v.toFixed(1)).join(",")).join(" ");
    const hasData = items.some((i) => i.value !== null && i.value !== undefined);
    const labels = items.map((it, i) => {
        const [x, y] = pt(i, 1.2);
        const anchor = x < mid - 6 ? "end" : x > mid + 6 ? "start" : "middle";
        return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${anchor}">${esc(it.label)}${it.value == null ? " —" : ` ${it.value}%`}</text>`;
    }).join("");
    const dots = items.map((it, i) => it.value == null ? "" : `<circle cx="${pt(i, it.value / 100)[0].toFixed(1)}" cy="${pt(i, it.value / 100)[1].toFixed(1)}" r="4" fill="var(--accent)"/>`).join("");
    return `<svg class="chart" role="img" aria-label="${esc(label + ": " + items.map((i) => `${i.label} ${i.value == null ? "not assessed" : i.value + "%"}`).join(", "))}" width="100%" viewBox="${-pad} 0 ${size + pad * 2} ${size}" style="max-width:${size + pad * 2}px">
        ${[.25, .5, .75, 1].map((f) => `<polygon points="${ring(f)}" fill="none" stroke="rgba(148,163,184,.2)"/>`).join("")}
        ${items.map((_, i) => `<line x1="${mid}" y1="${mid}" x2="${pt(i, 1)[0].toFixed(1)}" y2="${pt(i, 1)[1].toFixed(1)}" stroke="rgba(148,163,184,.16)"/>`).join("")}
        ${hasData ? `<polygon points="${poly}" fill="var(--accent)" fill-opacity=".22" stroke="var(--accent)" stroke-width="2"/>${dots}` : ""}
        ${labels}
    </svg>`;
}

/* ---------- Ring score ---------- */
export function ring(score, { size = 120, caption = "" } = {}) {
    const t = 11, r = (size - t) / 2, c = 2 * Math.PI * r, mid = size / 2, len = (Math.max(0, Math.min(score, 100)) / 100) * c;
    return `<svg class="chart" role="img" aria-label="Score ${score} percent" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="rgba(148,163,184,.16)" stroke-width="${t}"/>
        <circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="var(--accent)" stroke-width="${t}" stroke-linecap="round" stroke-dasharray="${len.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${mid} ${mid})"/>
        <text x="${mid}" y="${mid + 7}" text-anchor="middle" class="strong" style="font-size:${size / 4}px">${score}%</text>
        ${caption ? `<text x="${mid}" y="${mid + 26}" text-anchor="middle">${esc(caption)}</text>` : ""}
    </svg>`;
}

/* ---------- Horizontal bars (HTML) ---------- */
export function hbars(items, { max, format = (v) => v, cls = "" } = {}) {
    const top = max ?? Math.max(...items.map((i) => i.value), 1);
    return items.map((i) => `<div class="bar-row"><span>${esc(i.label)}</span>
        <div class="meter ${i.cls || cls}" role="presentation"><i style="width:${top ? Math.min(100, (i.value / top) * 100) : 0}%${i.color ? `;background:${i.color}` : ""}"></i></div>
        <span class="v">${esc(format(i.value))}</span></div>`).join("");
}

/* ---------- Contribution heat grid ---------- */
export function heatmap(counts, { weeks = 14, now = Date.now(), label = "Activity" } = {}) {
    const day = 86_400_000, end = new Date(now); end.setHours(0, 0, 0, 0);
    const start = new Date(end.getTime() - (weeks * 7 - 1) * day);
    const cells = [];
    for (let i = 0; i < start.getDay(); i++) cells.push(`<i style="visibility:hidden"></i>`);
    let total = 0;
    for (let t = start.getTime(); t <= end.getTime(); t += day) {
        const d = new Date(t), key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const n = counts[key] || 0; total += n;
        cells.push(`<i data-l="${n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : 3}" title="${key}: ${n} event(s)"></i>`);
    }
    return `<div class="heat" role="img" aria-label="${esc(`${label}: ${total} events in the last ${weeks} weeks`)}">${cells.join("")}</div>`;
}

export function dayKey(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
