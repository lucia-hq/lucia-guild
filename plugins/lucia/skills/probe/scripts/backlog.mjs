#!/usr/bin/env node
/**
 * backlog.mjs — Phase 0 of an audit: what did the AUTOMATED layer already find,
 * and what's still unfixed? Lists a site's stored automated findings (axe +
 * Sentinel + vision), classifies each, and scaffolds a fix plan for everything
 * that's auto-remediable but not yet patched.
 *
 * The probe skill runs this FIRST — clear the automated backlog before driving
 * the browser for the deep interaction scan. Cheap, high-volume wins first;
 * expensive interaction findings second.
 *
 *   node backlog.mjs <siteId>                 summarise + write backlog-plan.json
 *   node backlog.mjs <siteId> --json          machine-readable breakdown, no file
 *
 * Auth + API reused from expert-review (browser login on first call).
 * Env: LUCIA_API_URL (default https://api.getlucia.ai), LUCIA_ADMIN_JWT (optional override).
 */

import { writeFileSync } from "node:fs";
import { login, readCachedToken } from "../../expert-review/scripts/login.mjs";

const API_URL = (process.env.LUCIA_API_URL || "https://api.getlucia.ai").replace(/\/+$/, "");
const die = (m) => { console.error(`\x1b[31merror:\x1b[0m ${m}`); process.exit(1); };

// Rules the Loom registry buckets as `manual` — a genuine human decision
// automation must not guess. Mirrors packages/loom/src/registry.ts (bucket:
// "manual") plus every `lucia/vision-*` (pixel-level, informational). Anything
// else the automated layer surfaces is treated as auto-remediable.
const HUMAN_RULES = new Set([
  "aria-roles", "keyboard", "video-caption", "list", "definition-list",
  "lucia/seo/title-length", "lucia/seo/multiple-h1", "lucia/seo/json-ld-missing",
]);
const isHumanInput = (axeRuleId) =>
  axeRuleId.startsWith("lucia/vision-") || HUMAN_RULES.has(axeRuleId);

/**
 * Split a page's findings into: already-remediated, the automated backlog to
 * fix now (queued), the genuine human-input residual, and the interaction
 * findings the deep scan owns (Phase 1). Pure — testable offline.
 */
export function classify(violations, rules) {
  const ruleKey = new Set(rules.map((r) => `${r.axeRuleId}|${r.selector}`));
  const res = { remediated: [], queued: [], human: [], interaction: [] };
  for (const v of violations) {
    if (v.status === "ignored") continue;
    const done = v.status === "patched" || v.resolvedByRuleId || ruleKey.has(`${v.axeRuleId}|${v.selector}`);
    if (done) { res.remediated.push(v); continue; }
    if (v.source === "fathom") { res.interaction.push(v); continue; } // Phase 1 — the deep scan
    if (v.source === "expert") continue;                              // human-submitted, not automated backlog
    (isHumanInput(v.axeRuleId) ? res.human : res.queued).push(v);     // axe / vision automated layer
  }
  return res;
}

