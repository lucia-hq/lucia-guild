#!/usr/bin/env node
/**
 * Probe audit-trail integrity checker — the chain-of-custody verifier.
 *
 *   node audit.mjs verify-chain [runsDir]   re-prove the whole ledger is intact
 *   node audit.mjs list        [runsDir]    one line per verification run
 *   node audit.mjs show <runId> [runsDir]   print a single run record
 *
 * Each `verify.mjs` run appends a line to runs/ledger.jsonl and writes
 * runs/<runId>/run.json (+ evidence.png). Every line is hash-chained:
 *   entryHash = sha256(prevHash + runSha256),  runSha256 = sha256(run.json sans integrity)
 * so altering ANY stored result, screenshot, or ledger line breaks the chain
 * from that point on. `verify-chain` recomputes all of it from the files on
 * disk and reports the first break (or confirms intact) — the answer to
 * "prove this evidence wasn't edited after the fact."
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const sha256 = (x) => createHash("sha256").update(x).digest("hex");
const GENESIS = "0".repeat(64);

const [cmd, a1, a2] = process.argv.slice(2);
const runsDir = (cmd === "show" ? a2 : a1) || process.env.PROBE_RUNS_DIR || join(SCRIPT_DIR, "runs");
const ledgerPath = join(runsDir, "ledger.jsonl");

function readLedger() {
  if (!existsSync(ledgerPath)) { console.error(`no ledger at ${ledgerPath}`); process.exit(2); }
  return readFileSync(ledgerPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
const recordSha = (rec) => { const { integrity, ...rest } = rec; return sha256(JSON.stringify(rest)); };

function verifyChain() {
  const entries = readLedger();
  let prev = GENESIS, broken = null;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const where = `entry ${i} (${e.runId})`;
    if (e.prevHash !== prev) { broken = { i, runId: e.runId, why: `prevHash mismatch — ledger line altered/reordered at ${where}` }; break; }
    if (sha256(e.prevHash + e.runSha256) !== e.entryHash) { broken = { i, runId: e.runId, why: `entryHash mismatch at ${where}` }; break; }
    const runPath = join(runsDir, e.runId, "run.json");
    if (!existsSync(runPath)) { broken = { i, runId: e.runId, why: `run.json missing for ${where}` }; break; }
    const rec = JSON.parse(readFileSync(runPath, "utf8"));
    const rsha = recordSha(rec);
    if (rsha !== e.runSha256 || rec.integrity?.runSha256 !== e.runSha256) { broken = { i, runId: e.runId, why: `run.json content was modified (recomputed ${rsha.slice(0, 12)}… ≠ ledger ${e.runSha256.slice(0, 12)}…)` }; break; }
    if (rec.screenshot) {
      const shotPath = join(runsDir, e.runId, rec.screenshot);
      if (!existsSync(shotPath)) { broken = { i, runId: e.runId, why: `screenshot ${rec.screenshot} missing` }; break; }
      if (sha256(readFileSync(shotPath)) !== rec.screenshotSha256) { broken = { i, runId: e.runId, why: `screenshot bytes were modified` }; break; }
    }
    prev = e.entryHash;
  }
  const cyan = (s) => `\x1b[36m${s}\x1b[0m`, red = (s) => `\x1b[31m${s}\x1b[0m`, green = (s) => `\x1b[32m${s}\x1b[0m`, bold = (s) => `\x1b[1m${s}\x1b[0m`;
  console.log(`\n${bold("Probe audit-trail integrity")}  ${runsDir}`);
  console.log(`  runs: ${entries.length}   head: ${entries.length ? entries[entries.length - 1].entryHash.slice(0, 16) + "…" : "—"}`);
  if (broken) { console.log(`  ${red("✗ CHAIN BROKEN")} — ${broken.why}\n`); process.exit(1); }
  const ok = entries.filter((e) => e.ok).length;
  console.log(`  ${green("✓ intact")} — all ${entries.length} run records + screenshots hash-verified; chain continuous from genesis.`);
  console.log(`  ${cyan(`${ok} ok:true`)}, ${entries.length - ok} ok:false/inconclusive (rejected candidates are retained as evidence of rigor).\n`);
}

function list() {
  for (const e of readLedger()) console.log(`${e.ok ? "✓" : "·"} ${e.timestamp}  [${e.checkType}]  ${e.runId}`);
}
function show(runId) {
  const p = join(runsDir, runId, "run.json");
  if (!existsSync(p)) { console.error(`no run.json for ${runId} under ${runsDir}`); process.exit(2); }
  console.log(readFileSync(p, "utf8"));
}

if (cmd === "verify-chain") verifyChain();
else if (cmd === "list") list();
else if (cmd === "show") { if (!a1) { console.error("usage: audit.mjs show <runId> [runsDir]"); process.exit(2); } show(a1); }
else { console.error("usage: audit.mjs <verify-chain|list|show <runId>> [runsDir]"); process.exit(2); }
