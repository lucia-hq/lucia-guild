---
name: probe
description: >-
  Autonomously test a website for accessibility the way a real assistive-
  technology user would — drive a live browser as a screen-reader, keyboard-
  only, and low-vision user; discover the interaction- and state-dependent
  WCAG failures axe-core can't see (keyboard traps, focus order, operated-
  widget name/role/value, modal focus, reflow/zoom, content-on-hover); VERIFY
  every issue deterministically before reporting it; and propose live edge
  fixes. Independent — needs only a Lucia siteId (and optionally specific
  URLs), no human findings doc. Use when an operator asks Lucia to audit /
  test / "act like a blind user on" a site, or to find accessibility issues a
  scanner would miss. For importing a HUMAN reviewer's report instead, use the
  expert-review skill.
---

# Probe — agentic AT-user accessibility tester

You are the tester. From a URL you drive a real browser as a screen-reader,
keyboard-only, and low-vision user, find the interaction-/state-dependent WCAG
failures (~43% of WCAG that automation can't reach), **prove each one**, and
propose fixes. You produce the **same plan JSON** the expert-review skill
submits — so discovery flows straight into live remediation.

**Two phases, in order — never skip Phase 0.** A site already carries a pile of
issues the automated scan (axe + Sentinel) found, many auto-remediable but not
yet patched. **(0) Clear the automated layer first** — fix everything the
automated scan already found that's auto-remediable; it's cheap, high-volume,
and exactly what the product promises ("we fix it"). **(1+) Then run the deep
interaction scan** for the state-dependent failures scanners can't reach. Doing
the expensive interaction work while the cheap automated backlog sits unfixed is
backwards.

Read `reference/personas-and-briefs.md` for the per-persona task briefs + check types.

## The one rule: propose → verify

A finding you "notice" is a **claim**, not a finding. Every claim must be
confirmed by `scripts/verify.mjs` (a deterministic CDP replay) before it goes in
the plan. **No machine confirmation → discard it.** This is what makes Probe
non-hallucinatory and legally defensible. Findings carry the `check`, the
`reproSteps`, and an evidence screenshot box.

## Inputs

1. A Lucia **siteId** (e.g. `demo-abc12345`). Ask if not given.
2. Optional: specific page URL(s). Default — audit the site's **scanned pages**
   (`node ../../expert-review/scripts/submit.mjs --get-site --site <siteId>` lists
   them; findings attach to a scanned page).
3. Admin access — submission reuses expert-review's browser auth (see "Submit").

## Setup (once)

```
cd .claude/skills/probe/scripts && npm install   # installs Playwright
npx playwright install chromium                  # browser binary (first run only)
```

Smoke-test the harness before auditing: `node agent-browser.mjs start https://example.com`
then `node agent-browser.mjs ax` should print an accessibility tree. `node agent-browser.mjs stop` when done.

## Procedure

### 0. Clear the automated layer first (always — before any interaction work)
Sweep what the automated scan already found and fix everything auto-remediable:

```
node backlog.mjs <siteId>
```

It reads every scanned page's stored automated findings and splits them:
**remediated** · **queued to fix** (auto-remediable, not yet patched) · **needs
human input** (the genuine residual — captions, content/intent; never
auto-"fixed") · **interaction** (deferred to Phase 1). It writes
`backlog-plan.json` listing the queued findings with empty `stitches[]`.

Author the fix for each queued finding (see
`../../expert-review/reference/stitch-ops.md`): `auto`-bucket rules are
deterministic attribute/style transforms (lang, viewport, table headers,
skip-link, redundant role, region/landmark…); `caveat` rules use a signal
(alt → vision, label → nearby DOM, contrast → the `contrast` verb). Then
**preflight + submit** exactly as in steps 6–7, and re-run `backlog.mjs` until
**queued = 0**. The automated layer is now fully remediated; only the
human-input residual remains. *Then* start the interaction scan below.

> Nothing should sit "open" that automation can fix. The only honest residual is
> the `needs human input` bucket (captions, a content/intent call) — and on most
> sites that's empty.

### 1. Plan the session
List the site's pages. Pick the **home page + top-N templated pages** (don't
audit every URL — cost). For each page you'll run a set of **persona × theme
briefs** from `reference/personas-and-briefs.md`. Start narrow (the MVP brief:
*blind SR · keyboard operability + focus + trap + modal*) unless asked for the
full sweep.

