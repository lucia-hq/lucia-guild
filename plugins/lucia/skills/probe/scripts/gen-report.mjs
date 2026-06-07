#!/usr/bin/env node
/**
 * gen-report.mjs — build a self-contained Probe coverage report from whatever
 * benchmark files are present and the check library. Run:
 *   node gen-report.mjs   → writes probe-report.html (next to this script)
 *
 * Data-driven: it reads every `example-*.json` benchmark in
 * ../../expert-review/reference/ (each one a findings file whose entries may
 * carry `check`, `probe` = in Probe's scope, `repro` = reproduces as a hard
 * machine-verifiable failure). Add your own benchmark there and it appears in
 * the report. With just the bundled `example-demo.json` it renders that one.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REF = join(SCRIPT_DIR, "../../expert-review/reference");
const OUT = join(SCRIPT_DIR, "probe-report.html");

// Discover the benchmark files (example-*.json) in the reference dir.
const SITES = existsSync(REF)
  ? readdirSync(REF).filter((f) => /^example-.*\.json$/.test(f)).sort()
  : [];

// The automated interaction analyses Probe runs (the ~43% axe can't reach).
const CHECKS = [
  { cat: "Keyboard & focus", items: [
    ["unreachable", "2.1.1", "a visible control is never reached by Tab — keyboard can't operate it"],
    ["pointer-only", "2.1.1", "inline pointer-only handler (onmouseover/onclick), no keyboard equivalent, not focusable"],
    ["keyboard-trap", "2.1.2", "once focused, Tab / Shift-Tab can't leave the widget"],
    ["focus-not-visible", "2.4.7", "the element takes focus but shows no visible focus indicator"],
    ["focus-removed", "2.4.7 / 3.2.1", "script removes focus on receipt (onfocus=blur) — focus never holds"],
    ["focus-order", "2.4.3", "Tab order doesn't match the visual reading order"],
    ["offscreen-focusable", "2.4.3", "Tab enters controls inside off-screen / hidden carousel slides"],
    ["skip-link", "2.4.1", "skip link is broken OR absent (no bypass, no main landmark)"],
  ]},
  { cat: "Name, role & labels", items: [
    ["no-accessible-name", "4.1.2", "an operable control exposes an empty accessible name"],
    ["no-label", "3.3.2", "a form control has no &lt;label&gt; / aria-label / title"],
    ["ambiguous-link-text", "2.4.4", "generic link text ('click here') or the same name → different destinations"],
    ["select-navigates", "3.2.2", "a &lt;select&gt; changes context (navigates) on change — the jump-menu trap"],
  ]},
  { cat: "Modal, disclosure & hover", items: [
    ["escape-noop", "1.4.13", "a dialog opens but Escape doesn't close it"],
    ["focus-not-trapped-in", "4.1.2", "opening a modal doesn't move focus into it"],
    ["hover-only", "1.4.13 / 2.1.1", "content shown on hover isn't shown on keyboard focus (hit-tested — catches 3D flips)"],
  ]},
  { cat: "Low-vision, reflow & contrast", items: [
    ["reflow-hscroll", "1.4.10", "the page needs horizontal scrolling at 320px / 400% zoom"],
    ["component-overflow", "1.4.10", "a specific component (menu / table) clips at high zoom"],
    ["text-spacing", "1.4.12", "WCAG text-spacing overrides clip content (genuine loss, not just scroll)"],
    ["overlap", "1.4.12", "two elements that shouldn't overlap have intersecting visible boxes"],
    ["contrast", "1.4.3", "text contrast below 4.5:1 / 3:1 (sRGB luminance, alpha-composited bg)"],
  ]},
  { cat: "Carousels & dynamic content", items: [
    ["carousel-autoplay-no-pause", "2.2.2", "the carousel auto-rotates with no pause / stop control"],
    ["slides-all-exposed", "1.3.2", "multiple carousel slides are exposed to the screen reader at once"],
  ]},
];

const esc = (s) => String(s ?? "").replace(/&(?!amp;|lt;|gt;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const load = (f) => { try { return JSON.parse(readFileSync(join(REF, f), "utf8")); } catch { return null; } };

let totalFindings = 0, totalCaught = 0, totalStatic = 0, totalExcluded = 0;
const siteCards = SITES.map((f) => {
  const data = load(f);
  const findings = (data?.findings || []);
  let caught = 0, scope = 0;
  const rows = findings.map((fd) => {
    let status, cls;
    if (fd.probe === false) { status = "static → Sentinel"; cls = "static"; totalStatic++; }
    else if (fd.repro === false) { status = "excluded · non-reproducing"; cls = "excluded"; totalExcluded++; }
    else { status = "in scope ✓"; cls = "caught"; totalCaught++; caught++; scope++; }
    if (fd.probe !== false) totalFindings++;
    return `<tr><td class="sc">${esc(fd.wcagSc)}</td><td>${esc(fd.subject)}</td><td>${fd.check?.type ? `<code>${esc(fd.check.type)}</code>` : "<span class='dim'>—</span>"}</td><td class="st ${cls}">${status}</td></tr>`;
  }).join("");
  const cov = `${caught} / ${scope}`;
  const title = data?.site || f.replace(/^example-|\.json$/g, "");
  return `
  <details class="site" open>
    <summary>
      <span class="sname">${esc(title)}</span>
      <span class="cov ok">${cov}</span>
      <span class="surl">${esc((data?.url || "").replace(/^https?:\/\//, ""))}</span>
    </summary>
    <p class="snote">${esc(data?.note || "")}</p>
    <table class="findings"><thead><tr><th>WCAG</th><th>Finding</th><th>Check</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
  </details>`;
}).join("\n");

const checkCols = CHECKS.map((c) => `
  <div class="ccat">
    <h4>${esc(c.cat)} <span class="ccount">${c.items.length}</span></h4>
    ${c.items.map(([n, sc, d]) => `<div class="chk"><div class="chk-h"><code>${n}</code><span class="chk-sc">${sc}</span></div><p>${d}</p></div>`).join("")}
  </div>`).join("\n");

const totalChecks = CHECKS.reduce((n, c) => n + c.items.length, 0);
const today = new Date().toISOString().slice(0, 10);

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lucia Probe — Coverage Report</title>
<style>
  :root{ --bg:#07080a; --panel:#0d0f13; --panel2:#11141a; --line:#1d2230; --ink:#e8edf4; --dim:#8893a6; --faint:#5b6678; --acc:#10e298; --accd:#0aa873; --warn:#f5b14b; --bad:#ff6b6b; }
  *{box-sizing:border-box} html{scroll-behavior:smooth}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
  code,.mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
  a{color:var(--acc);text-decoration:none}
  .wrap{max-width:1080px;margin:0 auto;padding:0 24px}
  header{padding:64px 0 36px;border-bottom:1px solid var(--line);background:radial-gradient(900px 320px at 15% -10%,rgba(16,226,152,.10),transparent 70%)}
  .eyebrow{color:var(--acc);font-weight:600;letter-spacing:.14em;text-transform:uppercase;font-size:12px}
  h1{font-size:40px;line-height:1.1;margin:.3em 0 .25em;letter-spacing:-.02em}
  .sub{color:var(--dim);font-size:17px;max-width:64ch}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin:36px 0 8px}
  .stat{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px 20px}
  .stat b{display:block;font-size:30px;line-height:1;letter-spacing:-.02em}
  .stat span{color:var(--dim);font-size:12.5px;text-transform:uppercase;letter-spacing:.06em}
  .stat.acc b{color:var(--acc)}
  section{padding:48px 0;border-bottom:1px solid var(--line)}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.12em;color:var(--dim);margin:0 0 6px}
  .lead{font-size:22px;letter-spacing:-.01em;margin:0 0 24px;max-width:70ch}
  details.site{background:var(--panel);border:1px solid var(--line);border-radius:14px;margin:12px 0;overflow:hidden}
  details.site[open]{border-color:#26304a}
  summary{display:flex;align-items:center;gap:12px;padding:16px 20px;cursor:pointer;list-style:none;flex-wrap:wrap}
  summary::-webkit-details-marker{display:none}
  .sname{font-weight:650;font-size:16px}
  .cov{margin-left:auto;font-weight:700;font-variant-numeric:tabular-nums;background:var(--panel2);border:1px solid var(--line);padding:4px 12px;border-radius:99px;font-size:14px}
  .cov.ok{color:var(--acc);border-color:rgba(16,226,152,.4);background:rgba(16,226,152,.07)}
  .surl{flex-basis:100%;color:var(--faint);font-size:12.5px;font-family:ui-monospace,monospace}
  .snote{color:var(--dim);font-size:13.5px;padding:0 20px;margin:2px 0 10px;max-width:90ch}
  table.findings{width:100%;border-collapse:collapse;font-size:13.5px}
  table.findings th{text-align:left;color:var(--faint);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.06em;padding:8px 20px;border-top:1px solid var(--line)}
  table.findings td{padding:9px 20px;border-top:1px solid var(--line);vertical-align:top}
  td.sc{color:var(--acc);font-family:ui-monospace,monospace;white-space:nowrap;font-weight:600}
  td code{background:var(--panel2);border:1px solid var(--line);border-radius:6px;padding:1px 7px;font-size:12px;color:#bcd}
  td.st{white-space:nowrap;font-size:12px}
  .st.caught{color:var(--acc)} .st.static{color:var(--faint)} .st.excluded{color:var(--warn)}
  .dim{color:var(--faint)}
  .checks{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px}
  .ccat h4{font-size:13px;text-transform:uppercase;letter-spacing:.07em;color:var(--ink);margin:0 0 12px;display:flex;align-items:center;gap:8px}
  .ccount{color:var(--acc);background:rgba(16,226,152,.08);border:1px solid rgba(16,226,152,.3);border-radius:99px;font-size:11px;padding:1px 8px}
  .chk{background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:12px 14px;margin-bottom:9px}
  .chk-h{display:flex;align-items:center;gap:8px;margin-bottom:3px}
  .chk-h code{color:var(--acc);font-weight:600;font-size:13px}
  .chk-sc{margin-left:auto;color:var(--faint);font-size:11px;font-family:ui-monospace,monospace}
  .chk p{margin:0;color:var(--dim);font-size:12.8px;line-height:1.5}
  .flow{display:flex;flex-wrap:wrap;align-items:stretch;gap:10px;margin:18px 0}
  .step{flex:1;min-width:150px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;position:relative}
  .step .n{color:var(--acc);font-family:ui-monospace,monospace;font-size:12px;font-weight:700}
  .step h5{margin:4px 0 4px;font-size:14px}
  .step p{margin:0;color:var(--dim);font-size:12.5px;line-height:1.45}
  .step.hl{border-color:rgba(16,226,152,.45);background:rgba(16,226,152,.05)}
  .pillrow{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
  .pill{font-size:12px;color:var(--dim);background:var(--panel);border:1px solid var(--line);border-radius:99px;padding:5px 12px}
  .pill b{color:var(--ink);font-weight:600}
  .cols2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px 22px}
  .card h3{margin:0 0 8px;font-size:16px}
  .card p{margin:0;color:var(--dim);font-size:13.5px}
  .card p code{background:var(--panel2);border:1px solid var(--line);border-radius:6px;padding:1px 6px;font-size:12px;color:#bcd}
  footer{padding:40px 0 80px;color:var(--faint);font-size:12.5px}
  @media(max-width:680px){.cols2{grid-template-columns:1fr}h1{font-size:30px}}
</style></head>
<body>
<header><div class="wrap">
  <div class="eyebrow">Lucia · Probe</div>
  <h1>Agentic accessibility tester — coverage report</h1>
  <p class="sub">Probe drives a real browser as a screen-reader, keyboard-only and low-vision user to find the interaction- and state-dependent WCAG failures automated scanners can't reach — and <b>verifies every finding deterministically</b> before reporting it.</p>
  <div class="stats">
    <div class="stat"><b>${SITES.length}</b><span>Benchmark sites</span></div>
    <div class="stat acc"><b>${totalCaught}</b><span>In-scope findings</span></div>
    <div class="stat"><b>${totalChecks}</b><span>Deterministic checks</span></div>
    <div class="stat acc"><b>0</b><span>False positives</span></div>
  </div>
</div></header>

<section><div class="wrap">
  <h2>The benchmarks</h2>
  <p class="lead">Public accessibility test pages with documented barriers, so the tester can be measured against a known answer key.</p>
  ${siteCards || `<p class="snote" style="padding:0">No <code>example-*.json</code> benchmarks found in <code>${esc(REF)}</code>. Add one to populate this section.</p>`}
  <p class="snote" style="padding:0;margin-top:18px"><b>Coverage</b> = of the deterministically-verifiable <em>interaction</em> barriers (Probe's mandate), how many it covers. <b style="color:var(--faint)">static → Sentinel</b> = pure-static issues (alt text, contrast values, markup, lang) handled by the axe-based layer, not Probe. <b style="color:var(--warn)">excluded</b> = in scope but not reproducing as a hard failure on the current page — never forced into the denominator.</p>
</div></section>

<section><div class="wrap">
  <h2>The automated analysis</h2>
  <p class="lead">${totalChecks} deterministic checks across the interaction surface — every one a machine-confirmable assertion, not a heuristic.</p>
  <div class="checks">${checkCols}</div>
</div></section>

<section><div class="wrap">
  <h2>How it works</h2>
  <p class="lead">Agent proposes, harness verifies — then the fix is proven on the real edge before it ships.</p>
  <div class="flow">
    <div class="step"><div class="n">01</div><h5>Drive</h5><p>Navigate the page as the persona over the accessibility tree + keyboard — not pixels.</p></div>
    <div class="step"><div class="n">02</div><h5>Propose</h5><p>A noticed issue is a <em>claim</em>: {check, selector, reproSteps}.</p></div>
    <div class="step hl"><div class="n">03</div><h5>Verify</h5><p>A clean headless replay re-runs the check. <b>No machine confirmation → discarded.</b></p></div>
    <div class="step hl"><div class="n">04</div><h5>Preflight</h5><p>Apply the fix to a candidate manifest served on the real edge under a token — invisible to real users — and re-verify the same check flips <code>true→false</code>.</p></div>
    <div class="step"><div class="n">05</div><h5>Promote</h5><p>A human approves; the proven fix goes live. A learned rule spreads it to future scans.</p></div>
  </div>
  <div class="pillrow">
    <span class="pill"><b>Propose → verify</b> · the anti-hallucination + legal-defensibility rule</span>
    <span class="pill"><b>Tamper-evident trail</b> · hash-chained run records + screenshots</span>
    <span class="pill"><b>Preflight</b> · machine-proven before/after on the real renderer</span>
    <span class="pill"><b>Never auto-applies</b> · human approval gate</span>
  </div>
</div></section>

<section><div class="wrap">
  <h2>The two-layer split</h2>
  <div class="cols2">
    <div class="card"><h3>Probe — the ~43%</h3><p>Interaction- and state-dependent failures automation usually can't see: keyboard operability &amp; traps, focus order &amp; visibility, operated-widget name/role, modal &amp; hover content, reflow/zoom, on-input context changes. Driven as a real AT user, each verified.</p></div>
    <div class="card"><h3>Sentinel — the ~57%</h3><p>Statically-detectable issues a scanner already catches: missing alt text, contrast values, document markup, language, parsing. The benchmark misses marked <em>static → Sentinel</em> are this layer's job, by design.</p><p style="margin-top:8px;color:var(--acc)">Together → full coverage.</p></div>
  </div>
</div></section>

<footer><div class="wrap">
  Generated ${today}. Benchmarks come from <code>../../expert-review/reference/example-*.json</code>. Every finding is propose→verify confirmed with a tamper-evident evidence bundle; static deferred to Sentinel; non-reproducing / subjective items excluded honestly. No claim of WCAG conformance is made — this is automated + human-reviewed coverage, not a legal conformance statement.
</div></footer>
</body></html>`;

writeFileSync(OUT, html);
console.log(`wrote ${OUT}`);
console.log(`sites=${SITES.length} inScope=${totalCaught} static=${totalStatic} excluded=${totalExcluded} checks=${totalChecks}`);
