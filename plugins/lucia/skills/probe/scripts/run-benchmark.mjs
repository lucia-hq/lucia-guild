#!/usr/bin/env node
/**
 * run-benchmark.mjs <truthFile> — run every Probe-scope check declared in a site
 * benchmark and report interaction coverage. No separate plan file needed: each
 * benchmark finding carries its own `check`, `probe` (in Probe's scope) and
 * `repro` (reproduces as a hard machine-verifiable failure on the current page).
 *
 * Coverage = CAUGHT / (probe:true AND repro:!==false AND has a check). Static
 * (probe:false → Sentinel) and non-reproducing (repro:false) are listed but not
 * counted against Probe. This is the reusable regression runner for the
 * benchmark suite (../../expert-review/reference/example-*.json).
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const truthPath = process.argv[2];
if (!truthPath) { console.error("usage: run-benchmark.mjs <truthFile.json>"); process.exit(1); }
const truth = JSON.parse(readFileSync(truthPath, "utf8"));
const findings = Array.isArray(truth.findings) ? truth.findings : truth;
const baseUrl = truth.url;

let caught = 0, total = 0, statics = 0, excluded = 0;
const rows = [];
for (const f of findings) {
  if (!f.probe) { statics++; rows.push(["static  ", f.wcagSc, f.subject || "(Sentinel)"]); continue; }
  if (f.repro === false) { excluded++; rows.push(["excluded", f.wcagSc, (f.note || "not reproducing").slice(0, 60)]); continue; }
  if (!f.check) { rows.push(["no-check", f.wcagSc, "probe-scope but no check defined"]); continue; }
  total++;
  const url = f.pageUrl || baseUrl;
  let res;
  try { const out = execFileSync("node", [join(SCRIPT_DIR, "verify.mjs"), url, JSON.stringify(f.check), "--no-bundle"], { encoding: "utf8", timeout: 90000 }); res = JSON.parse(out.trim().split("\n").filter(Boolean).pop()); }
  catch (e) { res = { error: (e.message || "").slice(0, 50) }; }
  const ok = res && res.ok === true;
  if (ok) caught++;
  rows.push([ok ? "CAUGHT ✓" : (res?.inconclusive ? "incon   " : (res?.error ? "ERROR   " : "miss ✗  ")), f.wcagSc, (f.subject || "").slice(0, 52)]);
}
const cyan = (s) => `\x1b[36m${s}\x1b[0m`, bold = (s) => `\x1b[1m${s}\x1b[0m`;
console.log(`\n${bold(truth.site || truthPath)}`);
console.log(`  ${bold("Interaction coverage")}: ${cyan(`${caught}/${total}`)} ${total ? Math.round((100 * caught) / total) : 0}%   (+${statics} static→Sentinel, ${excluded} excluded/non-repro)\n`);
for (const [st, sc, txt] of rows) console.log(`  ${st}  [${sc}] ${txt}`);
console.log("");
process.exit(caught === total ? 0 : 1);
