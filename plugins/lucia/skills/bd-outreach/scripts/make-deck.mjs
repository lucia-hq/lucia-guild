#!/usr/bin/env node
/**
 * Build a pitch deck (.pptx) from a BD prospect's REAL scan evidence — so the
 * agent never hand-rolls a pptxgenjs script (and never fights its ESM/CJS
 * import) again.
 *
 *   node bd.mjs deck-data <targetId> > evidence.json
 *   node make-deck.mjs evidence.json [out.pptx]
 *   # or pipe it straight in:
 *   node bd.mjs deck-data <targetId> | node make-deck.mjs - acme-lucia.pptx
 *
 * Input is the JSON from `bd deck-data` (bd.evidenceForDeck):
 *   { prospect, previewUrl, scoreBefore, scoreAfter, findings[], evidencePackSiteId }
 *
 * One-time setup: `npm install` in this scripts/ directory (pptxgenjs is pinned
 * in package.json), same as the probe skill's Playwright install.
 *
 * pptxgenjs ships CommonJS; we load it via createRequire, which is the reliable
 * way from an .mjs (the bare `import` is the thing that trips people up).
 *
 * Honest by construction: real before/after + real findings, a live-preview
 * link, and an explicit "needs a human audit for full conformance" close — never
 * claims the site is now compliant.
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
const before = Number.isFinite(d.scoreBefore) ? d.scoreBefore : null;
const after = Number.isFinite(d.scoreAfter) ? d.scoreAfter : null;
const lift = before != null && after != null ? after - before : null;
const findings = Array.isArray(d.findings) ? d.findings : [];
const previewUrl = (d.previewUrl || "").toString();
const outPath = args[1] || `${prospect.replace(/[^a-z0-9.-]/gi, "_")}-lucia.pptx`;

// ---- brand ----
const BLUE = "2563EB", INK = "0F172A", SLATE = "475569", MUTED = "94A3B8", BG = "F8FAFC", WHITE = "FFFFFF", GOOD = "059669";
const FONT = "Helvetica";

function impactColor(impact) {
  const i = (impact || "").toString().toLowerCase();
  if (i === "critical") return "DC2626";
  if (i === "serious") return "EA580C";
  if (i === "moderate") return "CA8A04";
  return "64748B";
}

const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE"; // 13.333 x 7.5
pptx.author = "Lucia";
pptx.company = "Lucia";

// 1 — cover
{
  const s = pptx.addSlide();
  s.background = { color: INK };
  s.addText("⌁", { x: 0.6, y: 0.5, w: 0.8, h: 0.8, fontSize: 34, color: BLUE, bold: true, fontFace: FONT });
  s.addText("LUCIA", { x: 1.3, y: 0.62, w: 4, h: 0.5, fontSize: 16, color: WHITE, bold: true, charSpacing: 3, fontFace: FONT });
  s.addText(`A more accessible\n${prospect}`, { x: 0.6, y: 2.3, w: 12, h: 2, fontSize: 44, color: WHITE, bold: true, fontFace: FONT });
  s.addText("Automated WCAG remediation — with a live before/after of your own site.", { x: 0.6, y: 4.7, w: 11.5, h: 0.8, fontSize: 18, color: MUTED, fontFace: FONT });
}

// 2 — the score lift
{
  const s = pptx.addSlide();
  s.background = { color: BG };
  s.addText("THE RESULT", { x: 0.7, y: 0.55, w: 6, h: 0.4, fontSize: 13, color: BLUE, bold: true, charSpacing: 2, fontFace: FONT });
  if (before != null && after != null) {
    s.addText(String(before), { x: 0.7, y: 1.7, w: 3.3, h: 1.8, fontSize: 90, color: MUTED, bold: true, align: "center", fontFace: FONT });
    s.addText("before", { x: 0.7, y: 3.6, w: 3.3, h: 0.4, fontSize: 16, color: SLATE, align: "center", fontFace: FONT });
    s.addText("→", { x: 4.1, y: 2.0, w: 1.3, h: 1.4, fontSize: 50, color: MUTED, align: "center", fontFace: FONT });
    s.addText(String(after), { x: 5.5, y: 1.7, w: 3.3, h: 1.8, fontSize: 90, color: GOOD, bold: true, align: "center", fontFace: FONT });
    s.addText("after", { x: 5.5, y: 3.6, w: 3.3, h: 0.4, fontSize: 16, color: SLATE, align: "center", fontFace: FONT });
    if (lift != null && lift > 0) {
      s.addText(`+${lift}`, { x: 9.3, y: 2.1, w: 3.2, h: 1, fontSize: 40, color: GOOD, bold: true, align: "center", fontFace: FONT });
      s.addText("point lift", { x: 9.3, y: 3.0, w: 3.2, h: 0.4, fontSize: 16, color: SLATE, align: "center", fontFace: FONT });
    }
  } else {
    s.addText("Accessibility improvements applied automatically.", { x: 0.7, y: 2.6, w: 11.5, h: 1, fontSize: 30, color: INK, bold: true, fontFace: FONT });
  }
  s.addText("Applied automatically at the edge — no code changes, no developer time.", { x: 0.7, y: 5.4, w: 12, h: 0.6, fontSize: 18, color: SLATE, fontFace: FONT });
}

// 3 — what we improved (findings)
{
  const s = pptx.addSlide();
  s.background = { color: WHITE };
  s.addText("What we improved", { x: 0.7, y: 0.55, w: 11, h: 0.7, fontSize: 26, color: INK, bold: true, fontFace: FONT });
  if (findings.length) {
    const header = [
      { text: "WCAG issue", options: { bold: true, color: SLATE, fontSize: 11, fill: { color: "F1F5F9" } } },
      { text: "Impact", options: { bold: true, color: SLATE, fontSize: 11, align: "center", fill: { color: "F1F5F9" } } },
      { text: "Count", options: { bold: true, color: SLATE, fontSize: 11, align: "center", fill: { color: "F1F5F9" } } },
    ];
    const rows = findings.slice(0, 7).map((f) => [
      { text: (f.label || f.sc || "WCAG issue").toString(), options: { color: INK, fontSize: 14, bold: true } },
      { text: (f.impact || "—").toString(), options: { color: impactColor(f.impact), fontSize: 12, align: "center" } },
      { text: f.count > 1 ? `${f.count}×` : "1", options: { color: SLATE, fontSize: 12, align: "center" } },
    ]);
    s.addTable([header, ...rows], {
      x: 0.7, y: 1.5, w: 11.9, colW: [8.9, 1.8, 1.2], rowH: 0.5,
      border: { type: "solid", color: "E2E8F0", pt: 1 }, valign: "middle", fontFace: FONT,
    });
  } else {
    s.addText("A set of common WCAG issues were addressed.", { x: 0.7, y: 2, w: 11.5, h: 1, fontSize: 18, color: SLATE, fontFace: FONT });
  }
  s.addText("WCAG 2.1 success criteria flagged on the scan and fixed automatically.", { x: 0.7, y: 6.5, w: 12, h: 0.4, fontSize: 13, color: MUTED, italic: true, fontFace: FONT });
}

// 4 — see it live (only if we have a preview)
if (previewUrl) {
  const s = pptx.addSlide();
  s.background = { color: INK };
  s.addText("SEE IT LIVE", { x: 0.7, y: 0.6, w: 10, h: 0.4, fontSize: 13, color: BLUE, bold: true, charSpacing: 2, fontFace: FONT });
  s.addText("A live before/after of your own homepage", { x: 0.7, y: 1.4, w: 12, h: 1, fontSize: 30, color: WHITE, bold: true, fontFace: FONT });
  s.addText([{ text: previewUrl, options: { hyperlink: { url: previewUrl }, color: "60A5FA", underline: true } }], { x: 0.7, y: 3.1, w: 12, h: 0.6, fontSize: 18, fontFace: FONT });
  s.addText("Toggle the patched version on and off — every fix is applied at the edge, nothing changes on your servers.", { x: 0.7, y: 4.2, w: 11.5, h: 1, fontSize: 16, color: MUTED, fontFace: FONT });
}

// 5 — what's next (honest CTA)
{
  const s = pptx.addSlide();
  s.background = { color: BG };
  s.addText("What's next", { x: 0.7, y: 0.6, w: 11, h: 0.7, fontSize: 26, color: INK, bold: true, fontFace: FONT });
  s.addText([
    { text: "This preview is a demonstration of automated fixes — it doesn't mean the site is fully conformant.", options: { color: SLATE, fontSize: 16, breakLine: true } },
    { text: "Full WCAG 2.1 AA conformance needs a human audit, which Lucia's expert network provides.", options: { color: SLATE, fontSize: 16, breakLine: true } },
    { text: "", options: { fontSize: 10, breakLine: true } },
    { text: "Reply to the email and we'll walk you (or your team) through the findings and what full remediation looks like.", options: { color: INK, fontSize: 16, bold: true } },
  ], { x: 0.7, y: 1.7, w: 11.6, h: 3, fontFace: FONT, lineSpacingMultiple: 1.25 });
  s.addText("⌁  Lucia accessibility", { x: 0.7, y: 6.5, w: 6, h: 0.4, fontSize: 14, color: BLUE, bold: true, fontFace: FONT });
}

pptx.writeFile({ fileName: outPath })
  .then(() => console.log("deck written: " + outPath))
  .catch((e) => die("failed to write deck: " + e.message));
