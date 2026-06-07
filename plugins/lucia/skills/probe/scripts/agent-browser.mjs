#!/usr/bin/env node
/**
 * Probe CDP a11y harness — the browser reduced to an assistive-technology
 * user's verbs, with the accessibility tree as the readout.
 *
 * Session model: ONE long-lived `start` process owns the browser + the single
 * page (so focus/interaction STATE persists), and exposes the AT-user verbs
 * over a tiny localhost HTTP server. Every other command is a thin client that
 * forwards to it and prints the JSON reply. (Playwright's launchServer+connect
 * isolates contexts per connection, which resets focus every command — hence a
 * shared in-process page instead.)
 *
 *   node agent-browser.mjs start <url>     # run in the background
 *   node agent-browser.mjs ax [selector]
 *   node agent-browser.mjs tab | shtab
 *   node agent-browser.mjs press <Key>
 *   node agent-browser.mjs activate
 *   node agent-browser.mjs focused
 *   node agent-browser.mjs query <selector>
 *   node agent-browser.mjs zoom <pct> | reflow <width> | nav <url>
 *   node agent-browser.mjs shot <x,y,w,h> <path>
 *   node agent-browser.mjs stop
 *
 * Reason from `ax`/`focused` (what a screen reader sees), not pixels.
 * Headed by default (operator watches); PROBE_HEADLESS=1 for CI/eval.
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const STATE = join(tmpdir(), "lucia-probe-session.json");
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const die = (msg) => { out({ error: msg }); process.exit(1); };

// ---------- the AT-user verbs (run inside the start process, on the page) ----------

/** Pruned, SR-shaped tree from CDP Accessibility.getFullAXTree — what a screen reader consumes. */
function buildAx(nodes) {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const childSet = new Set();
  nodes.forEach((n) => (n.childIds || []).forEach((c) => childSet.add(c)));
  const roots = nodes.filter((n) => !childSet.has(n.nodeId));
  const STATES = ["focusable", "checked", "pressed", "expanded", "disabled", "selected", "level", "required", "invalid"];
  const prune = (n, d = 0) => {
    if (!n || d > 18) return null;
    const kids = (n.childIds || []).flatMap((id) => { const r = prune(byId.get(id), d + 1); return r ? [r] : []; });
    const role = n.role?.value;
    if (role === "InlineTextBox") return null;
    if (n.ignored) return kids.length === 1 ? kids[0] : (kids.length ? { children: kids } : null);
    if (role === "StaticText") return { role: "text", name: n.name?.value || "" };
    const o = { role, name: n.name?.value || undefined };
    for (const p of (n.properties || [])) {
      if (STATES.includes(p.name)) { const v = p.value?.value; if (v !== undefined && v !== false && v !== "false") o[p.name] = v; }
    }
    if (kids.length) o.children = kids.slice(0, 80);
    return o;
  };
  const o = roots.map((r) => prune(r)).filter(Boolean);
  return o.length === 1 ? o[0] : { children: o };
}

