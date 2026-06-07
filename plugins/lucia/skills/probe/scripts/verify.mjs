#!/usr/bin/env node
/**
 * Probe deterministic verifier — the "harness" half of propose → verify.
 *
 *   node verify.mjs <pageUrl> '<check-json>'
 *
 * Launches a CLEAN headless browser, loads the page fresh, runs ONE
 * deterministic check, and prints { ok, type, evidence, box }.
 *   ok:true        → the failure is real; keep the finding (use `box` for evidence).
 *   ok:false       → not reproduced; DISCARD the finding.
 *   inconclusive   → couldn't settle / resolve; never treat as pass.
 *
 * Check types (see reference/personas-and-briefs.md):
 *   unreachable {selector}
 *   focus-not-visible {selector}
 *   no-accessible-name {selector}
 *   focus-order {selectors:[...]}
 *   escape-noop {openSelector, dialogSelector?}
 *   focus-not-trapped-in {openSelector, dialogSelector?}
 *   keyboard-trap {selector}
 *   reflow-hscroll {width?}
 *   hover-only {triggerSelector, revealSelector}
 */
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL_VERSION = "probe-verify/1.1";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = process.env.PROBE_RUNS_DIR || join(SCRIPT_DIR, "runs");
const LEDGER = join(RUNS_DIR, "ledger.jsonl");
const sha256 = (x) => createHash("sha256").update(x).digest("hex");

// out() DEFERS: the result is stamped into RESULT, then printed once at the end
// (after we capture the evidence screenshot + write the audit bundle), so every
// printed line also carries its runId. emit() prints immediately (pre-launch errors).
let RESULT = null;
const emit = (o) => { process.stdout.write(JSON.stringify(o) + "\n"); };
const out = (o) => { RESULT = o; };
const inconclusive = (why) => out({ ok: false, inconclusive: true, why });

const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith("--"));
const [pageUrl, checkJson] = argv.filter((a) => !a.startsWith("--"));
const NO_BUNDLE = flags.includes("--no-bundle");
if (!pageUrl || !checkJson) { emit({ error: "usage: verify.mjs <pageUrl> '<check-json>' [--no-bundle]" }); process.exit(1); }
let check;
try { check = JSON.parse(checkJson); } catch (e) { emit({ error: "check is not valid JSON: " + e.message }); process.exit(1); }

/** Last entry hash in the append-only ledger (genesis = 64 zeros). */
function lastLedgerHash() {
  try {
    if (!existsSync(LEDGER)) return "0".repeat(64);
    const lines = readFileSync(LEDGER, "utf8").trim().split("\n").filter(Boolean);
    if (!lines.length) return "0".repeat(64);
    return JSON.parse(lines[lines.length - 1]).entryHash || "0".repeat(64);
  } catch { return "0".repeat(64); }
}

/** Write a tamper-evident evidence bundle for one verification run + chain it. */
function writeBundle(result, shotBuf, env) {
  if (NO_BUNDLE) return null;
  try {
    const ts = new Date().toISOString();
    const slug = (result?.type || check.type || "check").replace(/[^a-z0-9-]/gi, "");
    const runId = `${ts.replace(/[:.]/g, "-")}__${slug}__${sha256(pageUrl + JSON.stringify(check)).slice(0, 8)}`;
    const dir = join(RUNS_DIR, runId);
    mkdirSync(dir, { recursive: true });
    let screenshot = null, screenshotSha256 = null;
    if (shotBuf) { screenshot = "evidence.png"; writeFileSync(join(dir, screenshot), shotBuf); screenshotSha256 = sha256(shotBuf); }
    const record = { runId, tool: TOOL_VERSION, timestamp: ts, pageUrl, check, result, env, screenshot, screenshotSha256 };
    const runSha256 = sha256(JSON.stringify(record));
    const prevHash = lastLedgerHash();
    const entryHash = sha256(prevHash + runSha256);
    record.integrity = { runSha256, prevHash, entryHash };
    writeFileSync(join(dir, "run.json"), JSON.stringify(record, null, 2));
    appendFileSync(LEDGER, JSON.stringify({ runId, timestamp: ts, pageUrl, checkType: record.result?.type || check.type, ok: !!record.result?.ok, runSha256, prevHash, entryHash }) + "\n");
    return { runId, dir, entryHash };
  } catch (e) { return { error: "bundle write failed: " + (e?.message || String(e)) }; }
}

const FOCUSED = `(() => { const el=document.activeElement; if(!el||el===document.body) return null;
  const cs=getComputedStyle(el), r=el.getBoundingClientRect();
  const outline=cs.outlineStyle!=='none'&&parseFloat(cs.outlineWidth||'0')>0;
  return { tag:el.tagName.toLowerCase(), id:el.id||null,
    box:{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)},
    indicator: outline || (cs.boxShadow&&cs.boxShadow!=='none') }; })()`;

