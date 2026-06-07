#!/usr/bin/env node
/**
 * expert-review submitter.
 *
 * Reads a "plan JSON" (see ../reference/plan-schema.md) and posts each
 * finding to the Lucia admin API (expert.submitFinding), then triggers
 * one compile per page (expert.compilePage) so the new stitches go live.
 *
 * Modes:
 *   node submit.mjs <plan.json>              submit for real
 *   node submit.mjs --dry-run <plan.json>    print what would be sent, no calls
 *   node submit.mjs --get-site --site <id>   read-only: list the site's pages
 *
 * Env:
 *   LUCIA_ADMIN_JWT   (required)  admin Clerk session token (see SKILL.md -> Auth)
 *   LUCIA_API_URL     (optional)  default https://api.getlucia.ai
 *
 * No dependencies — Node 18+ global fetch only.
 */

import { readFileSync } from "node:fs";
import { login, readCachedToken } from "./login.mjs";

const API_URL = (process.env.LUCIA_API_URL || "https://api.getlucia.ai").replace(/\/+$/, "");

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

// Token resolution: explicit env override -> fresh cache -> browser login.
let token = null;
async function ensureToken(force = false) {
  if (!force) {
    if (process.env.LUCIA_ADMIN_JWT) { token = process.env.LUCIA_ADMIN_JWT; return token; }
    if (token) return token;
    const cached = readCachedToken();
    if (cached) { token = cached; return token; }
  }
  token = await login();
  return token;
}

/** One batched tRPC call (the format the real client uses). method GET for
 *  queries, POST for mutations. No transformer on the server, so inputs are
 *  passed as-is under batch key "0". Re-authenticates once on a 401 (unless
 *  an explicit LUCIA_ADMIN_JWT override is in force). */
