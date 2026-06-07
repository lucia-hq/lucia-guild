#!/usr/bin/env node
/**
 * preflight.mjs — the apply → re-verify loop. "Live, but not fully live."
 *
 *   node preflight.mjs <plan.json> [--discard]
 *
 * For each finding that carries {pageUrl, check, stitches[]}:
 *   1. expert.compilePreflight(siteId, pageUrl, stitches) — writes a CANDIDATE
 *      Patch Roll to the :preflight key. The live pointer never moves; Veil serves
 *      the candidate on <slug>.luciaedge.com?__lucia_pf=1 — applied by the REAL
 *      edge renderer, invisible to real visitors.
 *   2. Re-verify the SAME deterministic check that found the issue:
 *        before = verify(pageUrl)        → expect ok:true  (issue present live)
 *        after  = verify(previewUrl)      → expect ok:false (issue FIXED on preflight)
 *      A fix is PROVEN only when before:true → after:false. Both runs write
 *      tamper-evident evidence bundles (the before/after chain-of-custody record).
 *
 * Default leaves the preflight up so the operator can eyeball previewUrl, then
 * PROMOTE via the approval-gated submitter:  submit.mjs <plan.json>  (submitFinding
 * + compilePage). `--discard` clears the candidate (expert.clearPreflight).
 *
 * Auth reuses expert-review's browser login (~/.lucia/token.json).
 */
import { login, readCachedToken } from "../../expert-review/scripts/login.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const API_URL = (process.env.LUCIA_API_URL || "https://api.getlucia.ai").replace(/\/+$/, "");
const die = (m) => { console.error(m); process.exit(1); };
const args = process.argv.slice(2);
const planPath = args.find((a) => !a.startsWith("--"));
const DISCARD = args.includes("--discard");
if (!planPath) die("usage: preflight.mjs <plan.json> [--discard]");

let token = process.env.LUCIA_ADMIN_JWT || null;
async function ensureToken(force) { if (!force && token) return token; const c = !force && readCachedToken?.(); token = c || (await login()); return token; }
async function trpc(method, path, input, _retried = false) {
  await ensureToken();
  const headers = { authorization: `Bearer ${token}` };
  let url = `${API_URL}/trpc/${path}?batch=1`;
  const init = { method, headers };
  if (method === "GET") url += `&input=${encodeURIComponent(JSON.stringify({ 0: input }))}`;
  else { headers["content-type"] = "application/json"; init.body = JSON.stringify({ 0: input }); }
  const res = await fetch(url, init);
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { return die(`${path}: non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`); }
  const entry = Array.isArray(body) ? body[0] : body;
  if (entry?.error) {
    const isAuth = res.status === 401 || /UNAUTHORIZED/.test(JSON.stringify(entry.error));
    if (isAuth && !_retried && !process.env.LUCIA_ADMIN_JWT) { await ensureToken(true); return trpc(method, path, input, true); }
    return die(`${path}: ${entry.error?.json?.message ?? entry.error?.message ?? JSON.stringify(entry.error)}`);
  }
  return entry?.result?.data?.json ?? entry?.result?.data;
}
const mutate = (p, i) => trpc("POST", p, i);

function verify(pageUrl, check) {
  try {
    const out = execFileSync("node", [join(SCRIPT_DIR, "verify.mjs"), pageUrl, JSON.stringify(check)], { encoding: "utf8", timeout: 90000 });
    return JSON.parse(out.trim().split("\n").filter(Boolean).pop());
  } catch (e) { return { error: (e.message || "").slice(0, 80) }; }
}

const plan = JSON.parse(readFileSync(planPath, "utf8"));
const siteId = plan.siteId || plan.site;
if (!siteId) die("plan needs a siteId");
const findings = (plan.findings || []).filter((f) => Array.isArray(f.stitches) && f.stitches.length && f.check && f.pageUrl);
if (!findings.length) die("no findings with {pageUrl, check, stitches[]} to preflight");

console.log(`\nPreflight — ${findings.length} candidate fix(es) on ${siteId}\n`);
const results = [];
for (const f of findings) {
  console.log(`[${f.wcagSc || "?"}] ${(f.subject || "").slice(0, 56)}`);
  const before = verify(f.pageUrl, f.check);
  let pf;
  try { pf = await mutate("expert.compilePreflight", { siteId, pageUrl: f.pageUrl, stitches: f.stitches }); }
  catch (e) { console.log(`   compilePreflight failed: ${e?.message || e}\n`); results.push({ f, fixed: false }); continue; }
  const after = verify(pf.previewUrl, f.check);
  const fixed = before?.ok === true && after?.ok === false;
  const verdict = fixed ? "FIXED ✓ (present live → resolved on preflight)" : after?.inconclusive ? "inconclusive ? (re-verify could not settle)" : before?.ok !== true ? "skipped ? (not reproduced on live now)" : "NOT fixed ✗ (stitch did not resolve it)";
  console.log(`   before(live)=${before?.ok}  after(preflight)=${after?.ok}  →  ${verdict}`);
  console.log(`   preview: ${pf.previewUrl}${pf.droppedUnsafe?.length ? `   [dropped unsafe: ${pf.droppedUnsafe.length}]` : ""}\n`);
  results.push({ f, fixed });
}

const green = results.filter((r) => r.fixed).length;
console.log(`${green}/${results.length} candidate fixes PROVEN by re-verify.`);
if (DISCARD) {
  for (const r of results) await mutate("expert.clearPreflight", { siteId, pageUrl: r.f.pageUrl });
  console.log("Preflight candidates discarded; live untouched.");
} else {
  console.log(`Preflight left live for review. Promote the proven fixes with:  node ../../expert-review/scripts/submit.mjs ${planPath}   (then re-run with --discard to clean up).`);
}
