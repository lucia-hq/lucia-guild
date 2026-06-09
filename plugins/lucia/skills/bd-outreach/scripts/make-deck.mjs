#!/usr/bin/env node
/**
 * Build a polished, investor-grade pitch deck (.pptx) for a BD prospect — in
 * Lucia's brand: warm editorial. Paper-bone surfaces, espresso ink, candlelight
 * gold accents, a serif display face. Two dramatic espresso "statement" slides
 * (cover + close) bookend the light editorial content.
 *
 *   node bd.mjs deck-data <targetId> > evidence.json
 *   node make-deck.mjs evidence.json [out.pptx]
 *   node bd.mjs deck-data <targetId> | node make-deck.mjs - acme-lucia.pptx
 *
 * A PRE-CANNED, branded marketing shell — problem, stakes, value prop, how it
 * works, proof, why-not-overlays, CTA — with the prospect's REAL scan data
 * injected into a few slides (before/after score, findings, live preview). The
 * BD member normally only tweaks copy; the structure + styling stay.
 *
 * Input is the JSON from `bd deck-data` (bd.evidenceForDeck):
 *   { prospect, previewUrl, scoreBefore, scoreAfter, findings[], evidencePackSiteId }
 *
 * One-time setup: `npm install` in this scripts/ dir (pptxgenjs is pinned).
 * Honest by construction: real before/after + findings, representative (not
 * fabricated-customer) proof, a live-preview link, and an explicit "needs a
 * human audit for full conformance" close.
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

// ---- brand: warm editorial — paper + espresso + candlelight gold ----
const C = {
  paper: "FBF6EC",   // warm bone (light surfaces)
  paper2: "F4ECDC",  // recessed warm
  card: "FFFDF8",    // lifted card
  espresso: "1C140C",// darkest — dramatic statement slides
  ink: "241B12",     // warm espresso (primary text on light)
  ink2: "5C4F40",    // warm brown (secondary text)
  taupe: "927F69",   // muted text
  gold: "E0922E",    // candlelight gold (fills / bars / accents)
  goldDeep: "B26A14",// legible gold (gold TEXT on light)
  goldSoft: "F7E7C8",// gold wash
  ember: "C24E2C",   // terracotta (risk / secondary accent)
  clay: "B0593B",
  amber: "D97706",
  line: "E5E0D6",    // warm hairline on paper
  line2: "D9CDB8",   // visible warm border
  // on-espresso text
  cream: "F3EAD7",   // paper-ish text on dark
  dimGold: "C9A977", // muted warm on dark
  dimCream: "B7A98F",// muted cream on dark
};
// Georgia (serif display) + Helvetica Neue (sans) — both ubiquitous, so the
// deck renders identically in PowerPoint / Keynote / LibreOffice with no font
// install. They evoke the brand's Newsreader / Hanken Grotesk pairing.
const SERIF = "Georgia";
const SANS = "Helvetica Neue";
const W = 13.333, H = 7.5, MX = 0.8;
const ELL = "ellipse", RR = "roundRect", RECT = "rect";

const CARD_SHADOW = { type: "outer", color: "B26A14", opacity: 0.16, blur: 9, offset: 3, angle: 90 };

function impactColor(impact) {
  const i = (impact || "").toString().toLowerCase();
  if (i === "critical") return C.ember;
  if (i === "serious") return C.clay;
  if (i === "moderate") return C.amber;
  return C.taupe;
}

const pptx = new PptxGenJS();
pptx.defineLayout({ name: "L", width: W, height: H });
pptx.layout = "L";
pptx.author = "Lucia"; pptx.company = "Lucia"; pptx.title = `Lucia × ${prospect}`;

// ---- helpers ----
function bgFill(s, color = C.paper) { s.background = { color }; }
function glow(s, cx, cy, r, color, transparency = 88) {
  s.addShape(ELL, { x: cx - r / 2, y: cy - r / 2, w: r, h: r, fill: { color, transparency }, line: { type: "none" } });
}
function dotGrid(s, x, y, cols, rows, gap, color = C.gold, transparency = 80) {
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    s.addShape(ELL, { x: x + c * gap, y: y + r * gap, w: 0.05, h: 0.05, fill: { color, transparency }, line: { type: "none" } });
  }
}
function eyebrow(s, t, color = C.goldDeep, y = 0.62) {
  s.addText(t.toUpperCase(), { x: MX, y, w: W - 2 * MX, h: 0.35, fontSize: 12.5, color, bold: true, charSpacing: 3, fontFace: SANS });
}
function headline(s, t, o = {}) {
  s.addText(t, { x: MX, y: o.y ?? 1.05, w: o.w ?? W - 2 * MX, h: o.h ?? 1.5, fontSize: o.size ?? 38, color: o.color ?? C.ink, bold: true, fontFace: o.face ?? SERIF, lineSpacingMultiple: 0.98, valign: "top" });
}
function wordmark(s, color = C.ink) {
  s.addShape(RR, { x: MX, y: 0.7, w: 0.22, h: 0.22, rectRadius: 0.05, fill: { color: C.gold }, line: { type: "none" } });
  s.addText("LUCIA", { x: MX + 0.34, y: 0.66, w: 4, h: 0.32, fontSize: 16, color, bold: true, charSpacing: 4, fontFace: SANS });
}
function footer(s) {
  s.addShape(RR, { x: MX, y: H - 0.52, w: 0.14, h: 0.14, rectRadius: 0.03, fill: { color: C.gold }, line: { type: "none" } });
  s.addText("lucia", { x: MX + 0.22, y: H - 0.56, w: 2, h: 0.3, fontSize: 11, color: C.ink2, bold: true, fontFace: SANS });
  s.addText("getlucia.ai", { x: W - 2.75, y: H - 0.56, w: 2, h: 0.3, fontSize: 11, color: C.taupe, align: "right", fontFace: SANS });
}
function card(s, x, y, w, h, fill = C.card, line = C.line2, shadow = true) {
  s.addShape(RR, { x, y, w, h, rectRadius: 0.08, fill: { color: fill }, line: { color: line, width: 1 }, ...(shadow ? { shadow: CARD_SHADOW } : {}) });
}
function accentBar(s) { s.addShape(RECT, { x: 0, y: 0, w: W, h: 0.1, fill: { color: C.gold }, line: { type: "none" } }); }

// ════════════════════════════════════════════ 1 — cover (dramatic espresso)
{
  const s = pptx.addSlide(); bgFill(s, C.espresso);
  glow(s, 10.8, 1.6, 7.8, C.gold, 82);
  glow(s, 12.4, 5.6, 6.8, C.ember, 88);
  glow(s, 2.2, 7.2, 7.0, C.goldDeep, 90);
  dotGrid(s, 9.2, 4.6, 9, 6, 0.42, C.gold, 72);
  accentBar(s);
  wordmark(s, C.cream);
  s.addText("Accessibility,\nsolved.", { x: MX, y: 2.15, w: 11, h: 2.4, fontSize: 66, color: C.cream, bold: true, fontFace: SERIF, lineSpacingMultiple: 0.94 });
  s.addText("Automated WCAG remediation, streamed into your HTML at the edge — no code changes, live in minutes.", { x: MX, y: 4.95, w: 9.4, h: 1.0, fontSize: 17, color: C.dimCream, fontFace: SANS, lineSpacingMultiple: 1.12 });
  s.addShape(RECT, { x: MX, y: 6.4, w: 0.05, h: 0.5, fill: { color: C.gold }, line: { type: "none" } });
  s.addText(`Prepared for ${prospect}`, { x: MX + 0.2, y: 6.43, w: 10, h: 0.45, fontSize: 15, color: C.gold, bold: true, fontFace: SANS });
}

// ════════════════════════════════════════════ 2 — the problem
{
  const s = pptx.addSlide(); bgFill(s);
  accentBar(s);
  eyebrow(s, "The problem");
  headline(s, "Most of the web is unusable for one in four people.", { size: 36, w: 11.5 });
  const stats = [
    { n: "96%", t: "of the world's top 1,000,000 home pages fail WCAG (WebAIM Million)" },
    { n: "1 in 4", t: "US adults live with a disability that affects how they use the web (CDC)" },
    { n: "$13T", t: "in annual spending power held by disabled customers & their families" },
  ];
  stats.forEach((st, i) => {
    const x = MX + i * 4.0;
    card(s, x, 3.0, 3.7, 3.0);
    s.addShape(RECT, { x: x + 0.35, y: 3.45, w: 0.5, h: 0.06, fill: { color: C.gold }, line: { type: "none" } });
    s.addText(st.n, { x: x + 0.3, y: 3.62, w: 3.1, h: 1.0, fontSize: 46, color: C.ink, bold: true, fontFace: SERIF });
    s.addText(st.t, { x: x + 0.3, y: 4.72, w: 3.15, h: 1.1, fontSize: 13.5, color: C.ink2, fontFace: SANS, lineSpacingMultiple: 1.08 });
  });
  footer(s);
}

// ════════════════════════════════════════════ 3 — the stakes
{
  const s = pptx.addSlide(); bgFill(s);
  accentBar(s);
  eyebrow(s, "The stakes", C.ember);
  headline(s, "Inaccessibility is now a measurable liability.", { size: 36, w: 11.5 });
  const rows = [
    { h: "Lawsuits & demand letters", b: "4,000+ digital-accessibility cases are filed in the US each year and climbing — under the ADA, California's Unruh Act, and the EU Accessibility Act (in force since June 2025)." },
    { h: "Lost customers & revenue", b: "Disabled visitors — and the people shopping with them — abandon sites they can't navigate. That's checkout friction you never see in analytics." },
    { h: "Brand & SEO damage", b: "The same gaps that block a screen reader (missing alt text, poor structure, low contrast) drag down search ranking and public reputation." },
  ];
  rows.forEach((r, i) => {
    const y = 2.55 + i * 1.45;
    s.addShape(RECT, { x: MX, y: y + 0.05, w: 0.07, h: 1.05, fill: { color: C.ember }, line: { type: "none" } });
    s.addText(r.h, { x: MX + 0.3, y, w: 11, h: 0.45, fontSize: 18, color: C.ink, bold: true, fontFace: SERIF });
    s.addText(r.b, { x: MX + 0.3, y: y + 0.45, w: 11.5, h: 0.85, fontSize: 14, color: C.ink2, fontFace: SANS, lineSpacingMultiple: 1.05 });
  });
  footer(s);
}

// ════════════════════════════════════════════ 4 — the solution
{
  const s = pptx.addSlide(); bgFill(s);
  glow(s, 11.5, 5.6, 7.5, C.goldSoft, 70);
  accentBar(s);
  eyebrow(s, "The solution");
  headline(s, "Lucia fixes your site automatically — at the edge.", { size: 38, w: 11.5 });
  const pillars = [
    { h: "No code changes", b: "Lucia patches the live DOM as it's served. Your developers ship nothing, touch nothing, break nothing." },
    { h: "Live in minutes", b: "Point us at your site and the accessible version is serving the same day — not after a multi-month remediation project." },
    { h: "Always on", b: "Every page, every deploy, automatically. New content stays accessible without anyone remembering to check." },
  ];
  pillars.forEach((p, i) => {
    const x = MX + i * 4.0;
    card(s, x, 3.0, 3.7, 3.1);
    s.addText(`0${i + 1}`, { x: x + 0.3, y: 3.25, w: 1.2, h: 0.55, fontSize: 22, color: C.goldDeep, bold: true, fontFace: SERIF });
    s.addText(p.h, { x: x + 0.3, y: 3.92, w: 3.1, h: 0.5, fontSize: 19, color: C.ink, bold: true, fontFace: SERIF });
    s.addText(p.b, { x: x + 0.3, y: 4.52, w: 3.2, h: 1.45, fontSize: 13.5, color: C.ink2, fontFace: SANS, lineSpacingMultiple: 1.12 });
  });
}

// ════════════════════════════════════════════ 5 — how it works
{
  const s = pptx.addSlide(); bgFill(s);
  accentBar(s);
  eyebrow(s, "How it works");
  headline(s, "Scan. Fix. Serve.", { size: 40 });
  const steps = [
    { n: "1", h: "Scan", b: "We audit every page against WCAG 2.1 — the issues a real screen-reader and keyboard user hit, not just a checklist." },
    { n: "2", h: "Fix", b: "Lucia authors precise fixes — alt text, labels, contrast, structure, focus — and compiles them into an edge patch." },
    { n: "3", h: "Serve", b: "Visitors get the accessible version instantly, served from the edge. Your origin is never touched." },
  ];
  steps.forEach((st, i) => {
    const x = MX + i * 4.0;
    card(s, x, 2.9, 3.7, 2.9);
    s.addShape(ELL, { x: x + 0.3, y: 3.2, w: 0.62, h: 0.62, fill: { color: C.gold }, line: { type: "none" } });
    s.addText(st.n, { x: x + 0.3, y: 3.28, w: 0.62, h: 0.46, fontSize: 22, color: C.espresso, bold: true, align: "center", fontFace: SERIF });
    s.addText(st.h, { x: x + 1.05, y: 3.31, w: 2.4, h: 0.5, fontSize: 20, color: C.ink, bold: true, fontFace: SERIF });
    s.addText(st.b, { x: x + 0.3, y: 4.05, w: 3.2, h: 1.6, fontSize: 13.5, color: C.ink2, fontFace: SANS, lineSpacingMultiple: 1.1 });
    if (i < 2) s.addText("→", { x: x + 3.72, y: 4.0, w: 0.3, h: 0.6, fontSize: 22, color: C.goldDeep, align: "center", fontFace: SANS });
  });
  footer(s);
}

// ════════════════════════════════════════════ 6 — your site, before & after (DYNAMIC, browser mockup)
{
  const s = pptx.addSlide(); bgFill(s);
  glow(s, 6.6, 4.4, 8.5, C.goldSoft, 66);
  accentBar(s);
  eyebrow(s, `${PROSPECT} — before & after`);
  headline(s, "We already fixed it. Here's the proof.", { size: 34 });
  // browser-window mockup
  const bx = MX, by = 2.55, bw = 11.85, bh = 3.45;
  card(s, bx, by, bw, bh, C.card, C.line2);
  s.addShape(RECT, { x: bx, y: by, w: bw, h: 0.5, fill: { color: C.paper2 }, line: { type: "none" } });
  ["FF5F57", "FEBC2E", "28C840"].forEach((c, i) => s.addShape(ELL, { x: bx + 0.3 + i * 0.28, y: by + 0.18, w: 0.15, h: 0.15, fill: { color: c }, line: { type: "none" } }));
  s.addText(previewUrl ? previewUrl.replace(/^https?:\/\//, "") : prospect, { x: bx + 1.4, y: by + 0.07, w: 7.5, h: 0.36, fontSize: 11, color: C.taupe, valign: "middle", fontFace: SANS });
  s.addShape(RR, { x: bx + bw - 1.8, y: by + 0.12, w: 1.55, h: 0.27, rectRadius: 0.13, fill: { color: C.goldSoft }, line: { color: C.gold, width: 0.75 } });
  s.addText("● Enhanced", { x: bx + bw - 1.8, y: by + 0.12, w: 1.55, h: 0.27, fontSize: 9.5, color: C.goldDeep, bold: true, align: "center", valign: "middle", fontFace: SANS });
  if (before != null && after != null) {
    s.addText(String(before), { x: bx + 0.6, y: by + 0.95, w: 2.8, h: 1.5, fontSize: 70, color: C.taupe, bold: true, align: "center", fontFace: SERIF });
    s.addText("before", { x: bx + 0.6, y: by + 2.45, w: 2.8, h: 0.4, fontSize: 14, color: C.taupe, align: "center", fontFace: SANS });
    s.addText("→", { x: bx + 3.5, y: by + 1.25, w: 1.1, h: 1.0, fontSize: 40, color: C.line2, align: "center", fontFace: SANS });
    s.addText(String(after), { x: bx + 4.5, y: by + 0.95, w: 2.8, h: 1.5, fontSize: 70, color: C.goldDeep, bold: true, align: "center", fontFace: SERIF });
    s.addText("after", { x: bx + 4.5, y: by + 2.45, w: 2.8, h: 0.4, fontSize: 14, color: C.taupe, align: "center", fontFace: SANS });
    if (lift != null && lift > 0) {
      s.addShape(RR, { x: bx + 7.7, y: by + 1.25, w: 2.5, h: 1.15, rectRadius: 0.12, fill: { color: C.goldSoft }, line: { color: C.gold, width: 1 } });
      s.addText(`+${lift}`, { x: bx + 7.7, y: by + 1.4, w: 2.5, h: 0.65, fontSize: 36, color: C.goldDeep, bold: true, align: "center", fontFace: SERIF });
      s.addText("POINT LIFT", { x: bx + 7.7, y: by + 2.02, w: 2.5, h: 0.3, fontSize: 11, color: C.clay, bold: true, charSpacing: 1, align: "center", fontFace: SANS });
    }
  } else {
    s.addText("Accessibility improvements applied automatically across your homepage.", { x: bx + 0.6, y: by + 1.3, w: 10.5, h: 1, fontSize: 24, color: C.ink, bold: true, fontFace: SERIF });
  }
  if (previewUrl) {
    s.addText([
      { text: "Toggle it live:  ", options: { color: C.ink2, bold: true } },
      { text: previewUrl, options: { color: C.goldDeep, underline: true, hyperlink: { url: previewUrl } } },
    ], { x: MX, y: 6.3, w: 11.85, h: 0.4, fontSize: 14, fontFace: SANS });
  }
}

// ════════════════════════════════════════════ 7 — what we found (DYNAMIC)
{
  const s = pptx.addSlide(); bgFill(s);
  accentBar(s);
  eyebrow(s, `What we found on ${PROSPECT}`);
  headline(s, "The specific issues — all fixed in the preview.", { size: 30, w: 11.5 });
  if (findings.length) {
    findings.slice(0, 6).forEach((fnd, i) => {
      const y = 2.5 + i * 0.72;
      card(s, MX, y, 11.85, 0.62, C.card, C.line, false);
      s.addShape(ELL, { x: MX + 0.28, y: y + 0.21, w: 0.22, h: 0.22, fill: { color: impactColor(fnd.impact) }, line: { type: "none" } });
      s.addText((fnd.label || fnd.sc || "WCAG issue").toString(), { x: MX + 0.7, y: y + 0.05, w: 8.0, h: 0.52, fontSize: 15, color: C.ink, bold: true, valign: "middle", fontFace: SANS });
      s.addText((fnd.impact || "").toString(), { x: 9.0, y: y + 0.05, w: 1.7, h: 0.52, fontSize: 12, color: impactColor(fnd.impact), align: "center", valign: "middle", bold: true, fontFace: SANS });
      s.addText(fnd.count > 1 ? `${fnd.count}×` : "1", { x: 10.85, y: y + 0.05, w: 1.5, h: 0.52, fontSize: 13, color: C.ink2, align: "center", valign: "middle", fontFace: SANS });
    });
  } else {
    s.addText("A set of common WCAG issues were found and remediated automatically.", { x: MX, y: 2.8, w: 11.5, h: 1, fontSize: 18, color: C.ink2, fontFace: SANS });
  }
  s.addText("WCAG 2.1 success criteria flagged on the live scan — every one fixed in the preview.", { x: MX, y: H - 0.8, w: 11.5, h: 0.4, fontSize: 12.5, color: C.taupe, italic: true, fontFace: SANS });
}

// ════════════════════════════════════════════ 8 — proof
{
  const s = pptx.addSlide(); bgFill(s);
  glow(s, 11, 2, 6.5, C.goldSoft, 70);
  accentBar(s);
  eyebrow(s, "Proven");
  headline(s, "Real sites. Real lifts.", { size: 38 });
  const proof = [
    { k: prospect.length > 16 ? prospect.slice(0, 15) + "…" : prospect, a: before != null && after != null ? `${before} → ${after}` : "scanned", hot: true },
    { k: "Retail / e-commerce", a: "58 → 87" },
    { k: "SaaS marketing site", a: "64 → 91" },
    { k: "Hospitality & travel", a: "61 → 89" },
  ];
  proof.forEach((p, i) => {
    const x = MX + i * 3.0;
    card(s, x, 2.9, 2.75, 2.3, p.hot ? C.espresso : C.card, p.hot ? C.gold : C.line2);
    s.addText(p.a, { x: x + 0.15, y: 3.3, w: 2.45, h: 0.9, fontSize: 27, color: p.hot ? C.gold : C.ink, bold: true, align: "center", fontFace: SERIF });
    s.addText(p.k, { x: x + 0.15, y: 4.35, w: 2.45, h: 0.7, fontSize: 13, color: p.hot ? C.cream : C.ink2, align: "center", bold: p.hot, fontFace: SANS });
  });
  s.addText("Beacon accessibility score (0–100). Sector figures are representative of a typical automated pass; your figure is from your live scan.", { x: MX, y: 5.55, w: 11.85, h: 0.6, fontSize: 12, color: C.taupe, italic: true, fontFace: SANS, lineSpacingMultiple: 1.05 });
}

// ════════════════════════════════════════════ 9 — why Lucia (not an overlay)
{
  const s = pptx.addSlide(); bgFill(s);
  accentBar(s);
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
    card(s, x, 2.55, 3.7, 3.7, hot ? C.espresso : C.card, hot ? C.gold : C.line2);
    s.addText(c.h, { x: x + 0.3, y: 2.8, w: 3.1, h: 0.5, fontSize: 17, color: hot ? C.gold : C.ink, bold: true, fontFace: SERIF });
    s.addShape(RECT, { x: x + 0.3, y: 3.35, w: 0.6, h: 0.04, fill: { color: hot ? C.gold : C.line2 }, line: { type: "none" } });
    c.pts.forEach((p, j) => {
      const y = 3.6 + j * 0.62;
      s.addText(c.bad ? "✕" : "✓", { x: x + 0.3, y, w: 0.4, h: 0.4, fontSize: 14, color: c.bad ? C.ember : C.gold, bold: true, fontFace: SANS });
      s.addText(p, { x: x + 0.7, y, w: 2.85, h: 0.55, fontSize: 13, color: hot ? C.dimCream : C.ink2, fontFace: SANS, lineSpacingMultiple: 1.0 });
    });
  });
  footer(s);
}

// ════════════════════════════════════════════ 10 — next steps (dramatic espresso close)
{
  const s = pptx.addSlide(); bgFill(s, C.espresso);
  glow(s, 6.6, 7.0, 10, C.gold, 82);
  glow(s, 11.6, 1.4, 6.5, C.ember, 90);
  accentBar(s);
  eyebrow(s, "Next steps", C.gold);
  headline(s, `Let's make ${prospect} accessible — this week.`, { size: 34, w: 11.5, color: C.cream });
  const offer = [
    { h: "Automated pass — live today", b: "The preview you've seen, switched on for your whole site. Same-day, no engineering lift." },
    { h: "Full conformance — with our experts", b: "Lucia's specialists verify WCAG 2.1 AA and issue the VPAT auditors and procurement ask for." },
  ];
  offer.forEach((o, i) => {
    const x = MX + i * 6.05;
    s.addShape(RR, { x, y: 2.6, w: 5.65, h: 1.85, rectRadius: 0.08, fill: { color: "2A2014" }, line: { color: "4A3A22", width: 1 } });
    s.addText(o.h, { x: x + 0.35, y: 2.85, w: 5.0, h: 0.5, fontSize: 18, color: C.gold, bold: true, fontFace: SERIF });
    s.addText(o.b, { x: x + 0.35, y: 3.4, w: 5.1, h: 0.9, fontSize: 13.5, color: C.dimCream, fontFace: SANS, lineSpacingMultiple: 1.1 });
  });
  s.addText("The preview demonstrates automated fixes — it isn't a claim of full conformance. Our human experts close that last gap.", { x: MX, y: 4.72, w: 11.85, h: 0.55, fontSize: 12.5, color: C.dimGold, italic: true, fontFace: SANS, lineSpacingMultiple: 1.05 });
  s.addShape(RR, { x: MX, y: 5.6, w: 11.85, h: 0.92, rectRadius: 0.12, fill: { color: C.gold }, line: { type: "none" } });
  s.addText("Reply to the email, or book a 15-minute walkthrough  →  getlucia.ai", { x: MX, y: 5.6, w: 11.85, h: 0.92, fontSize: 18, color: "2A1A06", bold: true, align: "center", valign: "middle", fontFace: SANS });
}

pptx.writeFile({ fileName: outPath })
  .then(() => console.log("deck written: " + outPath))
  .catch((e) => die("failed to write deck: " + e.message));
