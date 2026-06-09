#!/usr/bin/env node
/**
 * Guild Business Development (BD) CLI — a Lucian's outbound prospecting loop for
 * Lucia, run from their OWN Claude Code. Same auth + tRPC plumbing as the job
 * CLI (browser login, cached token).
 *
 *   node bd.mjs start [--sector ..] [--geo ..] [--size ..]   begin today's journey (shows budgets)
 *   node bd.mjs recon <url>                                  read-only liveness/signal check on a prospect
 *   node bd.mjs scan <journeyId> <url>                       run a Lucia scan (≤5 per journey, enforced server-side)
 *   node bd.mjs status <targetId>                            poll a scan to completion
 *   node bd.mjs summary <targetId>                           headline findings + scores + preview for pitch copy
 *   node bd.mjs deck-data <targetId>                         structured evidence for a PPTX deck
 *   node bd.mjs recipient <targetId> <email> [--name ".."]   record the prospect contact (domain must match)
 *   node bd.mjs email <targetId> [--region us|uk|eu] [--name ".."]   generate the pitch email (no send)
 *   node bd.mjs send <targetId> --hash <bodyHash> [--region ..]      SEND (gated; off until the operator enables it)
 *   node bd.mjs mine                                         your BD dashboard (prospects + send history)
 *
 * The journey: start -> (Claude researches targets) -> recon each -> scan up to
 * 5 -> status until done -> summary -> email + (Claude builds the deck) ->
 * recipient -> send. Sending stays DISABLED until a Lucia operator finishes the
 * Cloudflare email setup; until then `send` reports it cleanly.
 *
 * Env: LUCIA_API_URL (default https://api.getlucia.ai). Node 18+ global fetch.
 */

import { login, readCachedToken } from "../../expert-review/scripts/login.mjs";

const API_URL = (process.env.LUCIA_API_URL || "https://api.getlucia.ai").replace(/\/+$/, "");

function die(msg) { console.error(`error: ${msg}`); process.exit(1); }
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

// Batched tRPC over HTTP — identical shape to the job CLI (GET=query, POST=mutation).
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

