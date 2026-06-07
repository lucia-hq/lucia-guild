#!/usr/bin/env node
/**
 * Guild TRAINING CLI — a Lucian's guided first audit, runnable before they're
 * activated. Spins up a throwaway demo site, watches Lucia's automated pipeline
 * remediate it, and (via the probe + expert-review skills) lets them practise a
 * human fix and see it live on a preview URL.
 *
 *   node train.mjs start [url]      create a demo training site + queue the auto pipeline
 *   node train.mjs status <siteId>  poll auto-remediation progress (stage, score, preview)
 *   node train.mjs complete <siteId>  finish the run
 *
 * Same auth + tRPC plumbing as jobs.mjs (browser login, cached token).
 * Env: LUCIA_API_URL (default https://api.getlucia.ai).
 */

import { login, readCachedToken } from "./login.mjs";

const API_URL = (process.env.LUCIA_API_URL || "https://api.getlucia.ai").replace(/\/+$/, "");

function die(msg) {
  console.error(`error: ${msg}`);
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

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "start": {
      const url = rest.find((a) => !a.startsWith("--"));
      const out = await mutate("training.start", { url: url || undefined });
      console.log(`training site ready  (${out.isDefaultDemo ? "W3C demo" : out.url})`);
      console.log(`  siteId:   ${out.siteId}`);
      console.log(`  preview:  ${out.previewUrl}`);
      console.log(`  The automated pipeline is now remediating it.`);
      console.log(`  Watch it: node train.mjs status ${out.siteId}`);
      return;
    }
    case "status": {
      const id = rest[0];
      if (!id || id.startsWith("--")) die("usage: node train.mjs status <siteId>");
      const s = await query("training.status", { siteId: id });
      console.log(`Progress: ${s.percent || 0}% (${s.status})`);
      if (s.scoreBefore != null && s.scoreAfter != null) {
        console.log(`  score: ${s.scoreBefore} -> ${s.scoreAfter}`);
      }
      if (s.previewUrl) console.log(`  preview: ${s.previewUrl}`);
      if (s.status === "done") console.log(`  Auto-remediation complete. Audit it with the probe skill, then submit one human fix.`);
      if (s.status === "failed") console.log(`  Scan failed. Try \`node train.mjs start\` again (the demo URL, or a simpler page).`);
      return;
    }
    case "complete": {
      const id = rest[0];
      if (!id || id.startsWith("--")) die("usage: node train.mjs complete <siteId>");
      await mutate("training.complete", { siteId: id });
      console.log(`training complete. Nice work — that's the whole Lucian loop.`);
      console.log(`A Lucia operator will activate you for real jobs (check: /lucia:whoami).`);
      return;
    }
    default:
      console.log("Guild training CLI. Commands:");
      console.log("  start [url], status <siteId>, complete <siteId>");
  }
}

main().then(() => process.exit(0)).catch((e) => die(e?.stack || String(e)));
