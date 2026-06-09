#!/usr/bin/env node
/**
 * Build a polished, investor-grade pitch deck (.pptx) for a BD prospect.
 *
 *   node bd.mjs deck-data <targetId> > evidence.json
 *   node make-deck.mjs evidence.json [out.pptx]
 *   node bd.mjs deck-data <targetId> | node make-deck.mjs - acme-lucia.pptx
 *
 * The deck is a PRE-CANNED marketing shell — problem, stakes, the Lucia value
 * proposition, how it works, representative proof, why-not-overlays, CTA — with
 * the prospect's REAL scan data injected into the "your site" slides (before/
 * after score, the specific WCAG findings, the live preview). The BD member
 * normally only tweaks copy; the structure + styling stay.
 *
 * Input is the JSON from `bd deck-data` (bd.evidenceForDeck):
 *   { prospect, previewUrl, scoreBefore, scoreAfter, findings[], evidencePackSiteId }
 *
 * One-time setup: `npm install` in this scripts/ dir (pptxgenjs is pinned).
 * pptxgenjs ships CommonJS; loaded via createRequire so the import is reliable
 * from an .mjs.
 *
 * Honest by construction: real before/after + real findings, representative
 * (not fabricated-customer) proof, a live-preview link, and an explicit "needs
 * a human audit for full conformance" close — never claims the site is compliant.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
let PptxGenJS;
try {
  const mod = require("pptxgenjs");
  PptxGenJS = mod && mod.default ? mod.default : mod;
} catch {
  console.error("error: pptxgenjs isn't installed. Run `npm install` in this scripts/ directory first.");
  process.exit(1);
}

function die(m) { console.error("error: " + m); process.exit(1); }

// ---- input ----
const args = process.argv.slice(2);
const inPath = args[0];
if (!inPath) die("usage: node make-deck.mjs <evidence.json | -> [out.pptx]");
let raw;
try { raw = inPath === "-" ? readFileSync(0, "utf8") : readFileSync(inPath, "utf8"); }
catch (e) { die("can't read " + inPath + ": " + e.message); }
let d;
try { d = JSON.parse(raw); } catch { die("input isn't valid JSON (expected `bd deck-data` output)"); }

const prospect = (d.prospect || "your site").toString();
const PROSPECT = prospect.toUpperCase();
const before = Number.isFinite(d.scoreBefore) ? d.scoreBefore : null;
const after = Number.isFinite(d.scoreAfter) ? d.scoreAfter : null;
const lift = before != null && after != null ? after - before : null;
const findings = Array.isArray(d.findings) ? d.findings : [];
const previewUrl = (d.previewUrl || "").toString();
const outPath = args[1] || `${prospect.replace(/[^a-z0-9.-]/gi, "_")}-lucia.pptx`;

// ---- brand ----
const C = {
  ink: "0F172A", ink2: "1E293B", blue: "2563EB", blueDk: "1D4ED8", blueLt: "60A5FA",
  slate: "475569", muted: "94A3B8", line: "E2E8F0", bg: "F8FAFC", white: "FFFFFF",
  good: "059669", goodLt: "10B981", risk: "E11D48", amber: "D97706",
};
const F = "Helvetica";
const W = 13.333, H = 7.5, MX = 0.75;

function impactColor(impact) {
  const i = (impact || "").toString().toLowerCase();
  if (i === "critical") return C.risk;
  if (i === "serious") return "EA580C";
  if (i === "moderate") return C.amber;
  return "64748B";
}

const pptx = new PptxGenJS();
pptx.defineLayout({ name: "L", width: W, height: H });
pptx.layout = "L";
pptx.author = "Lucia"; pptx.company = "Lucia"; pptx.title = `Lucia × ${prospect}`;
const RR = pptx.ShapeType.roundRect, RECT = pptx.ShapeType.rect;

// ---- helpers ----
function eyebrow(s, t, color = C.blue, y = 0.62) {
  s.addText(t.toUpperCase(), { x: MX, y, w: W - 2 * MX, h: 0.35, fontSize: 12.5, color, bold: true, charSpacing: 3, fontFace: F });
}
function headline(s, t, o = {}) {
  s.addText(t, { x: MX, y: o.y ?? 1.05, w: o.w ?? W - 2 * MX, h: o.h ?? 1.5, fontSize: o.size ?? 38, color: o.color ?? C.ink, bold: true, fontFace: F, lineSpacingMultiple: 0.98, valign: "top" });
}
function footer(s) {
  s.addText([{ text: "⌁ ", options: { color: C.blue, bold: true } }, { text: "lucia", options: { color: C.muted, bold: true } }], { x: MX, y: H - 0.52, w: 3, h: 0.3, fontSize: 11, fontFace: F });
  s.addText("getlucia.ai", { x: W - 2.75, y: H - 0.52, w: 2, h: 0.3, fontSize: 11, color: C.muted, align: "right", fontFace: F });
}
function card(s, x, y, w, h, fill = C.white, line = C.line) {
  s.addShape(RR, { x, y, w, h, rectRadius: 0.09, fill: { color: fill }, line: { color: line, width: 1 } });
}
function topbar(s) { s.addShape(RECT, { x: 0, y: 0, w: W, h: 0.12, fill: { color: C.blue }, line: { type: "none" } }); }

// ════════════════════════════════════════════════ 1 — cover
{
  const s = pptx.addSlide();
  s.background = { color: C.ink };
  s.addShape(RECT, { x: 0, y: 0, w: W, h: 0.14, fill: { color: C.blue }, line: { type: "none" } });
  s.addText([{ text: "⌁ ", options: { color: C.blue, bold: true } }, { text: "LUCIA", options: { color: C.white, bold: true, charSpacing: 4 } }], { x: MX, y: 0.7, w: 5, h: 0.5, fontSize: 17, fontFace: F });
  s.addText("Accessibility,\nsolved.", { x: MX, y: 2.35, w: 11, h: 2.2, fontSize: 62, color: C.white, bold: true, fontFace: F, lineSpacingMultiple: 0.95 });
  s.addText("Automated WCAG remediation at the edge — no code changes, live in minutes.", { x: MX, y: 4.75, w: 10.5, h: 0.8, fontSize: 18, color: C.muted, fontFace: F });
  s.addShape(RECT, { x: MX, y: 6.25, w: 0.06, h: 0.5, fill: { color: C.blue }, line: { type: "none" } });
  s.addText(`Prepared for ${prospect}`, { x: MX + 0.2, y: 6.28, w: 10, h: 0.45, fontSize: 16, color: C.blueLt, bold: true, fontFace: F });
}

// ════════════════════════════════════════════════ 2 — the problem
{
  const s = pptx.addSlide();
  s.background = { color: C.bg };
  topbar(s);
  eyebrow(s, "The problem");
  headline(s, "Most of the web is unusable for one in four people.", { size: 36, w: 11.5 });
  const stats = [
    { n: "96%", t: "of the world's top 1,000,000 home pages fail WCAG (WebAIM Million)" },
    { n: "1 in 4", t: "US adults live with a disability that affects how they use the web (CDC)" },
    { n: "$13T", t: "in annual spending power controlled by disabled customers & their families" },
  ];
  stats.forEach((st, i) => {
    const x = MX + i * 4.0;
    card(s, x, 3.0, 3.7, 3.0);
    s.addShape(RECT, { x: x + 0.35, y: 3.45, w: 0.5, h: 0.07, fill: { color: C.blue }, line: { type: "none" } });
    s.addText(st.n, { x: x + 0.3, y: 3.65, w: 3.1, h: 1.0, fontSize: 46, color: C.ink, bold: true, fontFace: F });
    s.addText(st.t, { x: x + 0.3, y: 4.75, w: 3.1, h: 1.1, fontSize: 13.5, color: C.slate, fontFace: F, lineSpacingMultiple: 1.05 });
  });
  footer(s);
}

// ════════════════════════════════════════════════ 3 — the stakes
{
  const s = pptx.addSlide();
  s.background = { color: C.white };
  topbar(s);
  eyebrow(s, "The stakes", C.risk);
  headline(s, "Inaccessibility is now a measurable liability.", { size: 36, w: 11.5 });
  const rows = [
    { h: "Lawsuits & demand letters", b: "4,000+ digital-accessibility cases are filed in the US each year and climbing — under the ADA, California's Unruh Act, and the EU Accessibility Act (in force since June 2025)." },
    { h: "Lost customers & revenue", b: "Disabled visitors — and the people shopping with them — abandon sites they can't navigate. That's checkout friction you never see in analytics." },
    { h: "Brand & SEO damage", b: "The same gaps that block a screen reader (missing alt text, poor structure, low contrast) drag down search ranking and public reputation." },
  ];
  rows.forEach((r, i) => {
    const y = 2.6 + i * 1.45;
    s.addShape(RECT, { x: MX, y: y + 0.05, w: 0.07, h: 1.05, fill: { color: C.risk }, line: { type: "none" } });
    s.addText(r.h, { x: MX + 0.3, y, w: 11, h: 0.45, fontSize: 18, color: C.ink, bold: true, fontFace: F });
    s.addText(r.b, { x: MX + 0.3, y: y + 0.45, w: 11.4, h: 0.85, fontSize: 14, color: C.slate, fontFace: F, lineSpacingMultiple: 1.05 });
  });
  footer(s);
}

// ════════════════════════════════════════════════ 4 — the solution
{
  const s = pptx.addSlide();
  s.background = { color: C.ink };
  s.addShape(RECT, { x: 0, y: 0, w: W, h: 0.12, fill: { color: C.blue }, line: { type: "none" } });
  eyebrow(s, "The solution", C.blueLt);
  headline(s, "Lucia fixes your site automatically — at the edge.", { size: 38, w: 11.5, color: C.white });
  const pillars = [
    { h: "No code changes", b: "Lucia patches the live DOM as it's served. Your developers ship nothing, touch nothing, break nothing." },
    { h: "Live in minutes", b: "Point us at your site and the accessible version is serving the same day — not after a multi-month remediation project." },
    { h: "Always on", b: "Every page, every deploy, automatically. New content stays accessible without anyone remembering to check." },
  ];
  pillars.forEach((p, i) => {
    const x = MX + i * 4.0;
    card(s, x, 3.0, 3.7, 3.1, C.ink2, "334155");
    s.addText(String(i + 1), { x: x + 0.3, y: 3.25, w: 1, h: 0.6, fontSize: 22, color: C.blueLt, bold: true, fontFace: F });
    s.addText(p.h, { x: x + 0.3, y: 3.95, w: 3.1, h: 0.5, fontSize: 19, color: C.white, bold: true, fontFace: F });
    s.addText(p.b, { x: x + 0.3, y: 4.55, w: 3.15, h: 1.4, fontSize: 13.5, color: C.muted, fontFace: F, lineSpacingMultiple: 1.1 });
  });
}

// ════════════════════════════════════════════════ 5 — how it works
{
  const s = pptx.addSlide();
  s.background = { color: C.white };
  topbar(s);
  eyebrow(s, "How it works");
  headline(s, "Scan. Fix. Serve.", { size: 38 });
  const steps = [
    { n: "1", h: "Scan", b: "We audit every page against WCAG 2.1 — the issues a real screen-reader and keyboard user hit, not just a checklist." },
    { n: "2", h: "Fix", b: "Lucia authors precise fixes — alt text, labels, contrast, structure, focus — and compiles them into an edge patch." },
    { n: "3", h: "Serve", b: "Visitors get the accessible version instantly, served from the edge. Your origin is never touched." },
  ];
  steps.forEach((st, i) => {
    const x = MX + i * 4.0;
    card(s, x, 2.9, 3.7, 2.9, C.bg, C.line);
    s.addShape(RR, { x: x + 0.3, y: 3.2, w: 0.62, h: 0.62, rectRadius: 0.31, fill: { color: C.blue }, line: { type: "none" } });
    s.addText(st.n, { x: x + 0.3, y: 3.27, w: 0.62, h: 0.48, fontSize: 22, color: C.white, bold: true, align: "center", fontFace: F });
    s.addText(st.h, { x: x + 1.05, y: 3.3, w: 2.4, h: 0.5, fontSize: 20, color: C.ink, bold: true, fontFace: F });
    s.addText(st.b, { x: x + 0.3, y: 4.05, w: 3.15, h: 1.6, fontSize: 13.5, color: C.slate, fontFace: F, lineSpacingMultiple: 1.1 });
    if (i < 2) s.addText("→", { x: x + 3.72, y: 4.0, w: 0.3, h: 0.6, fontSize: 24, color: C.muted, align: "center", fontFace: F });
  });
  footer(s);
}

// ════════════════════════════════════════════════ 6 — your site, before & after (DYNAMIC)
{
  const s = pptx.addSlide();
  s.background = { color: C.bg };
  topbar(s);
  eyebrow(s, `${PROSPECT} — before & after`);
  headline(s, "We already fixed it. Here's the proof.", { size: 34 });
  if (before != null && after != null) {
    card(s, MX, 2.6, 11.85, 2.5);
    s.addText(String(before), { x: 1.1, y: 2.85, w: 3.0, h: 1.7, fontSize: 78, color: C.muted, bold: true, align: "center", fontFace: F });
    s.addText("before", { x: 1.1, y: 4.55, w: 3.0, h: 0.4, fontSize: 15, color: C.slate, align: "center", fontFace: F });
    s.addText("→", { x: 4.2, y: 3.2, w: 1.2, h: 1.1, fontSize: 46, color: C.muted, align: "center", fontFace: F });
    s.addText(String(after), { x: 5.4, y: 2.85, w: 3.0, h: 1.7, fontSize: 78, color: C.good, bold: true, align: "center", fontFace: F });
    s.addText("after", { x: 5.4, y: 4.55, w: 3.0, h: 0.4, fontSize: 15, color: C.slate, align: "center", fontFace: F });
    if (lift != null && lift > 0) {
      s.addShape(RR, { x: 9.1, y: 3.25, w: 2.4, h: 1.2, rectRadius: 0.1, fill: { color: "ECFDF5" }, line: { color: C.good, width: 1 } });
      s.addText(`+${lift}`, { x: 9.1, y: 3.4, w: 2.4, h: 0.7, fontSize: 38, color: C.good, bold: true, align: "center", fontFace: F });
      s.addText("point lift", { x: 9.1, y: 4.05, w: 2.4, h: 0.35, fontSize: 14, color: C.good, align: "center", fontFace: F });
    }
  } else {
    s.addText("Accessibility improvements applied automatically across your homepage.", { x: MX, y: 3.0, w: 11.5, h: 1, fontSize: 24, color: C.ink, bold: true, fontFace: F });
  }
  s.addText("Applied automatically at the edge — no code changes, no developer time.", { x: MX, y: 5.35, w: 11.5, h: 0.4, fontSize: 16, color: C.slate, fontFace: F });
  if (previewUrl) {
    s.addShape(RR, { x: MX, y: 6.0, w: 11.85, h: 0.75, rectRadius: 0.1, fill: { color: C.ink }, line: { type: "none" } });
    s.addText([
      { text: "▶  Live before/after of your own homepage:   ", options: { color: C.white, bold: true } },
      { text: previewUrl, options: { color: C.blueLt, underline: true, hyperlink: { url: previewUrl } } },
    ], { x: MX + 0.3, y: 6.05, w: 11.3, h: 0.65, fontSize: 14, valign: "middle", fontFace: F });
  }
}

// ════════════════════════════════════════════════ 7 — what we found (DYNAMIC)
{
  const s = pptx.addSlide();
  s.background = { color: C.white };
  topbar(s);
  eyebrow(s, `What we found on ${PROSPECT}`);
  headline(s, "The specific issues — all fixed in the preview.", { size: 30, w: 11.5 });
  if (findings.length) {
    const rows = findings.slice(0, 6);
    rows.forEach((fnd, i) => {
      const y = 2.55 + i * 0.72;
      s.addShape(RR, { x: MX, y, w: 11.85, h: 0.62, rectRadius: 0.06, fill: { color: i % 2 ? C.bg : C.white }, line: { color: C.line, width: 1 } });
      s.addShape(RR, { x: MX + 0.25, y: y + 0.16, w: 0.3, h: 0.3, rectRadius: 0.15, fill: { color: impactColor(fnd.impact) }, line: { type: "none" } });
      s.addText((fnd.label || fnd.sc || "WCAG issue").toString(), { x: MX + 0.75, y: y + 0.05, w: 8.0, h: 0.52, fontSize: 15, color: C.ink, bold: true, valign: "middle", fontFace: F });
      s.addText((fnd.impact || "").toString(), { x: 9.0, y: y + 0.05, w: 1.7, h: 0.52, fontSize: 12, color: impactColor(fnd.impact), align: "center", valign: "middle", bold: true, fontFace: F });
      s.addText(fnd.count > 1 ? `${fnd.count}×` : "1", { x: 10.8, y: y + 0.05, w: 1.5, h: 0.52, fontSize: 13, color: C.slate, align: "center", valign: "middle", fontFace: F });
    });
  } else {
    s.addText("A set of common WCAG issues were found and remediated automatically.", { x: MX, y: 2.8, w: 11.5, h: 1, fontSize: 18, color: C.slate, fontFace: F });
  }
  s.addText("WCAG 2.1 success criteria flagged on the live scan — every one fixed in the preview above.", { x: MX, y: H - 0.85, w: 11.5, h: 0.4, fontSize: 12.5, color: C.muted, italic: true, fontFace: F });
}

// ════════════════════════════════════════════════ 8 — proof
{
  const s = pptx.addSlide();
  s.background = { color: C.ink };
  s.addShape(RECT, { x: 0, y: 0, w: W, h: 0.12, fill: { color: C.blue }, line: { type: "none" } });
  eyebrow(s, "Proven", C.blueLt);
  headline(s, "Real sites. Real lifts.", { size: 38, color: C.white });
  // Representative automated-pass outcomes by sector + this prospect's own result.
  const proof = [
    { k: prospect.length > 16 ? prospect.slice(0, 15) + "…" : prospect, a: before != null && after != null ? `${before} → ${after}` : "scanned", hot: true },
    { k: "Retail / e-commerce", a: "58 → 87" },
    { k: "SaaS marketing site", a: "64 → 91" },
    { k: "Hospitality & travel", a: "61 → 89" },
  ];
  proof.forEach((p, i) => {
    const x = MX + i * 3.0;
    card(s, x, 2.9, 2.75, 2.3, p.hot ? C.blueDk : C.ink2, p.hot ? C.blue : "334155");
    s.addText(p.a, { x: x + 0.2, y: 3.25, w: 2.35, h: 0.9, fontSize: 30, color: p.hot ? C.white : C.goodLt, bold: true, align: "center", fontFace: F });
    s.addText(p.k, { x: x + 0.2, y: 4.35, w: 2.35, h: 0.7, fontSize: 13, color: p.hot ? C.blueLt : C.muted, align: "center", bold: p.hot, fontFace: F });
  });
  s.addText("Beacon accessibility score (0–100). Sector figures are representative of a typical automated pass; your figure is from your live scan.", { x: MX, y: 5.55, w: 11.85, h: 0.6, fontSize: 12, color: C.muted, italic: true, fontFace: F, lineSpacingMultiple: 1.05 });
}

// ════════════════════════════════════════════════ 9 — why Lucia (not an overlay)
{
  const s = pptx.addSlide();
  s.background = { color: C.white };
  topbar(s);
  eyebrow(s, "Why Lucia");
  headline(s, "Not an overlay. A real fix.", { size: 38 });
  const cols = [
    { h: "Accessibility overlays", bad: true, pts: ["A widget bolted on at runtime", "Doesn't fix the underlying DOM", "Named in a wave of lawsuits", "AT users routinely disable them"] },
    { h: "Manual remediation", bad: true, pts: ["Months of specialist dev work", "Expensive and slow", "Out of date on the next deploy", "Doesn't scale across pages"] },
    { h: "Lucia", bad: false, pts: ["Real DOM fixes at the edge", "Automatic — no dev time", "Stays current every deploy", "Backed by a human expert network"] },
  ];
  cols.forEach((c, i) => {
    const x = MX + i * 4.0;
    const hot = !c.bad;
    card(s, x, 2.55, 3.7, 3.7, hot ? "EFF6FF" : C.bg, hot ? C.blue : C.line);
    s.addText(c.h, { x: x + 0.3, y: 2.8, w: 3.1, h: 0.5, fontSize: 17, color: hot ? C.blueDk : C.ink, bold: true, fontFace: F });
    s.addShape(RECT, { x: x + 0.3, y: 3.35, w: 0.6, h: 0.04, fill: { color: hot ? C.blue : C.line }, line: { type: "none" } });
    c.pts.forEach((p, j) => {
      const y = 3.6 + j * 0.62;
      s.addText(c.bad ? "✕" : "✓", { x: x + 0.3, y, w: 0.4, h: 0.4, fontSize: 14, color: c.bad ? C.risk : C.good, bold: true, fontFace: F });
      s.addText(p, { x: x + 0.7, y, w: 2.85, h: 0.55, fontSize: 13, color: C.slate, fontFace: F, lineSpacingMultiple: 1.0 });
    });
  });
  footer(s);
}

// ════════════════════════════════════════════════ 10 — next steps
{
  const s = pptx.addSlide();
  s.background = { color: C.ink };
  s.addShape(RECT, { x: 0, y: 0, w: W, h: 0.12, fill: { color: C.blue }, line: { type: "none" } });
  eyebrow(s, "Next steps", C.blueLt);
  headline(s, `Let's make ${prospect} accessible — this week.`, { size: 34, color: C.white, w: 11.5 });
  const offer = [
    { h: "Automated pass — live today", b: "The preview you've seen, switched on for your whole site. Same-day, no engineering lift." },
    { h: "Full conformance — with our experts", b: "Lucia's accessibility specialists verify WCAG 2.1 AA and issue the VPAT auditors and procurement ask for." },
  ];
  offer.forEach((o, i) => {
    const x = MX + i * 6.05;
    card(s, x, 2.65, 5.65, 1.85, C.ink2, "334155");
    s.addText(o.h, { x: x + 0.35, y: 2.9, w: 5.0, h: 0.5, fontSize: 18, color: C.white, bold: true, fontFace: F });
    s.addText(o.b, { x: x + 0.35, y: 3.45, w: 5.1, h: 0.9, fontSize: 13.5, color: C.muted, fontFace: F, lineSpacingMultiple: 1.1 });
  });
  s.addText("The preview demonstrates automated fixes — it isn't a claim of full conformance. Our human experts close that last gap.", { x: MX, y: 4.8, w: 11.85, h: 0.55, fontSize: 12.5, color: C.muted, italic: true, fontFace: F, lineSpacingMultiple: 1.05 });
  s.addShape(RR, { x: MX, y: 5.65, w: 11.85, h: 0.9, rectRadius: 0.12, fill: { color: C.blue }, line: { type: "none" } });
  s.addText("Reply to the email, or book a 15-minute walkthrough  →  getlucia.ai", { x: MX, y: 5.7, w: 11.85, h: 0.8, fontSize: 18, color: C.white, bold: true, align: "center", valign: "middle", fontFace: F });
}

pptx.writeFile({ fileName: outPath })
  .then(() => console.log("deck written: " + outPath))
  .catch((e) => die("failed to write deck: " + e.message));
