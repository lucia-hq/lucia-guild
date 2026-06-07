#!/usr/bin/env node
/**
 * Browser login for the Lucia CLI — the `gh auth login` / `wrangler login`
 * loopback flow, so you never paste a token.
 *
 *   1. bind a one-shot HTTP server on 127.0.0.1:<random port>
 *   2. open the browser to <AUTH_URL>?callback=http://127.0.0.1:<port>/cb&state=<rnd>
 *   3. the page (signed-in admin) hands the session token back to /cb
 *   4. verify `state`, cache the token to ~/.lucia/token.json (mode 0600)
 *
 * Run directly to just log in + cache; or `import { login }` from submit.mjs.
 *
 * Env: LUCIA_AUTH_URL (default https://getlucia.ai/cli-auth)
 */

import http from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const AUTH_URL = (process.env.LUCIA_AUTH_URL || "https://getlucia.ai/cli-auth").replace(/\/+$/, "");
const TOKEN_DIR = join(homedir(), ".lucia");
export const TOKEN_PATH = join(TOKEN_DIR, "token.json");
// Reuse a cached token until just before its real expiry (read from the JWT
// `exp`) rather than a blunt fixed window — so a burst of CLI calls within one
// token's lifetime shares a single sign-in, and a longer-lived token (a Clerk
// JWT template) is honoured for its full life automatically. HEADROOM avoids
// handing back a token about to expire mid-request (the API 401s on expiry).
const EXP_HEADROOM_MS = 10_000;

function jwtExpMs(token) {
  try {
    const json = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return typeof json.exp === "number" ? json.exp * 1000 : 0;
  } catch { return 0; }
}

export function readCachedToken() {
  try {
    const j = JSON.parse(readFileSync(TOKEN_PATH, "utf8"));
    if (j && typeof j.token === "string") {
      const exp = jwtExpMs(j.token);
      if (exp && exp - EXP_HEADROOM_MS > Date.now()) return j.token;
    }
  } catch { /* no/!invalid cache */ }
  return null;
}

function cacheToken(token) {
  try {
    mkdirSync(TOKEN_DIR, { recursive: true });
    writeFileSync(TOKEN_PATH, JSON.stringify({ token, savedAt: Date.now() }), { mode: 0o600 });
  } catch { /* cache is best-effort */ }
}

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try { spawn(cmd, args, { stdio: "ignore", detached: true }).unref(); } catch { /* user pastes the URL */ }
}

// The page the browser lands on after the token handoff. Styled to match the
// `/cli-auth` authorize card (light card, gradient ⌁ mark) so the confirmation
// reads as one continuous flow rather than dumping the user on a plain page.
// On success it auto-closes the tab after a beat; browsers refuse
// window.close() on tabs a script didn't open, so we fall back to a styled
// "you can close this" hint when the close is blocked.
export function authPageHtml({ ok }) {
  const body = ok
    ? `<p class="ok">✓ Authorized</p><p class="muted" id="hint">Returning you to your terminal…</p>`
    : `<p class="err">Authorization failed</p><p class="muted">State mismatch or no token — return to your terminal and retry.</p>`;
  const script = ok
    ? `<script>setTimeout(function(){try{window.open('','_self');}catch(e){}window.close();setTimeout(function(){var h=document.getElementById('hint');if(h)h.textContent='Authorized — you can close this tab and return to your terminal.';},250);},1100);</script>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lucia CLI</title><style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;color:#0f172a;font:15px/1.6 ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;padding:24px}
.card{width:100%;max-width:28rem;background:#fff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 1px 2px rgba(15,23,42,.05);padding:40px 32px;text-align:center}
.logo{margin:0 auto 16px;width:44px;height:44px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:20px;color:#fff;background:linear-gradient(135deg,#3b82f6,#1d4ed8)}
h1{margin:0;font-size:20px;font-weight:600;color:#0f172a;letter-spacing:-.01em}
p{margin:12px 0 0;font-size:14px}
.ok{color:#047857;font-weight:600}
.err{color:#e11d48;font-weight:600}
.muted{color:#64748b}
</style></head><body><div class="card"><div class="logo">⌁</div><h1>Authorize the Lucia CLI</h1>${body}</div>${script}</body></html>`;
}

export function login({ timeoutMs = 180_000 } = {}) {
  // The loopback flow needs the browser and this CLI on the same machine. In the
  // Claude desktop app (Cowork) the CLI runs in a remote sandbox, so 127.0.0.1
  // can't bridge to your browser — fail fast with guidance instead of timing out.
  if (process.env.CLAUDE_CODE_ENTRYPOINT === "claude-desktop") {
    return Promise.reject(new Error(
      "Sign-in can't complete in the Claude desktop app (Cowork): the CLI runs in a sandbox that can't reach your browser's 127.0.0.1 loopback. Run `/lucia login` in Claude Code in a terminal instead.",
    ));
  }
  const state = randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    let done = false;
    const server = http.createServer((req, res) => {
      const u = new URL(req.url || "/", "http://127.0.0.1");
      if (u.pathname !== "/cb") { res.writeHead(404, { "connection": "close" }); res.end("not found"); return; }
      const token = u.searchParams.get("token");
      const gotState = u.searchParams.get("state");
      // Connection: close so the browser doesn't hold a keep-alive socket open
      // (which would keep server.close() pending and hang an importing CLI).
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "connection": "close" });
      if (!token || gotState !== state) {
        res.end(authPageHtml({ ok: false }));
        finish(() => reject(new Error("state mismatch or missing token")));
        return;
      }
      cacheToken(token);
      res.end(authPageHtml({ ok: true }));
      finish(() => resolve(token));
    });
    function finish(cb) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      server.close();
      // close() won't terminate an already-open keep-alive socket (e.g. a
      // browser favicon probe), which would keep the handle referenced and
      // hang an importing CLI. Force any lingering connections shut.
      try { if (server.closeAllConnections) server.closeAllConnections(); } catch { /* Node < 18.2 */ }
      // small delay so the response flushes to the browser before we exit
      setTimeout(cb, 50);
    }
    const timer = setTimeout(() => finish(() => reject(new Error("login timed out — no callback received"))), timeoutMs);
    server.on("error", (e) => finish(() => reject(e)));
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const cb = `http://127.0.0.1:${port}/cb`;
      const url = `${AUTH_URL}?callback=${encodeURIComponent(cb)}&state=${state}`;
      console.error(`\nOpening your browser to sign in…\n  ${url}\nIf it doesn't open automatically, paste that URL into your browser.\n`);
      openBrowser(url);
    });
  });
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  login()
    .then(() => { console.error(`Signed in — token cached to ${TOKEN_PATH}`); process.exit(0); })
    .catch((e) => { console.error(`login failed: ${e.message}`); process.exit(1); });
}