### 2. Drive the browser, one brief at a time
`node agent-browser.mjs start <pageUrl>` (headed — the operator can watch), then
work the brief with the AT-user verbs (one command per step; each prints JSON):

| verb | what |
|---|---|
| `ax [selector]` | pruned accessibility tree — **this is the screen-reader's view; reason from it, not pixels** |
| `tab` / `shtab` | move focus; returns the newly focused node + computed focus-visible |
| `press <key>` | `Enter`/`Space`/`Escape`/`ArrowDown`… + a DOM-change signal |
| `activate` | operate the focused control; returns focus + any opened dialog |
| `focused` | role/name/value/box/focus-visible of the active element |
| `query <sel>` | AX node + box for a selector |
| `zoom <pct>` / `reflow <w>` | low-vision: 200/400% zoom, 320px reflow → scroll signals |
| `overflow <w>` / `contrast [below]` | low-vision discovery: components that clip at width `w` (1.4.10); text below the WCAG contrast ratio (1.4.3), worst first |
| `shot <x,y,w,h> <path>` | evidence screenshot of a region |

Work as the persona: a **blind** user can only perceive what `ax`/`focused`
return; a **keyboard** user only what `tab`/`press`/`activate` reach; a
**low-vision** user judges `zoom`/`reflow`/contrast. If a control can be seen but
never reached, or operated but has no accessible name, or a modal opens but focus
never enters / ESC doesn't close — that's a candidate finding.

### 3. For each candidate, PROPOSE → VERIFY
Write a candidate as `{ pageUrl, wcagSc, wcagName, subject, severity, selector,
check, reproSteps, explanation }`. The `check` is a deterministic assertion
(`reference/personas-and-briefs.md` lists the types: `unreachable`,
`escape-noop`, `focus-not-visible`, `no-accessible-name`, `reflow-hscroll`,
`focus-order`, …). Confirm it:

```
node verify.mjs <pageUrl> '<check-json>'
```

`verify.mjs` re-runs the steps from a clean load and returns
`{ ok: true|false, evidence: {...}, box: {x,y,width,height} }`. **Keep only
`ok:true`.** Capture the evidence box for the screenshot. Discard + note failures.

### 4. Decide the fix (auto-propose)
For each verified finding, reach for a Stitch (full guidance in
`../../expert-review/reference/stitch-ops.md`):
- focus-visible / reflow / contrast / content-on-hover → `inject-style` (+ the
  `show-on-focus` behavior for hover-reveal).
- keyboard operability → `behavior: make-operable`; ESC-to-close → `behavior: escape-dismiss`; wrong focus order → `behavior: reorder-before`.
- missing name / dead skip-link / lang → `set-attr`; strip `aria-hidden` on focusable → `remove-attr`.
- genuine content judgement (is alt *correct*, is order *meaningful*) → no
  stitch; leave `recommendation`, `stitches: []` (a developer/manual finding).
Be honest about robustness (widget-coupled behaviors are brittle; Witness
re-audits + we fail-open).

### 5. Assemble the plan + GET APPROVAL (required)
Build the plan JSON (`../../expert-review/reference/plan-schema.md`). Set
`reviewer: { name: "Lucia Agent", date: <today>, environment: "Chromium CDP a11y-tree · <personas>" }`
and on each finding `source: "fathom"`, `reproSteps`, `evidenceBox`. Preview it:

```
node ../../expert-review/scripts/submit.mjs --dry-run plan.json
```

Show the operator the verified findings + the exact stitches, and get **explicit
confirmation** — submitting publishes live changes. Never submit unprompted.

### 6. Preflight — prove the fix on the real edge ("live, but not fully live")
A verified finding + a proposed stitch is still a *claim that the fix works*.
Preflight proves it before anything reaches a real visitor:

```
node preflight.mjs plan.json            # apply candidate(s) + re-verify, leave up for review
node preflight.mjs plan.json --discard  # clear the candidate (live untouched)
```