async function trpc(method, path, input, _retried = false) {
  if (!token) await ensureToken();
  const headers = { authorization: `Bearer ${token}` };
  let url = `${API_URL}/trpc/${path}?batch=1`;
  const init = { method, headers };
  if (method === "GET") {
    url += `&input=${encodeURIComponent(JSON.stringify({ 0: input }))}`;
  } else {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify({ 0: input });
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { die(`${path}: non-JSON response (HTTP ${res.status}): ${text.slice(0, 300)}`); }
  const entry = Array.isArray(body) ? body[0] : body;
  if (entry?.error) {
    const isAuth = res.status === 401 || /UNAUTHORIZED/.test(JSON.stringify(entry.error));
    if (isAuth && !_retried && !process.env.LUCIA_ADMIN_JWT) {
      console.error("Session expired — re-authenticating in your browser…");
      await ensureToken(true);
      return trpc(method, path, input, true);
    }
    if (isAuth) die(`${path}: unauthorized. Unset LUCIA_ADMIN_JWT to use browser login, or supply a fresh token.`);
    const m = entry.error?.json?.message ?? entry.error?.message ?? JSON.stringify(entry.error);
    die(`${path}: ${m}`);
  }
  return entry?.result?.data?.json ?? entry?.result?.data;
}

const query = (path, input) => trpc("GET", path, input);
const mutate = (path, input) => trpc("POST", path, input);

function readPlan(file) {
  if (!file) die("no plan file given. Usage: node submit.mjs <plan.json>");
  let raw;
  try { raw = readFileSync(file, "utf8"); } catch (e) { die(`can't read ${file}: ${e.message}`); }
  let plan;
  try { plan = JSON.parse(raw); } catch (e) { die(`${file} is not valid JSON: ${e.message}`); }
  if (!plan.siteId) die("plan.siteId is required.");
  plan.findings = Array.isArray(plan.findings) ? plan.findings : [];
  plan.retractions = Array.isArray(plan.retractions) ? plan.retractions : [];
  if (!plan.findings.length && !plan.retractions.length) die("plan must have findings or retractions.");
  return plan;
}

function summariseFinding(f) {
  const n = (f.stitches || []).length;
  const tag = n ? `PATCH ${n} stitch${n === 1 ? "" : "es"}` : `DEVELOPER fix`;
  return `  [${f.wcagSc || "?"}] ${tag}  ${f.subject || ""}\n      page: ${f.pageUrl}\n      sel:  ${f.selector}`;
}

async function main() {
  const args = process.argv.slice(2);

  // --get-site
  if (args.includes("--get-site")) {
    const siteId = args[args.indexOf("--site") + 1];
    if (!siteId || siteId.startsWith("--")) die("--get-site needs --site <siteId>");
    const data = await query("expert.getSite", { siteId });
    console.log(`site ${data.site.id}  (${data.site.hostname})  tenant=${data.site.tenantId}`);
    console.log(`${data.pages.length} scanned page(s):`);
    for (const p of data.pages) console.log(`  - ${p.url}   score=${p.currentScore ?? "—"}  lastScan=${p.lastScanAt ?? "never"}`);
    return;
  }

  const dryRun = args.includes("--dry-run");
  const planFile = args.find((a) => !a.startsWith("--"));
  const plan = readPlan(planFile);

  const pages = [...new Set(plan.findings.map((f) => f.pageUrl))];
  console.log(`\nPlan: site ${plan.siteId}, ${plan.findings.length} finding(s), ${plan.retractions.length} retraction(s)`);
  if (plan.reviewer?.name) console.log(`Reviewer: ${plan.reviewer.name}${plan.reviewer.date ? ` (${plan.reviewer.date})` : ""}`);
  console.log("");
  for (const f of plan.findings) console.log(summariseFinding(f));
  for (const r of plan.retractions) console.log(`  [${r.axeRuleId}] RETRACT  ${r.reason || "false-positive Lucia remediation"}\n      page: ${r.pageUrl}`);
  console.log("");

  if (dryRun) {
    const patched = plan.findings.filter((f) => (f.stitches || []).length).length;
    console.log(`dry-run — nothing submitted. ${patched} would auto-patch, ${plan.findings.length - patched} developer fix(es), ${plan.retractions.length} retraction(s).`);
    console.log("Re-run without --dry-run to submit (opens your browser to sign in).");
    return;
  }

  const pageIds = [];

  // Retractions FIRST — pull bad/harmful stitches before (re-)adding findings,
  // so a fix-in-place plan (retract the old stitch + submit a corrected one for
  // the same selector) lands cleanly in a single run.
  if (plan.retractions.length) {
    console.log("Retracting Lucia remediations flagged by the reviewer…");
    for (const r of plan.retractions) {
      const out = await mutate("expert.retractStitch", {
        siteId: plan.siteId, pageUrl: r.pageUrl, axeRuleId: r.axeRuleId,
        selector: r.selector, reason: r.reason, reviewer: plan.reviewer?.name,
      });
      if (out.pageId) pageIds.push(out.pageId);
      const sc = out.score ? `  (score ${out.score.before}->${out.score.after})` : "";
      console.log(`  retracted ${r.axeRuleId}${r.selector ? " [" + r.selector + "]" : ""} on ${r.pageUrl}${sc}`);
    }
  }

  let patched = 0, manual = 0;
  for (const f of plan.findings) {
    const out = await mutate("expert.submitFinding", {
      siteId: plan.siteId,
      pageUrl: f.pageUrl,
      wcagSc: f.wcagSc,
      wcagName: f.wcagName,
      subject: f.subject,
      explanation: f.explanation,
      severity: f.severity || "serious",
      selector: f.selector,
      htmlSnippet: f.htmlSnippet,
      recommendation: f.recommendation,
      reviewer: plan.reviewer,
      stitches: f.stitches || [],
      // Forward provenance: the agentic Probe auditor sets source:"fathom"
      // per finding; human-expert imports omit it and the API defaults to
      // "expert". Without this the report mislabels Probe findings as
      // "human-identified".
      ...(f.source ? { source: f.source } : {}),
    });
    if (out.status === "patched") { patched++; console.log(`  ${f.wcagSc} patched — ${out.ruleIds.length} stitch(es), violation ${out.violationId}`); }
    else { manual++; console.log(`  • ${f.wcagSc} recorded as developer fix — violation ${out.violationId}`); }
  }

  if (pages.length) {
    console.log("\nCompiling page Patch Rolls (pushing stitches live)…");
    for (const pageUrl of pages) {
      const out = await mutate("expert.compilePage", { siteId: plan.siteId, pageUrl });
      if (out.pageId) pageIds.push(out.pageId);
      console.log(`  compiled ${pageUrl}  (page ${out.pageId})`);
    }
  }

  console.log(`\nDone. ${patched} auto-patched, ${manual} developer fix(es), ${plan.retractions.length} retraction(s). Live within ~a few seconds.`);
  for (const pid of [...new Set(pageIds)]) {
    console.log(`Report: https://getlucia.ai/sites/${plan.siteId}/pages/${pid}/detailed`);
  }
}

// Force a clean exit on success: an imported login() may leave a lingering
// loopback keep-alive socket (and fetch keep-alive sockets) that would
// otherwise pin the event loop open and make the CLI hang after "Done".
main().then(() => process.exit(0)).catch((e) => die(e?.stack || String(e)));