const FOCUSED_JS = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return { focused: false };
  // A UNIQUE selector (nth-of-type path) so the verifier can target this exact
  // node even when it has no id/class — otherwise empty-name controls collapse
  // to a non-unique tag selector and can't be confirmed.
  const uniq = (n) => {
    if (n.id && document.querySelectorAll('#' + CSS.escape(n.id)).length === 1) return '#' + CSS.escape(n.id);
    const seg = (x) => { let s = x.tagName.toLowerCase(); const p = x.parentElement;
      if (p) { const same = [...p.children].filter(c => c.tagName === x.tagName); if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(x) + 1) + ')'; } return s; };
    let parts = [], cur = n;
    for (let d = 0; d < 8 && cur && cur.nodeType === 1; d++) {
      parts.unshift(seg(cur)); const sel = parts.join(' > ');
      try { if (document.querySelectorAll(sel).length === 1) return sel; } catch {}
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  };
  const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
  const name = (el.getAttribute('aria-label') || el.getAttribute('alt')
    || (el.labels && el.labels[0] && el.labels[0].innerText) || el.getAttribute('title')
    || el.value || el.innerText || '').trim().replace(/\\s+/g,' ').slice(0,200);
  const role = el.getAttribute('role') || ({A:'link',BUTTON:'button',INPUT:'textbox',SELECT:'combobox',TEXTAREA:'textbox'})[el.tagName] || el.tagName.toLowerCase();
  let focusVisible = false; try { focusVisible = el.matches(':focus-visible'); } catch {}
  const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth || '0') > 0;
  const indicator = outline || (cs.boxShadow && cs.boxShadow !== 'none');
  return { focused: true, role, name, hasName: !!name, value: (el.value ?? null), tag: el.tagName.toLowerCase(), selector: uniq(el),
    box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
    focusVisible, hasFocusIndicator: !!indicator };
})()`;

const DOM_SIG = `(() => document.querySelectorAll('*').length + ':' + (document.querySelector('[role=dialog],dialog[open],.modal,[aria-modal=true]') ? 1 : 0))()`;

async function dialogOpen(page) {
  return page.evaluate(() => {
    const d = document.querySelector('[role=dialog],dialog[open],[aria-modal=true],.modal'); if (!d) return null;
    const cs = getComputedStyle(d), r = d.getBoundingClientRect();
    const visible = r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
    return visible ? { selector: d.id ? '#' + d.id : (d.getAttribute('role') ? '[role=' + d.getAttribute('role') + ']' : '.modal'), role: d.getAttribute('role') || d.tagName.toLowerCase() } : null;
  });
}

function makeHandlers(page) {
  return {
    async ax() {
      const c = await page.context().newCDPSession(page);
      await c.send("Accessibility.enable");
      const { nodes } = await c.send("Accessibility.getFullAXTree");
      return { ax: buildAx(nodes) };
    },
    async tab() { await page.keyboard.press("Tab"); return { stepped: "Tab", ...(await page.evaluate(FOCUSED_JS)) }; },
    async shtab() { await page.keyboard.press("Shift+Tab"); return { stepped: "Shift+Tab", ...(await page.evaluate(FOCUSED_JS)) }; },
    /** Tab through the whole page once from the top, recording the focus path
     *  (the keyboard/SR reachability + focus-visible + focus-order workhorse). */
    async tabwalk(max) {
      const limit = Number(max) || 60;
      await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
      const path = []; const seen = new Set();
      for (let i = 0; i < limit; i++) {
        await page.keyboard.press("Tab");
        const f = await page.evaluate(FOCUSED_JS);
        if (!f.focused) break;
        const fp = (f.selector || f.tag) + "@" + f.box.x + "," + f.box.y;
        if (seen.has(fp)) return { path, stops: path.length, cycled: true };
        seen.add(fp);
        path.push({ i: i + 1, role: f.role, name: f.name, hasName: f.hasName, focusVisible: f.focusVisible, hasFocusIndicator: f.hasFocusIndicator, selector: f.selector, box: f.box });
      }
      return { path, stops: path.length, cycled: false };
    },
    async press(key) {
      if (!key) return { error: "usage: press <Key>" };
      const before = await page.evaluate(DOM_SIG); await page.keyboard.press(key); await page.waitForTimeout(150);
      const after = await page.evaluate(DOM_SIG);
      return { pressed: key, focused: await page.evaluate(FOCUSED_JS), domChanged: before !== after, dialogOpen: await dialogOpen(page) };
    },
    async activate() {
      const target = await page.evaluate(FOCUSED_JS); await page.keyboard.press("Enter"); await page.waitForTimeout(250);
      return { activated: target.selector ?? null, focused: await page.evaluate(FOCUSED_JS), dialogOpen: await dialogOpen(page) };
    },
    async focused() { return page.evaluate(FOCUSED_JS); },
    async query(selector) {
      if (!selector) return { error: "usage: query <selector>" };
      const info = await page.evaluate((s) => {
        const el = document.querySelector(s); if (!el) return null;
        const r = el.getBoundingClientRect();
        const name = (el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || el.innerText || '').trim().slice(0, 200);
        return { role: el.getAttribute('role') || el.tagName.toLowerCase(), name,
          visible: r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden',
          box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } };
      }, selector);
      return info ? { selector, ...info } : { error: `not found: ${selector}` };
    },
    /** All visible links (href + accessible name + unique selector) — for page
     *  discovery (crawl the nav) and link-purpose audits. */
    async links() {
      const list = await page.evaluate(() => {
        const uniq = (n) => {
          if (n.id && document.querySelectorAll('#' + CSS.escape(n.id)).length === 1) return '#' + CSS.escape(n.id);
          const seg = (x) => { let s = x.tagName.toLowerCase(); const p = x.parentElement; if (p) { const same = [...p.children].filter(c => c.tagName === x.tagName); if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(x) + 1) + ')'; } return s; };
          let parts = [], cur = n;
          for (let d = 0; d < 8 && cur && cur.nodeType === 1; d++) { parts.unshift(seg(cur)); const sel = parts.join(' > '); try { if (document.querySelectorAll(sel).length === 1) return sel; } catch {} cur = cur.parentElement; }
          return parts.join(' > ');
        };
        return [...document.querySelectorAll('a[href]')].filter(a => a.offsetParent !== null).slice(0, 250).map(a => ({
          href: a.href, name: (a.getAttribute('aria-label') || a.innerText || a.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 60), selector: uniq(a),
        }));
      });
      return { count: list.length, links: list };
    },
    async reflow(w) {
      const width = Number(w) || 320; await page.setViewportSize({ width, height: 800 }); await page.waitForTimeout(300);
      const m = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      return { reflowWidth: width, ...m, horizontalScroll: m.scrollWidth > m.clientWidth + 2 };
    },
    async zoom(pct) {
      const z = (Number(pct) || 100) / 100; await page.evaluate((z) => { document.documentElement.style.zoom = String(z); }, z); await page.waitForTimeout(200);
      const m = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      return { zoom: pct, ...m, horizontalScroll: m.scrollWidth > m.clientWidth + 2 };
    },
    /** Low-vision discovery: at a narrow viewport (≈ high zoom), list the
     *  components that clip horizontally (scrollWidth > clientWidth) — the
     *  menu/table/form that hides content at 200/400% zoom (1.4.10). */
    async overflow(w) {
      const width = Number(w) || 320;
      await page.setViewportSize({ width, height: 800 }); await page.waitForTimeout(400);
      const list = await page.evaluate(() => {
        const uniq = (n) => {
          if (n.id && document.querySelectorAll('#' + CSS.escape(n.id)).length === 1) return '#' + CSS.escape(n.id);
          const seg = (x) => { let s = x.tagName.toLowerCase(); const p = x.parentElement; if (p) { const same = [...p.children].filter(c => c.tagName === x.tagName); if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(x) + 1) + ')'; } return s; };
          let parts = [], cur = n;
          for (let d = 0; d < 8 && cur && cur.nodeType === 1; d++) { parts.unshift(seg(cur)); const sel = parts.join(' > '); try { if (document.querySelectorAll(sel).length === 1) return sel; } catch {} cur = cur.parentElement; }
          return parts.join(' > ');
        };
        const out = [];
        for (const el of document.querySelectorAll('table, nav, ul, ol, form, section, article, div')) {
          if (el.clientWidth > 60 && el.scrollWidth > el.clientWidth + 6) {
            const r = el.getBoundingClientRect();
            out.push({ tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || null, overflowPx: el.scrollWidth - el.clientWidth, selector: uniq(el), box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } });
          }
        }
        // Keep the worst offenders, drop nested duplicates that share a selector prefix.
        out.sort((a, b) => b.overflowPx - a.overflowPx);
        const kept = []; for (const o of out) { if (!kept.some(k => o.selector.startsWith(k.selector + ' >'))) kept.push(o); if (kept.length >= 10) break; }
        return kept;
      });
      await page.setViewportSize({ width: 1280, height: 900 });
      return { overflowWidth: width, count: list.length, components: list };
    },
    /** Low-vision discovery: scan visible text and list elements whose text
     *  contrast is below WCAG 1.4.3 (4.5:1 normal / 3:1 large ≥24px or ≥18.66px
     *  bold). Foreground = computed color; background = first opaque ancestor
     *  background-color, alpha-composited. Text over a background image/gradient
     *  is SKIPPED (can't compute reliably — confirm those by eye). Verify each
     *  hit with `verify.mjs contrast {selector}`. Optional arg = only return
     *  ratios below it (find the worst). */
    async contrast(below) {
      const list = await page.evaluate((floor) => {
        const uniq = (n) => {
          if (n.id && document.querySelectorAll('#' + CSS.escape(n.id)).length === 1) return '#' + CSS.escape(n.id);
          const seg = (x) => { let s = x.tagName.toLowerCase(); const p = x.parentElement; if (p) { const same = [...p.children].filter(c => c.tagName === x.tagName); if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(x) + 1) + ')'; } return s; };
          let parts = [], cur = n;
          for (let d = 0; d < 8 && cur && cur.nodeType === 1; d++) { parts.unshift(seg(cur)); const sel = parts.join(' > '); try { if (document.querySelectorAll(sel).length === 1) return sel; } catch {} cur = cur.parentElement; }
          return parts.join(' > ');
        };
        const parse = (s) => { const m = (s || '').match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(x => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; };
        const over = (b, t) => { const a = t.a; return { r: t.r * a + b.r * (1 - a), g: t.g * a + b.g * (1 - a), b: t.b * a + b.b * (1 - a), a: 1 }; };
        const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
        const fails = [];
        for (const el of document.querySelectorAll('body *')) {
          const direct = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
          if (!direct) continue;
          const cs = getComputedStyle(el), r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.1) continue;
          const fgRaw = parse(cs.color); if (!fgRaw) continue;
          let layers = [], img = false;
          for (let nn = el; nn; nn = nn.parentElement) { const s = getComputedStyle(nn); if (s.backgroundImage && s.backgroundImage !== 'none') { img = true; break; } const c = parse(s.backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } }
          if (img && !layers.some((l) => l.a >= 1)) continue;
          let bg = { r: 255, g: 255, b: 255, a: 1 }; for (let i = layers.length - 1; i >= 0; i--) bg = over(bg, layers[i]);
          const fg = over(bg, fgRaw), L1 = lum(fg), L2 = lum(bg);
          const ratio = Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100) / 100;
          const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight) || 400;
          const large = size >= 24 || (size >= 18.66 && weight >= 700);
          const threshold = large ? 3 : 4.5;
          if (ratio < threshold && (!floor || ratio < floor)) fails.push({ selector: uniq(el), ratio, threshold, foreground: cs.color, background: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`, fontSizePx: size, largeText: large, sample: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 30), box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } });
        }
        fails.sort((a, b) => a.ratio - b.ratio);
        const kept = []; for (const f of fails) { if (!kept.some((k) => k.selector === f.selector)) kept.push(f); if (kept.length >= 25) break; }
        return kept;
      }, Number(below) || 0);
      return { failing: list.length, worst: list };
    },
    async nav(url) { if (!url) return { error: "usage: nav <url>" }; await page.goto(url, { waitUntil: "load", timeout: 45000 }); await settle(page); return { ok: true, url }; },
    async shot(box, path) {
      if (!box || !path) return { error: "usage: shot <x,y,w,h> <path>" };
      const [x, y, width, height] = box.split(",").map(Number);
      await page.screenshot({ path, clip: { x, y, width: Math.max(1, width), height: Math.max(1, height) } });
      return { ok: true, path, clip: { x, y, width, height } };
    },
  };
}

