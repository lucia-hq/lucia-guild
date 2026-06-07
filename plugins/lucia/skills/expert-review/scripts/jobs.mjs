#!/usr/bin/env node
/**
 * Guild job CLI — a Lucian's workflow against the Lucia marketplace, run from
 * their OWN Claude Code (the "bring your own Claude Code" requirement in
 * action). Same auth + tRPC plumbing as submit.mjs (browser login, cached
 * token).
 *
 *   node jobs.mjs whoami                       your Lucian profile + status
 *   node jobs.mjs apply [--name ..] [--tz ..] [--bio ..] [--spec a,b,c]
 *   node jobs.mjs login                        sign in + connect this Claude Code
 *   node jobs.mjs list                         open jobs on the board
 *   node jobs.mjs claim <jobId>                claim an open job (first-come)
 *   node jobs.mjs mine                         jobs you hold / are working
 *   node jobs.mjs start <jobId>                begin work (claimed -> in_progress)
 *   node jobs.mjs submit <jobId> --summary ".." --findings N --net-new N --minutes N
 *
 * Typical loop: claim -> start -> audit the job's site with the `probe` skill ->
 * submit fixes with ./submit.mjs -> `submit` the job here to hand it to QA.
 *
 * Env: LUCIA_API_URL (default https://api.getlucia.ai).
 *
 * No dependencies — Node 18+ global fetch only.
 */

import { login, readCachedToken } from "./login.mjs";

const API_URL = (process.env.LUCIA_API_URL || "https://api.getlucia.ai").replace(/\/+$/, "");

function die(msg) {
  console.error(`\x1b[31merror:\x1b[0m ${msg}`);
  process.exit(1);
}

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

// Batched tRPC over HTTP — identical shape to submit.mjs (GET=query, POST=mutation).
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
  try { body = JSON.parse(text); } catch { die(`${path}: non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`); }
  const entry = Array.isArray(body) ? body[0] : body;
  if (entry?.error) {
    const isAuth = res.status === 401 || /UNAUTHORIZED/.test(JSON.stringify(entry.error));
    if (isAuth && !_retried && !process.env.LUCIA_ADMIN_JWT) {
      console.error("Session expired — re-authenticating in your browser…");
      await ensureToken(true);
      return trpc(method, path, input, true);
    }
    const m = entry.error?.json?.message ?? entry.error?.message ?? JSON.stringify(entry.error);
    die(`${path}: ${m}`);
  }
  return entry?.result?.data?.json ?? entry?.result?.data;
}
const query = (p, i) => trpc("GET", p, i);
const mutate = (p, i) => trpc("POST", p, i);

function flag(args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; }
function money(cents) { return "$" + Math.round((cents || 0) / 100).toLocaleString("en-US"); }

function printJob(j) {
  const quote = j.custom ? "Custom quote" : money(j.quoteCents);
  const rush = j.priority === "rush" ? " \x1b[33m[RUSH]\x1b[0m" : "";
  const variants = Math.max(0, (j.pageCountTotal || 0) - (j.pageCountUnique || 0));
  console.log(`  \x1b[1m${j.id}\x1b[0m${rush}`);
  console.log(`    ${j.siteHostname || j.siteId}  ·  \x1b[36m${j.sizeTier}\x1b[0m  ·  ${quote}  ·  ~${j.estimatedHours}h`);
  console.log(`    ${j.pageCountUnique} unique page(s) · ${variants} variant(s) · ${j.languageCount} language(s)  ·  status=${j.status}`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "whoami": {
      const me = await query("experts.me", undefined);
      if (!me) { console.log("Not a Lucian yet. Apply with: node jobs.mjs apply"); return; }
      console.log(`\x1b[1m${me.displayName || me.email}\x1b[0m — ${me.tier} · status=${me.status}`);
      console.log(`Claude Code: ${me.claudeConnectedAt ? "connected ✓" : "\x1b[33mNOT connected\x1b[0m — run: /lucia login"}`);
      return;
    }
    case "apply": {
      const specs = flag(rest, "--spec");
      const out = await mutate("experts.register", {
        displayName: flag(rest, "--name"),
        bio: flag(rest, "--bio"),
        timezone: flag(rest, "--tz"),
        specializations: specs ? specs.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      });
      console.log(`Applied to the Guild. status=${out?.status ?? "applied"}.`);
      console.log("Next: /lucia login  (signs in + connects this Claude Code; then a Lucia operator activates you).");
      return;
    }
    case "login": {
      await ensureToken();
      await mutate("experts.connectClaude", undefined);
      console.log("\x1b[32m✓ logged in\x1b[0m and connected your Claude Code to the Guild.");
      console.log("A Lucia operator will activate you — then run: /lucia jobs");
      return;
    }
    case "list": {
      const jobs = await query("jobs.listOpen", undefined);
      if (!jobs?.length) { console.log("No open jobs right now — the board is live, check back."); return; }
      console.log(`\x1b[1m${jobs.length} open job(s):\x1b[0m`);
      for (const j of jobs) printJob(j);
      console.log(`\nClaim one: node jobs.mjs claim <jobId>`);
      return;
    }
    case "mine": {
      const jobs = await query("jobs.mine", undefined);
      if (!jobs?.length) { console.log("You're not holding any jobs. Find one: node jobs.mjs list"); return; }
      for (const j of jobs) printJob(j);
      return;
    }
    case "claim": {
      const id = rest[0];
      if (!id || id.startsWith("--")) die("usage: node jobs.mjs claim <jobId>");
      const out = await mutate("jobs.claim", { jobId: id });
      console.log(`\x1b[32m✓ claimed\x1b[0m ${out.jobId}  (hold expires ${out.holdExpiresAt})`);
      console.log(`Start work: node jobs.mjs start ${id}`);
      return;
    }
    case "start": {
      const id = rest[0];
      if (!id || id.startsWith("--")) die("usage: node jobs.mjs start <jobId>");
      await mutate("jobs.start", { jobId: id });
      console.log(`\x1b[32m✓ started\x1b[0m ${id}. Audit the site with the probe skill, submit fixes with ./submit.mjs,`);
      console.log(`then hand it to QA: node jobs.mjs submit ${id} --findings N --net-new N`);
      return;
    }
    case "submit": {
      const id = rest[0];
      if (!id || id.startsWith("--")) die("usage: node jobs.mjs submit <jobId> [--summary ..] [--findings N] [--net-new N] [--minutes N]");
      const mins = flag(rest, "--minutes");
      await mutate("jobs.submit", {
        jobId: id,
        summary: flag(rest, "--summary"),
        findingsCount: Number(flag(rest, "--findings") || 0),
        netNewCount: Number(flag(rest, "--net-new") || 0),
        ...(mins ? { actualMinutes: Number(mins) } : {}),
      });
      console.log(`\x1b[32m✓ submitted\x1b[0m ${id} for QA review.` + (mins ? ` (${mins} min)` : ""));
      return;
    }
    default:
      console.log("Guild job CLI. Commands:");
      console.log("  whoami · apply · login · list · claim <id> · mine · start <id> · submit <id>");
  }
}

main().then(() => process.exit(0)).catch((e) => die(e?.stack || String(e)));