function printFindings(findings) {
  if (!findings?.length) { console.log("  (no headline findings yet)"); return; }
  for (const f of findings) {
    const n = f.count > 1 ? ` x${f.count}` : "";
    console.log(`  - ${f.label} [${f.impact}]${n}`);
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "start": {
      const targeting = {};
      if (flag(rest, "--sector")) targeting.sector = flag(rest, "--sector");
      if (flag(rest, "--geo")) targeting.geography = flag(rest, "--geo");
      if (flag(rest, "--size")) targeting.size = flag(rest, "--size");
      const out = await mutate("bd.startJourney", Object.keys(targeting).length ? { targeting } : undefined);
      console.log(`BD journey: ${out.journeyId}`);
      console.log(`Your prospecting address: ${out.fromAddress}`);
      console.log(`Scans: ${out.scansUsed}/${out.scanCap} used (${out.scansRemaining} left this journey).`);
      console.log(`Sends: ${out.sendBudget.sentToday}/${out.sendBudget.capPerDay} today, ${out.sendBudget.sentThisWeek}/${out.sendBudget.capPerWeek} this week.`);
      console.log(out.sendEnabled
        ? "Sending is ENABLED."
        : "Sending is NOT enabled yet (pending operator setup) — you can still scan, generate and preview everything.");
      return;
    }
    case "recon": {
      const u = rest[0];
      if (!u || u.startsWith("--")) die("usage: node bd.mjs recon <url>");
      const out = await query("bd.recon", { url: u });
      console.log(`${out.hostname} (domain ${out.registrableDomain})`);
      console.log(`  live: ${out.live ? "yes" : "no"}${out.title ? `, title: ${out.title}` : ""}`);
      if (out.generator) console.log(`  generator: ${out.generator}`);
      if (out.server) console.log(`  server: ${out.server}`);
      return;
    }
    case "scan": {
      const journeyId = rest[0]; const u = rest[1];
      if (!journeyId || !u) die("usage: node bd.mjs scan <journeyId> <url>");
      const out = await mutate("bd.scanTarget", { journeyId, url: u });
      console.log(`scanning ${out.url}`);
      console.log(`  targetId: ${out.targetId}`);
      console.log(`  preview (ready when the scan completes): ${out.previewUrl}`);
      console.log(`  scans: ${out.scansUsed}/5 used (${out.scansRemaining} left).`);
      console.log(`Poll it: node bd.mjs status ${out.targetId}`);
      return;
    }
    case "status": {
      const id = rest[0];
      if (!id || id.startsWith("--")) die("usage: node bd.mjs status <targetId>");
      const out = await query("bd.scanStatus", { targetId: id });
      console.log(`status: ${out.status} (${out.percent}%)`);
      if (out.scoreBefore != null && out.scoreAfter != null) {
        console.log(`  score: ${out.scoreBefore} -> ${out.scoreAfter} (out of 100)`);
      }
      if (out.previewUrl) console.log(`  preview: ${out.previewUrl}`);
      if (out.status !== "done" && out.status !== "failed") console.log("Not finished — poll again in a few seconds.");
      return;
    }
    case "summary": {
      const id = rest[0];
      if (!id || id.startsWith("--")) die("usage: node bd.mjs summary <targetId>");
      const out = await query("bd.targetSummary", { targetId: id });
      console.log(`${out.hostname}`);
      console.log(`  score: ${out.scoreBefore ?? "?"} -> ${out.scoreAfter ?? "?"} (out of 100)`);
      console.log(`  preview: ${out.previewUrl ?? "(none)"}`);
      console.log(`  evidence pack siteId: ${out.evidencePack.siteId}  (fetch reports.evidencePack {siteId})`);
      console.log(`  headline findings:`);
      printFindings(out.findings);
      return;
    }
    case "deck-data": {
      const id = rest[0];
      if (!id || id.startsWith("--")) die("usage: node bd.mjs deck-data <targetId>");
      const out = await query("bd.evidenceForDeck", { targetId: id });
      // Emit JSON so Claude can build the PPTX deck from the real evidence.
      console.log(JSON.stringify(out, null, 2));
      return;
    }
    case "recipient": {
      const id = rest[0]; const email = rest[1];
      if (!id || !email || email.startsWith("--")) die("usage: node bd.mjs recipient <targetId> <email> [--name \"..\"]");
      const out = await mutate("bd.recordTarget", { targetId: id, contactEmail: email, contactName: flag(rest, "--name") });
      console.log(`recipient recorded: ${out.contactEmail}`);
      return;
    }
    case "email": {
      const id = rest[0];
      if (!id || id.startsWith("--")) die("usage: node bd.mjs email <targetId> [--region us|uk|eu] [--name \"..\"]");
      const out = await query("bd.generateEmail", {
        targetId: id, region: flag(rest, "--region"), prospectName: flag(rest, "--name"),
      });
      console.log(`From: ${out.fromAddress}`);
      console.log(`Subject: ${out.subject}`);
      console.log("");
      console.log(out.text);
      console.log("");
      console.log(`(bodyHash for sending: ${out.bodyHash})`);
      console.log(`To send once a recipient is recorded: node bd.mjs send ${id} --hash ${out.bodyHash}` +
        (flag(rest, "--region") ? ` --region ${flag(rest, "--region")}` : ""));
      return;
    }
    case "send": {
      const id = rest[0];
      const hash = flag(rest, "--hash");
      if (!id || id.startsWith("--") || !hash) die("usage: node bd.mjs send <targetId> --hash <bodyHash> [--region us|uk|eu]");
      const out = await mutate("bd.sendPitch", { targetId: id, bodyHash: hash, region: flag(rest, "--region") });
      if (out.status === "sent") {
        console.log(`sent to ${out.toAddress} from ${out.fromAddress}.`);
      } else if (out.status === "blocked_disabled") {
        console.log(out.message);
      } else {
        console.log(`status: ${out.status}`);
      }
      return;
    }
    case "mine": {
      const out = await query("bd.myOutreach", undefined);
      console.log(`Prospecting address: ${out.fromAddress ?? "(not assigned yet — run: node bd.mjs start)"}`);
      console.log(`Sending: ${out.sendEnabled ? "enabled" : "not enabled yet"}`);
      console.log(`Sends: ${out.sendBudget.sentToday}/${out.sendBudget.capPerDay} today, ${out.sendBudget.sentThisWeek}/${out.sendBudget.capPerWeek} this week.`);
      if (out.targets?.length) {
        console.log(`\nProspects (${out.targets.length}):`);
        for (const t of out.targets) {
          const score = (t.scoreBefore != null && t.scoreAfter != null) ? ` ${t.scoreBefore}->${t.scoreAfter}` : "";
          console.log(`  ${t.hostname}${score}  [${t.lastScanStatus ?? "?"}]${t.contactEmail ? `  -> ${t.contactEmail}` : ""}`);
          console.log(`    ${t.targetId}${t.previewUrl ? `  ${t.previewUrl}` : ""}`);
        }
      }
      if (out.sends?.length) {
        console.log(`\nRecent send attempts:`);
        for (const s of out.sends) console.log(`  ${s.createdAt}  ${s.status}  ${s.toAddress}${s.reason ? `  (${s.reason})` : ""}`);
      }
      return;
    }
    default:
      console.log("Guild BD (prospecting) CLI. Commands:");
      console.log("  start, recon <url>, scan <journeyId> <url>, status <targetId>, summary <targetId>,");
      console.log("  deck-data <targetId>, recipient <targetId> <email>, email <targetId>, send <targetId> --hash <h>, mine");
  }
}

main().then(() => process.exit(0)).catch((e) => die(e?.stack || String(e)));