async function settle(page) { try { await page.waitForLoadState("networkidle", { timeout: 4000 }); } catch {} }

// ---------- start: own the page + serve the verbs ----------
async function start(url) {
  if (!url) die("usage: start <url>");
  const browser = await chromium.launch({ headless: process.env.PROBE_HEADLESS === "1", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "load", timeout: 45000 });
  await settle(page);
  const handlers = makeHandlers(page);

  const shutdown = async () => { try { await browser.close(); } catch {} try { rmSync(STATE); } catch {} process.exit(0); };
  const server = http.createServer(async (req, res) => {
    const cmd = req.url.slice(1);
    let body = ""; for await (const c of req) body += c;
    if (cmd === "stop") { res.end(JSON.stringify({ ok: true })); return shutdown(); }
    const h = handlers[cmd];
    res.setHeader("content-type", "application/json");
    if (!h) { res.writeHead(400); return res.end(JSON.stringify({ error: "unknown command: " + cmd })); }
    try { res.end(JSON.stringify(await h(...(JSON.parse(body || "{}").args || [])))); }
    catch (e) { res.end(JSON.stringify({ error: String(e?.message || e) })); }
  });
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    writeState({ port, url, pid: process.pid });
    out({ ok: true, url, port, pid: process.pid, hint: "session ready — run ax / tab / focused …" });
  });
  process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
}

// ---------- thin clients ----------
function writeState(s) { writeFileSync(STATE, JSON.stringify(s)); }
function readState() { if (!existsSync(STATE)) die("no session — run `start <url>` first."); try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { die("session state unreadable; run `start` again."); } }

async function forward(cmd, args) {
  const { port } = readState();
  let r;
  try { r = await fetch(`http://127.0.0.1:${port}/${cmd}`, { method: "POST", body: JSON.stringify({ args }) }); }
  catch { die("session not reachable — it may have stopped. Run `start` again."); }
  out(await r.json());
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "start") await start(rest[0]);
else if (cmd === "stop") {
  if (!existsSync(STATE)) out({ ok: true, note: "no session" });
  else { try { await fetch(`http://127.0.0.1:${readState().port}/stop`, { method: "POST" }); } catch {} try { rmSync(STATE); } catch {} out({ ok: true, stopped: true }); }
} else if (cmd) await forward(cmd, rest);
else die("usage: start|ax|tab|shtab|press|activate|focused|query|zoom|reflow|nav|shot|stop");