It compiles the candidate stitch to a CANDIDATE Patch Roll (the `:preflight` key
via `expert.compilePreflight`) — applied by the **real Veil edge renderer** but
served only on `<slug>.luciaedge.com?__lucia_pf=1`, so real visitors on the
customer hostname are untouched. Then it re-runs the finding's **exact `check`**:
`before(live)=true → after(preflight)=false` means the fix is **proven** to resolve
the finding (both runs write before/after evidence bundles — the chain-of-custody
that the patch *works*, not just that the issue existed). Only promote fixes that
re-verify green; a brittle behavioral stitch that doesn't clear preflight never
reaches anyone. Findings need `stitches[]` + `check` + `pageUrl` to preflight.

### 7. Submit (promote)
After preflight is green + explicit approval: `node ../../expert-review/scripts/submit.mjs plan.json`
(per-finding `expert.submitFinding`, then `expert.compilePage` per page → live in
seconds), then `node preflight.mjs plan.json --discard` to clear the candidate.
Report outcomes + the report URL
`https://getlucia.ai/sites/<siteId>/pages/<pageId>/detailed`.

## Beating the human — the eval
To validate Probe against a known human audit (the headline proof): run a
**blind** Probe audit (produce `plan.json` **without reading the truth file**),
then score it:

```
node eval.mjs --found plan.json --truth eval-bad-plan.json
```

It diffs: **recall** (of the human's findings, how many Probe re-found),
**novel** verified findings the human missed (the "beat"). Precision is enforced
upstream by `verify.mjs` (every finding is harness-confirmed). Run the audit 3×
and report stability. Do **not** peek at the ground truth while auditing — that
invalidates the benchmark.

## Audit trail (chain of custody)

Every `verify.mjs` run **automatically** writes a tamper-evident evidence bundle —
this is the court-defensible record of what was actually tested:

```
runs/<runId>/run.json     # timestamp · pageUrl · exact check · verbatim result+evidence ·
                          #   browser/engine version · viewport · screenshot hash · integrity hashes
runs/<runId>/evidence.png # full-page screenshot of the page state at verification time
runs/ledger.jsonl         # append-only, hash-chained: entryHash = sha256(prevHash + runSha256)
```

- **Nothing is discarded.** Rejected candidates (`ok:false` / `inconclusive`) are
  retained too — they are evidence that Probe *tested and ruled out* an issue
  (proof of rigor, not noise).
- **Tamper-evident.** Editing any stored result, screenshot, or ledger line breaks
  the hash chain from that point. Re-prove integrity at any time:
  `node audit.mjs verify-chain` → `✓ intact` or `✗ CHAIN BROKEN — <where/why>`.
  Also `node audit.mjs list` and `node audit.mjs show <runId>`.
- **Relocate / retain.** Set `PROBE_RUNS_DIR=/path/to/evidence` to write the pack
  elsewhere (e.g. a per-audit, per-tenant folder you archive to Hold/R2). The
  `runs/` dir is the operator's evidence pack; it is git-ignored, never committed.
- **Reproducible.** A bundle stores the exact `check`; re-running
  `node verify.mjs <pageUrl> '<check>'` re-derives the same observable fact from a
  clean browser — "here is the record, and here is the command that re-proves it."
- Pass `--no-bundle` only for throwaway exploration; real audits keep the trail.

## Safety (hard rules)
- **Read-only.** Never submit forms, enter credentials or PII, or complete
  purchases. Activating controls to *observe state* is fine; do not transact.
- Respect CAPTCHA / bot walls — stop, mark `inconclusive`, don't try to defeat them.
- Only audit URLs for the given site. The harness inherits `demo.run`'s SSRF
  posture; don't point it at private/loopback hosts.
- Honest: a verified failure with no safe automated fix is a developer
  recommendation, not a patch. `inconclusive ≠ pass` — say so.
- Bounded: cap steps per brief; if a page is flaky/SPA-unsettled, retry once
  then mark inconclusive and move on.

## Submit auth
Reuses expert-review's flow: first real submit opens `getlucia.ai/cli-auth`, the
signed-in admin page hands a session token to a `127.0.0.1` callback, cached in
`~/.lucia/token.json`. You must be an admin on the allowlist in
`apps/api/src/trpc.ts`. `--dry-run` never triggers login.

## Notes
- **It compounds.** A submitted finding-with-stitch seeds a site learned rule —
  re-detected and spread on every future scan. Discovery becomes permanent coverage.
- **Idempotent.** Deterministic ids; re-run freely.
- Probe is the interactive/expert path; the same briefs + `verify.mjs` checks
  also back the headless auditor that runs at scale.
