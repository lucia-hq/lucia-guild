#!/usr/bin/env node
/**
 * Probe eval scorer — does the agent match (and beat) a human audit?
 *
 *   node eval.mjs --found plan.json --truth eval-bad-plan.json
 *
 * Diffs Probe's produced plan (--found) against a human ground-truth findings
 * file (--truth) and prints:
 *   recall    — of the human's findings, how many Probe independently re-found
 *   novel     — verified findings Probe reported that the human did NOT (the "beat")
 *   matched   — found↔truth pairs
 *
 * INTEGRITY: produce --found WITHOUT reading --truth (a blind run). Reading the
 * ground truth while auditing invalidates the benchmark. Run 3× for stability.
 *
 * Note: precision (false-positive rate) is enforced upstream by verify.mjs —
 * every Probe finding is harness-confirmed — so "novel" here is candidate
 * true-positives the human missed, not noise. Spot-check them anyway.
 */
import { readFileSync } from "node:fs";

function arg(name) { const i = process.argv.indexOf("--" + name); return i >= 0 ? process.argv[i + 1] : null; }
const foundPath = arg("found"), truthPath = arg("truth");
if (!foundPath || !truthPath) {
  console.error("usage: eval.mjs --found <plan.json> --truth <truth.json>\n(produce <plan.json> with a BLIND Probe run — don't read the truth while auditing.)");
  process.exit(1);
}
const load = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch (e) { console.error(`can't read ${p}: ${e.message}`); process.exit(1); } };
const findings = (o) => Array.isArray(o?.findings) ? o.findings : Array.isArray(o) ? o : [];

const found = findings(load(foundPath));
const truth = findings(load(truthPath));
if (!truth.length) { console.error("truth file has no findings[]"); process.exit(1); }

const STOP = new Set("the a an of to in on for and or is are with without no not be by your you it this that as at from".split(" "));
const norm = (s) => String(s || "").toLowerCase().replace(/^wcag\s*/, "").replace(/[^a-z0-9. ]/g, " ").trim();
const sc = (f) => norm(f.wcagSc).split(" ")[0];
const tokens = (s) => new Set(norm(s).split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
const jaccard = (a, b) => { const A = tokens(a), B = tokens(b); if (!A.size || !B.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i); };
const selEq = (a, b) => { const x = norm(a?.selector), y = norm(b?.selector); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };

function matches(tf, ff) {
  if (sc(tf) && sc(ff) && sc(tf) === sc(ff)) {
    // Subject is the clean signal; a verbose `explanation` must never DILUTE a
    // strong subject match below threshold — so take the max of subject-only and
    // subject+explanation jaccard. The same-SC gate keeps this from over-matching.
    const subjJac = jaccard(tf.subject, ff.subject);
    const combJac = jaccard(`${tf.subject} ${tf.explanation || ""}`, `${ff.subject} ${ff.explanation || ""}`);
    if (selEq(tf, ff) || Math.max(subjJac, combJac) >= 0.18) return true;
  }
  return false;
}

const usedFound = new Set();
const pairs = [];
for (const tf of truth) {
  let best = -1, bestScore = 0;
  found.forEach((ff, i) => { if (usedFound.has(i)) return; if (matches(tf, ff)) { const s = jaccard(tf.subject, ff.subject) + (selEq(tf, ff) ? 1 : 0); if (s >= bestScore) { bestScore = s; best = i; } } });
  if (best >= 0) { usedFound.add(best); pairs.push({ truth: tf, found: found[best] }); }
}
const missed = truth.filter((tf) => !pairs.some((p) => p.truth === tf));
const novel = found.filter((_, i) => !usedFound.has(i));

const pct = (n, d) => d ? `${Math.round((100 * n) / d)}%` : "—";
const cyan = (s) => `\x1b[36m${s}\x1b[0m`, bold = (s) => `\x1b[1m${s}\x1b[0m`, dim = (s) => `\x1b[2m${s}\x1b[0m`;

console.log(`\n${bold("Probe vs human audit")}  ${dim(`(${foundPath}  vs  ${truthPath})`)}`);
console.log(`  Human findings: ${truth.length}   Probe findings: ${found.length}`);
console.log(`  ${bold("Recall")}: ${cyan(`${pairs.length}/${truth.length}`)} ${pct(pairs.length, truth.length)}  ${bold("Beat (novel)")}: ${cyan(novel.length)}\n`);

console.log(bold("✓ Re-found (recall)"));
for (const p of pairs) console.log(`  [${sc(p.truth)}] ${p.truth.subject}\n      ${dim("↳ probe:")} ${p.found.subject}`);
if (missed.length) { console.log(`\n${bold("✗ Missed")}`); for (const m of missed) console.log(`  [${sc(m)}] ${m.subject}`); }
if (novel.length) { console.log(`\n${bold("★ Novel (human missed — verify by hand)")}`); for (const n of novel) console.log(`  [${sc(n)}] ${n.subject}`); }
console.log("");
