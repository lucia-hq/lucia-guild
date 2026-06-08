#!/usr/bin/env node
/**
 * Guild TRAINING CLI — the scored assessment a Lucian must pass before they can
 * be activated. The trainee audits a deliberately-broken demo site; `score`
 * grades their findings against a hidden server-side key and records the result.
 *
 *   node train.mjs score --file findings.json [--site <id>]
 *        findings.json = JSON array of { selector, category, wcag, note }
 *        -> grades the Stage-1 audit, returns the score + what they missed
 *   node train.mjs start [url]        create a practice site to apply a human fix on
 *   node train.mjs complete <siteId>  finish the run
 *
 * Same auth + tRPC plumbing as jobs.mjs (browser login, cached token).
 * Env: LUCIA_API_URL (default https://api.getlucia.ai).
 */

import { login, readCachedToken } from "./login.mjs";
import { readFileSync } from "node:fs";

const API_URL = (process.env.LUCIA_API_URL || "https://api.getlucia.ai").replace(/\/+$/, "");

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function flag(args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; }

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
      console.error("Session expired — re-authenticating in your browser.");
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
    case "score": {
      const file = flag(rest, "--file");
      if (!file) die("usage: node train.mjs score --file <findings.json> [--site <id>]");
      let findings;
      try { findings = JSON.parse(readFileSync(file, "utf8")); }
      catch (e) { die(`couldn't read findings file ${file}: ${e.message}`); }
      if (!Array.isArray(findings)) die("findings file must be a JSON array of {selector, category, wcag, note}");
      const out = await mutate("training.score", { findings, siteId: flag(rest, "--site") });
      console.log(`Score: ${out.score} out of 100. ${out.passed ? "Passed." : `Not passed — you need ${out.passThreshold}.`}`);
      console.log(`You found ${out.found} of ${out.total} issues. Recall ${out.recallPct} percent, precision ${out.precisionPct} percent.`);
      if (out.falsePositives) console.log(`${out.falsePositives} of your findings did not match a real issue.`);
      if (out.missed?.length) {
        console.log(`You missed ${out.missed.length}:`);
        for (const m of out.missed) console.log(`- ${m.label} (WCAG ${m.wcag})`);
      }
      return;
    }
    case "validate": {
      const file = flag(rest, "--file");
      if (!file) die("usage: node train.mjs validate --file <findings.json> [--site <id>]");
      let findings;
      try { findings = JSON.parse(readFileSync(file, "utf8")); }
      catch (e) { die(`couldn't read findings file ${file}: ${e.message}`); }
      if (!Array.isArray(findings)) die("findings file must be a JSON array of {selector, category, note}");
      const out = await mutate("training.validate", { findings, siteId: flag(rest, "--site") });
      console.log(`Validation score: ${out.score} out of 100. ${out.passed ? "Passed." : `Not passed — you need ${out.passThreshold}.`}`);
      console.log(`You caught ${out.caught} of ${out.total} machine mistakes. Recall ${out.recallPct} percent, precision ${out.precisionPct} percent.`);
      if (out.falsePositives) console.log(`${out.falsePositives} of your flags were on fixes that were actually fine.`);
      if (out.missed?.length) {
        console.log(`You missed ${out.missed.length}:`);
        for (const m of out.missed) console.log(`- ${m.label}`);
      }
      return;
    }
    case "start": {
      const url = rest.find((a) => !a.startsWith("--"));
      const out = await mutate("training.start", { url: url || undefined });
      console.log(`Practice site ready.`);
      console.log(`siteId: ${out.siteId}`);
      console.log(`preview: ${out.previewUrl}`);
      console.log(`Apply a fix with the expert-review skill for this siteId, then reload the preview to see it.`);
      return;
    }
    case "complete": {
      const id = rest[0];
      if (!id || id.startsWith("--")) die("usage: node train.mjs complete <siteId>");
      await mutate("training.complete", { siteId: id });
      console.log(`Training complete.`);
      console.log(`A Lucia operator will review your score and activate you (check with /lucia:whoami).`);
      return;
    }
    default:
      console.log("Guild training CLI. Commands:");
      console.log("  score --file <f.json>, validate --file <f.json>, start [url], complete <siteId>");
  }
}

main().then(() => process.exit(0)).catch((e) => die(e?.stack || String(e)));