/** Tab from the top, collecting each stop; mark which match given selectors. Cycle-safe. */
async function tabPath(page, matchSelectors = [], max = 100) {
  await page.evaluate(() => { (document.activeElement || document.body).blur?.(); window.scrollTo(0, 0); });
  const path = []; const seen = new Set();
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate((sels) => {
      const el = document.activeElement; if (!el || el === document.body) return null;
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth || '0') > 0;
      const matched = sels.map((s) => { try { return el.matches(s) || el === document.querySelector(s); } catch { return false; } });
      // fp must be UNIQUE per element: id|class|text together. Using only the
      // first non-empty of these collides two stacked, same-class skip links
      // ("Skip to Content" / "Skip to navigation") → the walk would abort at
      // stop 1 and every element falsely reads as unreachable.
      const fp = el.tagName + '@' + Math.round(r.x) + ',' + Math.round(r.y) + ':' + (el.id || '') + '|' + (el.className || '') + '|' + ((el.textContent || '').trim().slice(0, 25));
      return { fp, tag: el.tagName.toLowerCase(), matched,
        box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
        indicator: outline || (cs.boxShadow && cs.boxShadow !== 'none') };
    }, matchSelectors);
    if (!stop) break;
    if (seen.has(stop.fp)) return { path, cycled: true };
    seen.add(stop.fp); path.push(stop);
  }
  return { path, cycled: false };
}

const exists = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s); if (!el) return null;
  const r = el.getBoundingClientRect();
  return { visible: r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none',
    box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } };
}, sel);