// ---- API plumbing (read-only GET, mirrors expert-review/submit.mjs) ----
let token = null;
async function ensureToken(force = false) {
  if (!force) {
    if (process.env.LUCIA_ADMIN_JWT) return (token = process.env.LUCIA_ADMIN_JWT);
    if (token) return token;
    const cached = readCachedToken();
    if (cached) return (token = cached);
  }
  return (token = await login());
}
async function query(path, input, _retried = false) {
  if (!token) await ensureToken();
  const url = `${API_URL}/trpc/${path}?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: input }))}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { die(`${path}: non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`); }
  const entry = Array.isArray(body) ? body[0] : body;
  if (entry?.error) {
    const isAuth = res.status === 401 || /UNAUTHORIZED/.test(JSON.stringify(entry.error));
    if (isAuth && !_retried && !process.env.LUCIA_ADMIN_JWT) { await ensureToken(true); return query(path, input, true); }
    die(`${path}: ${entry.error?.json?.message ?? entry.error?.message ?? JSON.stringify(entry.error)}`);
  }
  return entry?.result?.data?.json ?? entry?.result?.data;
}

const wcagOf = (v) => {
  try { const m = JSON.parse(v.sourceMetaJson || "{}"); if (m.wcagSc) return m.wcagSc; } catch { /* */ }
  for (const t of JSON.parse(v.wcagTagsJson || "[]")) {
    const m = /^wcag(\d)(\d)(\d+)$/.exec(t); if (m) return `${m[1]}.${m[2]}.${m[3]}`;
  }
  return "—";
};

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const siteId = args.find((a) => !a.startsWith("--"));
  if (!siteId) die("usage: node backlog.mjs <siteId> [--json]");

  const site = await query("expert.getSite", { siteId });
  const totals = { remediated: 0, queued: 0, human: 0, interaction: 0 };
  const planFindings = [];
  const perPage = [];

  for (const p of site.pages) {
    let report;
    try { report = await query("reports.getLatestReportForPage", { pageId: p.id }); }
    catch { perPage.push({ url: p.url, note: "no completed scan" }); continue; }
    const c = classify(report.violations || [], report.rules || []);
    for (const k of Object.keys(totals)) totals[k] += c[k].length;
    perPage.push({ url: p.url, queued: c.queued.length, human: c.human.length, interaction: c.interaction.length, remediated: c.remediated.length });
    for (const v of c.queued) {
      planFindings.push({
        pageUrl: report.page?.url || p.url,
        wcagSc: wcagOf(v),
        subject: v.axeRuleId.replace(/^lucia\//, ""),
        severity: v.impact,
        selector: v.selector,
        source: "axe",
        stitches: [], // ← AUTHOR these per stitch-ops.md, then preflight + submit
      });
    }
  }

  if (asJson) { console.log(JSON.stringify({ siteId, totals, perPage }, null, 2)); return; }

  console.log(`\n\x1b[1mAutomated backlog — ${siteId}\x1b[0m  (${site.site?.hostname ?? ""})`);
  console.log(`  \x1b[32m${totals.remediated}\x1b[0m already remediated`);
  console.log(`  \x1b[34m${totals.queued}\x1b[0m queued to fix  ← Phase 0: author + preflight + submit these now`);
  console.log(`  \x1b[33m${totals.human}\x1b[0m need human input (residual — captions / intent; honest, not auto-fixed)`);
  console.log(`  \x1b[90m${totals.interaction}\x1b[0m interaction findings → Phase 1 (the deep scan)`);
  console.log("");
  for (const pg of perPage) {
    if (pg.note) { console.log(`  ${pg.url}  \x1b[90m(${pg.note})\x1b[0m`); continue; }
    console.log(`  ${pg.url}  queued=${pg.queued} human=${pg.human} interaction=${pg.interaction} done=${pg.remediated}`);
  }

  if (planFindings.length) {
    const out = `backlog-plan.json`;
    writeFileSync(out, JSON.stringify({
      siteId,
      reviewer: { name: "Lucia Agent", environment: "automated-layer backlog sweep" },
      _note: "SCAFFOLD: each finding's stitches[] is empty — author the fix per ../../expert-review/reference/stitch-ops.md, preflight, then submit. Then run the Phase-1 interaction scan.",
      findings: planFindings,
    }, null, 2));
    console.log(`\nWrote \x1b[1m${out}\x1b[0m — ${planFindings.length} auto-remediable finding(s) to fix. Stitches are empty; author + preflight each, then submit.`);
  } else {
    console.log(`\n\x1b[32mAutomated layer is clear.\x1b[0m Proceed to the Phase-1 interaction scan.`);
  }
}

import { pathToFileURL } from "node:url";
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((e) => die(e.message));