async function run(page) {
  const t = check.type;
  if (t === "unreachable") {
    const here = await exists(page, check.selector);
    if (!here) return inconclusive("target selector not found");
    if (!here.visible) return inconclusive("target not visible (can't claim a sighted user sees it)");
    const { path } = await tabPath(page, [check.selector]);
    const reached = path.some((s) => s.matched[0]);
    return out({ ok: !reached, type: t, evidence: { tabStops: path.length, reached }, box: here.box });
  }
  if (t === "focus-not-visible") {
    const { path } = await tabPath(page, [check.selector]);
    const stop = path.find((s) => s.matched[0]);
    if (stop) return out({ ok: stop.indicator === false, type: t, evidence: { via: "tab", hasFocusIndicator: stop.indicator }, box: stop.box });
    // Not reached by a clean tab-walk (e.g. it lives on a rotating carousel
    // slide). Fall back: focus it directly and diff focused-vs-blurred computed
    // style — if focusing changes nothing visual, there is no focus indicator.
    const here = await exists(page, check.selector);
    if (!here) return inconclusive("element never reached and selector not found");
    const diff = await page.evaluate((s) => {
      const el = document.querySelector(s); if (!el) return null;
      const snap = () => { const c = getComputedStyle(el); return [c.outlineStyle, c.outlineWidth, c.outlineColor, c.boxShadow, c.borderColor, c.backgroundColor, c.textDecorationLine].join("|"); };
      el.blur(); const off = snap(); el.focus(); const on = snap();
      let fv = null; try { fv = el.matches(":focus-visible"); } catch {}
      return { changed: on !== off, focusVisible: fv };
    }, check.selector);
    if (!diff) return inconclusive("selector vanished");
    return out({ ok: diff.changed === false, type: t, evidence: { via: "direct-focus", styleChangedOnFocus: diff.changed, focusVisible: diff.focusVisible }, box: here.box });
  }
  if (t === "no-accessible-name") {
    const info = await page.evaluate((s) => {
      const el = document.querySelector(s); if (!el) return null;
      const operable = el.matches('a[href],button,input,select,textarea,[tabindex],[role=button],[role=link],[role=menuitem],[role=tab],[role=checkbox]');
      const name = (el.getAttribute('aria-label')
        || (el.getAttribute('aria-labelledby') && [...document.querySelectorAll('#' + (el.getAttribute('aria-labelledby').split(' ').map(CSS.escape).join(',#')))].map(n => n.innerText).join(' '))
        || el.getAttribute('alt') || (el.labels && el.labels[0] && el.labels[0].innerText)
        || el.getAttribute('title') || el.value || el.innerText || '').trim();
      const r = el.getBoundingClientRect();
      return { operable, name, box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } };
    }, check.selector);
    if (!info) return inconclusive("selector not found");
    if (!info.operable) return inconclusive("element is not an operable control");
    return out({ ok: info.name === "", type: t, evidence: { accessibleName: info.name }, box: info.box });
  }
  if (t === "focus-order") {
    // WCAG 2.4.3: focus (tab) order must preserve meaning — assessed against the
    // VISUAL reading order (top-to-bottom, left-to-right), not the DOM order. A
    // control that sits visually first but tabs second (e.g. a search input shown
    // left of its button but tabbed after it) is the failure.
    const sels = check.selectors || [];
    if (sels.length < 2) return inconclusive("need >=2 selectors");
    const { path } = await tabPath(page, sels);
    const tabOrder = []; path.forEach((s) => s.matched.forEach((m, i) => { if (m && !tabOrder.includes(i)) tabOrder.push(i); }));
    const geom = await page.evaluate((ss) => {
      const els = ss.map((s) => document.querySelector(s));
      const present = ss.map((_, i) => i).filter((i) => els[i]);
      const vis = [...present].sort((a, b) => { const ra = els[a].getBoundingClientRect(), rb = els[b].getBoundingClientRect(); return Math.abs(ra.top - rb.top) > 8 ? ra.top - rb.top : ra.left - rb.left; });
      const dom = [...present].sort((a, b) => (els[a].compareDocumentPosition(els[b]) & 2 ? 1 : -1));
      return { visualOrder: vis, domOrder: dom };
    }, sels);
    if (tabOrder.length < sels.length) return inconclusive("not all selectors reached by Tab");
    return out({ ok: JSON.stringify(tabOrder) !== JSON.stringify(geom.visualOrder), type: t, evidence: { tabOrder, visualOrder: geom.visualOrder, domOrder: geom.domOrder } });
  }
  if (t === "escape-noop" || t === "focus-not-trapped-in") {
    const opener = await exists(page, check.openSelector);
    if (!opener) return inconclusive("openSelector not found");
    await page.focus(check.openSelector).catch(() => {});
    await page.keyboard.press("Enter"); await page.waitForTimeout(350);
    const dialogSel = check.dialogSelector || '[role=dialog],dialog[open],[aria-modal=true],.modal';
    const open1 = await exists(page, dialogSel);
    if (!open1 || !open1.visible) return inconclusive("no dialog opened on activating openSelector");
    if (t === "focus-not-trapped-in") {
      const inside = await page.evaluate((ds) => { const d = document.querySelector(ds); return !!(d && d.contains(document.activeElement)); }, dialogSel);
      return out({ ok: inside === false, type: t, evidence: { focusEnteredDialog: inside }, box: open1.box });
    }
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    const open2 = await exists(page, dialogSel);
    return out({ ok: !!(open2 && open2.visible), type: t, evidence: { dialogStillOpenAfterEscape: !!(open2 && open2.visible) }, box: open1.box });
  }
  if (t === "keyboard-trap") {
    const here = await exists(page, check.selector);
    if (!here) return inconclusive("selector not found");
    await page.focus(check.selector).catch(() => {});
    let trapped = true;
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      const stillInside = await page.evaluate((s) => { const t = document.querySelector(s); const a = document.activeElement; return !!(t && (t === a || t.contains(a))); }, check.selector);
      if (!stillInside) { trapped = false; break; }
    }
    return out({ ok: trapped, type: t, evidence: { escapedWithin25Tabs: !trapped }, box: here.box });
  }
  if (t === "reflow-hscroll") {
    await page.setViewportSize({ width: Number(check.width) || 320, height: 800 });
    await page.waitForTimeout(400);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    return out({ ok: m.sw > m.cw + 2, type: t, evidence: { scrollWidth: m.sw, clientWidth: m.cw } });
  }
  if (t === "hover-only") {
    // 1.4.13 / 2.1.1: content revealed on HOVER but not on keyboard FOCUS. "Visible"
    // is decided by HIT-TESTING (elementFromPoint), not just opacity/display — so it
    // correctly catches content hidden by a 3D flip (rotateY/backface-visibility),
    // occlusion, or z-index, which a style-only check reads as "visible".
    const actuallyVisible = (s) => page.evaluate((sel) => {
      const el = document.querySelector(sel); if (!el) return null;
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) < 0.1) return false;
      const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + r.width * 0.3, r.top + r.height * 0.3], [r.left + r.width * 0.7, r.top + r.height * 0.7]];
      for (const [x, y] of pts) { if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue; const hit = document.elementFromPoint(x, y); if (hit && (hit === el || el.contains(hit) || hit.contains(el))) return true; }
      return false;
    }, s);
    const trig = check.triggerSelector, reveal = check.revealSelector;
    const focusSel = check.focusSelector || trig; // keyboard target may differ from the hover target
    if (!(await exists(page, reveal))) return inconclusive("revealSelector not found");
    await page.mouse.move(0, 0); await page.evaluate(() => document.activeElement?.blur?.()); await page.waitForTimeout(150);
    const atRest = await actuallyVisible(reveal);
    await page.focus(focusSel).catch(() => {}); await page.waitForTimeout(200);
    const onFocus = await actuallyVisible(reveal);
    await page.evaluate(() => document.activeElement?.blur?.()); await page.hover(trig).catch(() => {}); await page.waitForTimeout(300);
    const onHover = await actuallyVisible(reveal);
    const box = await exists(page, reveal);
    return out({ ok: onHover === true && onFocus === false && atRest === false, type: t, evidence: { atRest, visibleOnFocus: onFocus, visibleOnHover: onHover }, box: box?.box });
  }
  if (t === "skip-link") {
    // Find the skip link (provided selector, else focus the first focusable —
    // skip links come first), confirm it's an in-page anchor, activate it, and
    // assert focus actually moved into the target / main (2.4.1).
    await page.evaluate(() => window.scrollTo(0, 0));
    if (check.selector) await page.focus(check.selector).catch(() => {});
    else await page.keyboard.press("Tab");
    const link = await page.evaluate(() => { const el = document.activeElement; return el && el.tagName === "A" ? { href: el.getAttribute("href"), text: (el.innerText || "").trim().slice(0, 60) } : null; });
    if (!link || !link.href || !link.href.startsWith("#")) {
      // No skip link on the first focusable element. 2.4.1 can still be met via
      // landmarks — so only flag ABSENCE when there's also no <main> landmark to
      // jump to and a sizable nav block worth bypassing.
      const s = await page.evaluate(() => ({
        anySkip: [...document.querySelectorAll("a[href^='#']")].some((a) => /skip|jump to|main content/i.test((a.textContent || "") + " " + (a.getAttribute("href") || ""))),
        hasMain: !!document.querySelector("main,[role=main]"),
        navLinks: Math.max(0, ...[...document.querySelectorAll("nav,[role=navigation],ul,#nav,.nav,.menu")].map((n) => n.querySelectorAll("a").length)),
      }));
      if (s.anySkip) return inconclusive("a skip link exists but isn't the first focusable element");
      if (!s.hasMain && s.navLinks >= 5) return out({ ok: true, type: t, evidence: { skipLink: null, reason: `no skip link and no main landmark to bypass ${s.navLinks} nav links`, ...s } });
      return inconclusive("no in-page skip link focused (page may rely on landmarks)");
    }
    await page.keyboard.press("Enter"); await page.waitForTimeout(300);
    const moved = await page.evaluate((href) => {
      const target = (href && href !== "#" && document.querySelector(href)) || document.querySelector("main,[role=main],#main,#content,#maincontent");
      const a = document.activeElement;
      return { targetExists: !!target, focusMovedIntoTarget: !!(target && (target === a || target.contains(a))), activeTag: a ? a.tagName.toLowerCase() : null };
    }, link.href);
    return out({ ok: moved.focusMovedIntoTarget === false, type: t, evidence: { skipLink: link, ...moved } });
  }
  if (t === "component-overflow") {
    await page.setViewportSize({ width: Number(check.width) || 320, height: 800 });
    await page.waitForTimeout(400);
    const m = await page.evaluate((s) => {
      const el = document.querySelector(s); if (!el) return null;
      const r = el.getBoundingClientRect();
      return { sw: el.scrollWidth, cw: el.clientWidth, beyond: Math.round(r.right) > document.documentElement.clientWidth + 2,
        box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } };
    }, check.selector);
    if (!m) return inconclusive("selector not found");
    return out({ ok: m.sw > m.cw + 2 || m.beyond, type: t, evidence: { scrollWidth: m.sw, clientWidth: m.cw, beyondViewport: m.beyond, width: Number(check.width) || 320 }, box: m.box });
  }
  if (t === "overlap") {
    // Two elements visually overlap when they shouldn't (1.4.12 / clipped UI).
    const r = await page.evaluate(([sa, sb]) => {
      const a = document.querySelector(sa), b = document.querySelector(sb);
      if (!a || !b) return { missing: true };
      if (a.contains(b) || b.contains(a)) return { nested: true };
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const ix = Math.max(0, Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left));
      const iy = Math.max(0, Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top));
      const vis = (el) => { const c = getComputedStyle(el), rr = el.getBoundingClientRect(); return rr.width > 0 && rr.height > 0 && c.visibility !== "hidden" && c.display !== "none" && c.opacity !== "0"; };
      return { overlapArea: Math.round(ix * iy), aVisible: vis(a), bVisible: vis(b), aBox: { x: Math.round(ra.x), y: Math.round(ra.y), width: Math.round(ra.width), height: Math.round(ra.height) } };
    }, [check.selectorA, check.selectorB]);
    if (r.missing) return inconclusive("selector(s) not found");
    if (r.nested) return inconclusive("one element contains the other — not an overlap");
    return out({ ok: r.overlapArea > 4 && r.aVisible && r.bVisible, type: t, evidence: { overlapArea: r.overlapArea, aVisible: r.aVisible, bVisible: r.bVisible }, box: r.aBox });
  }
  if (t === "text-spacing") {
    // WCAG 1.4.12: with the user's standard text-spacing overrides applied, no
    // content is clipped or lost (failure F104). Inject the spacing minimums on
    // the target + descendants, then assert the element CLIPS its now-taller/
    // wider content — scroll size exceeds the box AND overflow is hidden/clip
    // (genuine content loss; a scrollable container is NOT a failure).
    if (check.width) { await page.setViewportSize({ width: Number(check.width), height: 900 }); await page.waitForTimeout(300); }
    const sel = check.selector;
    const before = await page.evaluate((s) => {
      const el = document.querySelector(s); if (!el) return null;
      return { sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth };
    }, sel);
    if (!before) return inconclusive("selector not found");
    await page.evaluate((s) => {
      const css = `${s}, ${s} * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }`
        + ` ${s} p, ${s} li { margin-bottom: 2em !important; }`;
      const st = document.createElement("style"); st.id = "__probe_ts"; st.textContent = css; document.head.appendChild(st);
    }, sel);
    await page.waitForTimeout(300);
    const after = await page.evaluate((s) => {
      const el = document.querySelector(s); if (!el) return null;
      const c = getComputedStyle(el), r = el.getBoundingClientRect();
      const clipsY = c.overflowY === "hidden" || c.overflowY === "clip";
      const clipsX = c.overflowX === "hidden" || c.overflowX === "clip";
      return { sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth, clipsY, clipsX,
        box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } };
    }, sel);
    if (!after) return inconclusive("selector vanished after injection");
    const lostV = after.sh > after.ch + 4 && after.clipsY;
    const lostH = after.sw > after.cw + 4 && after.clipsX;
    return out({ ok: lostV || lostH, type: t, evidence: { before: { sh: before.sh, ch: before.ch }, after: { sh: after.sh, ch: after.ch, clipsY: after.clipsY, clipsX: after.clipsX }, contentClipped: lostV || lostH }, box: after.box });
  }
  if (t === "carousel-autoplay-no-pause") {
    // WCAG 2.2.2: auto-updating content needs a pause/stop/hide control.
    // Confirm (a) the carousel actually rotates and (b) no user-operable
    // pause/stop/play control exists within it.
    // The frontmost slide = the visible one with the highest z-index (Slider
    // Revolution stacks all slides; slide 0 stays opacity>0 underneath, so a naive
    // "first visible" always reads slide 0 and never sees rotation).
    const frontSlideText = (s) => page.evaluate((cs) => {
      const root = document.querySelector(cs); if (!root) return null;
      const slides = [...root.querySelectorAll('rs-slide, .rs-slide, [id*="-slide-"]')];
      let best = null, bestZ = -1e9;
      for (const el of slides) { const c = getComputedStyle(el), r = el.getBoundingClientRect(); if (r.width > 4 && r.height > 4 && c.visibility !== "hidden" && c.display !== "none" && parseFloat(c.opacity) > 0.1) { const z = parseInt(c.zIndex) || 0; if (z >= bestZ) { bestZ = z; best = el; } } }
      return best ? (best.innerText || "").trim().slice(0, 80) : (slides[0] ? (slides[0].innerText || "").trim().slice(0, 80) : "");
    }, s);
    await page.evaluate((cs) => document.querySelector(cs)?.scrollIntoView({ block: "center" }), check.selector);
    await page.waitForTimeout(600);
    const before = await frontSlideText(check.selector);
    if (before === null) return inconclusive("carousel/slides not found");
    await page.waitForTimeout(Number(check.waitMs) || 12000);
    const after = await frontSlideText(check.selector);
    const autoRotates = !!before && !!after && before !== after;
    const pauseControlFound = await page.evaluate((cs) => {
      const root = document.querySelector(cs); if (!root) return false;
      return [...root.querySelectorAll("button,[role=button],a,[tabindex],input")].some((el) => {
        const name = ((el.getAttribute("aria-label") || "") + " " + (el.innerText || "") + " " + (el.title || "") + " " + (el.value || "")).toLowerCase();
        return /\b(pause|stop|play)\b/.test(name);
      });
    }, check.selector);
    const box = await exists(page, check.selector);
    return out({ ok: autoRotates && !pauseControlFound, type: t, evidence: { autoRotates, slideBefore: before, slideAfter: after, pauseControlFound }, box: box?.box });
  }
  if (t === "slides-all-exposed") {
    // WCAG 1.3.2: inactive carousel slides are still exposed to the screen
    // reader (not aria-hidden / display:none / visibility:hidden), so the SR
    // announces every slide at once. selector = the slide elements.
    const r = await page.evaluate((cs) => {
      const slides = [...document.querySelectorAll(cs)];
      if (!slides.length) return null;
      const hidden = (el) => { for (let n = el; n; n = n.parentElement) { if (n.getAttribute && n.getAttribute("aria-hidden") === "true") return true; const c = getComputedStyle(n); if (c.display === "none" || c.visibility === "hidden") return true; } return false; };
      let exposed = 0, withText = 0;
      for (const s of slides) { const txt = (s.innerText || "").trim(); if (txt) { withText++; if (!hidden(s)) exposed++; } }
      return { total: slides.length, withText, exposed };
    }, check.selector);
    if (!r) return inconclusive("no slides matched the selector");
    const box = await exists(page, check.containerSelector || check.selector);
    return out({ ok: r.exposed > 1, type: t, evidence: r, box: box?.box });
  }
  if (t === "offscreen-focusable") {
    // WCAG 2.4.3: off-screen / non-current carousel slides keep focusable links
    // in the tab order — you tab into slides that aren't visible. selector = the
    // slide elements (each focused control is tested for living in a hidden one).
    await page.evaluate(() => { (document.activeElement || document.body).blur?.(); window.scrollTo(0, 0); });
    let offscreen = 0, total = 0, example = null; const seen = new Set();
    for (let i = 0; i < 90; i++) {
      await page.keyboard.press("Tab");
      const r = await page.evaluate((slideSel) => {
        const el = document.activeElement; if (!el || el === document.body) return null;
        const rr = el.getBoundingClientRect();
        const fp = el.tagName + "@" + Math.round(rr.x) + "," + Math.round(rr.y) + (el.id || el.textContent?.slice(0, 12) || "");
        const slide = el.closest(slideSel);
        let inHiddenSlide = false;
        if (slide) { const sr = slide.getBoundingClientRect(), c = getComputedStyle(slide); inHiddenSlide = parseFloat(c.opacity) < 0.1 || c.visibility === "hidden" || sr.right <= 0 || sr.left >= innerWidth || sr.bottom <= 0 || sr.top >= innerHeight; }
        return { fp, inHiddenSlide, name: (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 40) };
      }, check.selector);
      if (!r) break;
      if (seen.has(r.fp)) break;
      seen.add(r.fp); total++;
      if (r.inHiddenSlide) { offscreen++; if (!example) example = r.name || r.fp; }
    }
    return out({ ok: offscreen > 0, type: t, evidence: { tabStops: total, offscreenFocusable: offscreen, example } });
  }
  if (t === "contrast") {
    // WCAG 1.4.3: text contrast ≥ 4.5:1 (normal) / 3:1 (large ≥24px, or ≥18.66px
    // bold). Foreground = computed color; background = first opaque ancestor
    // background-color (alpha-composited over white). Text over a background
    // IMAGE / gradient → inconclusive (not computable from styles — a manual check).
    const r = await page.evaluate((sel) => {
      const el = document.querySelector(sel); if (!el) return { missing: true };
      const cs = getComputedStyle(el), rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1 || cs.visibility === "hidden" || cs.display === "none") return { invisible: true };
      if (!(el.innerText || el.textContent || "").trim()) return { noText: true };
      const parse = (s) => { const m = (s || "").match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(",").map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; };
      const over = (b, t) => { const a = t.a; return { r: t.r * a + b.r * (1 - a), g: t.g * a + b.g * (1 - a), b: t.b * a + b.b * (1 - a), a: 1 }; };
      const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
      const fgRaw = parse(cs.color); if (!fgRaw) return { noColor: true };
      let layers = [], bgImage = null;
      for (let n = el; n; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.backgroundImage && s.backgroundImage !== "none") { bgImage = s.backgroundImage.slice(0, 60); break; }
        const c = parse(s.backgroundColor);
        if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
      }
      if (bgImage && !layers.some((l) => l.a >= 1)) return { bgImage };
      let bg = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = layers.length - 1; i >= 0; i--) bg = over(bg, layers[i]);
      const fg = over(bg, fgRaw), L1 = lum(fg), L2 = lum(bg);
      const ratio = Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100) / 100;
      const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      return { ratio, threshold: large ? 3 : 4.5, foreground: cs.color, background: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`, fontSizePx: size, weight, largeText: large, sample: (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 40), box: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } };
    }, check.selector);
    if (r.missing) return inconclusive("selector not found");
    if (r.invisible) return inconclusive("element not visible");
    if (r.noText) return inconclusive("element has no text to evaluate");
    if (r.noColor) return inconclusive("could not parse the computed text color");
    if (r.bgImage) return inconclusive("text sits over a background image/gradient — contrast not computable from styles (manual check): " + r.bgImage);
    return out({ ok: r.ratio < r.threshold, type: t, evidence: { ratio: r.ratio, threshold: r.threshold, foreground: r.foreground, background: r.background, fontSizePx: r.fontSizePx, weight: r.weight, largeText: r.largeText, sample: r.sample }, box: r.box });
  }
  if (t === "ambiguous-link-text") {
    // WCAG 2.4.4 Link Purpose: the link's accessible name is a generic, non-
    // descriptive phrase ("click here", "read more", "more"…) OR the same name is
    // reused by other links pointing to DIFFERENT destinations — so its purpose
    // isn't clear out of context.
    const r = await page.evaluate((sel) => {
      const el = document.querySelector(sel); if (!el) return { missing: true };
      if (!el.matches("a[href],[role=link]")) return { notLink: true };
      const nm = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "").trim().toLowerCase().replace(/\s+/g, " ");
      // Clearly non-descriptive out of context. Deliberately omits "continue",
      // "view", "download", "go" — those are legitimate in a form/flow context, so
      // flagging them would be a false positive.
      const generic = ["click here", "click", "here", "read more", "more", "learn more", "link", "this", "this link", "details", "more info", "more information"];
      const isGeneric = generic.includes(nm);
      const dupes = [...document.querySelectorAll("a[href]")].filter((a) => ((a.getAttribute("aria-label") || a.innerText || "").trim().toLowerCase().replace(/\s+/g, " ") === nm) && a.href !== el.href).length;
      const r = el.getBoundingClientRect();
      return { nm, isGeneric, dupes, box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } };
    }, check.selector);
    if (r.missing) return inconclusive("selector not found");
    if (r.notLink) return inconclusive("element is not a link");
    if (!r.nm) return inconclusive("link has no accessible name (use no-accessible-name instead)");
    return out({ ok: r.isGeneric || r.dupes > 0, type: t, evidence: { linkText: r.nm, generic: r.isGeneric, duplicatesWithDifferentHref: r.dupes }, box: r.box });
  }
  if (t === "focus-removed") {
    // WCAG 2.4.7 / 3.2.1: focusing the element runs script that removes focus
    // (e.g. onfocus="blur()") — focus can never be seen or retained on it.
    const r = await page.evaluate((sel) => {
      const el = document.querySelector(sel); if (!el) return { missing: true };
      if (!el.matches("a[href],button,input,select,textarea,[tabindex]")) return { notFocusable: true };
      el.focus();
      return { held: document.activeElement === el, active: document.activeElement ? document.activeElement.tagName.toLowerCase() : null };
    }, check.selector);
    if (r.missing) return inconclusive("selector not found");
    if (r.notFocusable) return inconclusive("element is not natively focusable");
    const box = await exists(page, check.selector);
    return out({ ok: r.held === false, type: t, evidence: { focusHeld: r.held, activeAfterFocus: r.active }, box: box?.box });
  }
  if (t === "pointer-only") {
    // WCAG 2.1.1: functionality bound to inline pointer-only events
    // (onmouseover/onmousedown/onclick) on an element that is NOT keyboard
    // focusable and has no keyboard handler — a keyboard user can't trigger it.
    // (Detects INLINE handlers; addEventListener-attached ones aren't visible.)
    const r = await page.evaluate((sel) => {
      const el = document.querySelector(sel); if (!el) return { missing: true };
      const pointer = ["onmouseover", "onmousedown", "onmouseup", "onclick", "onmouseout"].filter((a) => el.getAttribute(a));
      const keyEquiv = ["onkeydown", "onkeypress", "onkeyup"].some((a) => el.getAttribute(a));
      const focusable = el.matches("a[href],button,input,select,textarea,[tabindex],[role=button],[role=link],[role=menuitem]");
      return { pointer, keyEquiv, focusable };
    }, check.selector);
    if (r.missing) return inconclusive("selector not found");
    if (!r.pointer.length) return inconclusive("no inline pointer handler on the element");
    const box = await exists(page, check.selector);
    return out({ ok: r.pointer.length > 0 && !r.keyEquiv && !r.focusable, type: t, evidence: { pointerHandlers: r.pointer, hasKeyboardEquivalent: r.keyEquiv, focusable: r.focusable }, box: box?.box });
  }
  if (t === "no-label") {
    // WCAG 3.3.2: a form control with no associated label / aria-label / title.
    // Unlike no-accessible-name this does NOT fall back to value/option text — a
    // select's option text is not a label.
    const r = await page.evaluate((sel) => {
      const el = document.querySelector(sel); if (!el) return { missing: true };
      if (!el.matches("input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]),select,textarea")) return { notControl: true };
      const lbBy = el.getAttribute("aria-labelledby");
      const name = (el.getAttribute("aria-label")
        || (lbBy && lbBy.split(" ").map((id) => document.getElementById(id)).filter(Boolean).map((n) => n.innerText).join(" "))
        || (el.labels && el.labels.length && [...el.labels].map((l) => l.innerText).join(" "))
        || (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')?.innerText)
        || el.getAttribute("title") || "").trim();
      return { name };
    }, check.selector);
    if (r.missing) return inconclusive("selector not found");
    if (r.notControl) return inconclusive("not a labelable form control");
    const box = await exists(page, check.selector);
    return out({ ok: r.name === "", type: t, evidence: { accessibleLabel: r.name }, box: box?.box });
  }
  if (t === "select-navigates") {
    // WCAG 3.2.2 (On Input): changing a <select> value causes a change of context
    // (navigation / submit) without the user activating a separate control. Pick a
    // different option, fire the change, and detect a navigation — a jump-menu that
    // moves you the instant the value changes is the failure.
    const sel = check.selector || "select";
    const el = await page.$(sel);
    if (!el) return inconclusive("no <select> matched " + sel);
    const before = page.url();
    const alt = await el.evaluate((s) => { const cur = s.value; const o = [...s.options].find((o) => o.value && o.value !== cur && !o.disabled); return o ? o.value : null; });
    if (alt == null) return inconclusive("select has no alternate selectable option");
    let navigated = false;
    const onNav = () => { navigated = true; };
    page.on("framenavigated", onNav);
    try { await el.selectOption(alt, { timeout: 3000 }); } catch {}
    await page.waitForTimeout(900);
    page.off("framenavigated", onNav);
    const after = page.url();
    navigated = navigated || after !== before;
    return out({ ok: navigated, type: t, evidence: { navigatedOnChange: navigated, fromUrl: before, toUrl: after, optionChosen: alt } });
  }
  if (t === "abbr-present") {
    // WCAG 3.1.4 (Abbreviations): an abbreviation/acronym is used in the page
    // text but never expanded via <abbr title> (no mechanism to find the
    // expansion). ok:true = used-but-unexpanded (issue present live);
    // ok:false = at least one <abbr title> wraps it (a mechanism now exists).
    // Whole-word, case-sensitive — "AU" must not match "because" / "nautical".
    const abbr = check.abbr || check.value;
    if (!abbr) return inconclusive("abbr-present needs { abbr }");
    const r = await page.evaluate((ab) => {
      const esc = ab.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp("(^|[^A-Za-z0-9])" + esc + "(?=[^A-Za-z0-9]|$)");
      const marked = [...document.querySelectorAll("abbr[title]")].filter(
        (a) => (a.textContent || "").trim() === ab && (a.getAttribute("title") || "").trim() !== ""
      );
      let usedPlain = false, sampleText = "";
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      let n;
      while ((n = walk.nextNode())) {
        const v = n.nodeValue || "";
        if (v.indexOf(ab) === -1 || !re.test(v)) continue;
        let pe = n.parentNode, skip = false;
        while (pe && pe !== document.body) {
          const tn = pe.nodeName;
          if (tn === "ABBR" || tn === "SCRIPT" || tn === "STYLE" || tn === "TEXTAREA") { skip = true; break; }
          pe = pe.parentNode;
        }
        if (!skip) { usedPlain = true; sampleText = v.trim().slice(0, 80); break; }
      }
      return { markedCount: marked.length, usedPlain, sampleText, expansion: marked[0]?.getAttribute("title") || null };
    }, abbr);
    if (r.markedCount > 0) return out({ ok: false, type: t, evidence: { abbr, expandedWith: "abbr[title]", expansion: r.expansion, markedCount: r.markedCount } });
    if (!r.usedPlain) return inconclusive(`abbreviation "${abbr}" not found as a whole word on the page`);
    return out({ ok: true, type: t, evidence: { abbr, usedButUnexpanded: true, sample: r.sampleText } });
  }
  return out({ error: "unknown check type: " + t });
}

const viewport = { width: 1280, height: 900 };
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
let shotBuf = null;
const env = { engine: "chromium", headless: true, viewport, platform: process.platform, node: process.version };
try {
  try { env.chromiumVersion = browser.version(); } catch {}
  const page = await browser.newPage({ viewport });
  await page.goto(pageUrl, { waitUntil: "load", timeout: 45000 });
  try { await page.waitForLoadState("networkidle", { timeout: 4000 }); } catch {}
  await run(page);
  // Capture the page state at verification time as evidence (full page; the
  // recorded box localises the region). Best-effort — never fail the run on it.
  try { shotBuf = await page.screenshot({ fullPage: true }); }
  catch { try { shotBuf = await page.screenshot(); } catch {} }
} catch (e) {
  inconclusive("verify error: " + (e?.message || String(e)));
} finally {
  await browser.close();
}
const bundle = writeBundle(RESULT, shotBuf, env);
emit({ ...(RESULT || { error: "no result" }), runId: bundle?.runId || null, bundle: bundle?.dir || null });
