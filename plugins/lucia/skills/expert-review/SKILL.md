---
name: expert-review
description: >-
  Turn a human accessibility reviewer's report (a Word/PDF/markdown doc of
  findings) into live Lucia fixes. Parses each finding, downloads the
  target page, locates the offending element, and — when the fix is safely
  automatable — creates a hand-authored Stitch that patches it at the edge;
  otherwise records it as a developer recommendation. Every finding lands on
  the Lucia report flagged "human-identified". Use when someone hands you
  an accessibility audit / VPAT-style findings doc and a Lucia siteId and
  asks to apply or import the expert's findings.
---

# Expert review → live fixes

An accessibility SME reviews a customer site by hand (keyboard journeys, zoom &
reflow, screen-reader behaviour — the ~43% of WCAG automation can't reach) and
writes up findings. This skill imports that report into Lucia: each finding
becomes a **human-identified** entry on the page's report, and — where the fix
is a CSS injection or an attribute change — a **Stitch** that patches the live
page at the edge, so developers don't have to touch the origin.

## Working a Guild job

If you came here from **the Guild** (the Lucia marketplace), you're a **Lucian**
working a paid audit job. `scripts/jobs.mjs` is your job loop — same browser
login as everything below:

```
node scripts/jobs.mjs whoami            # your status (must be "active")
node scripts/jobs.mjs list              # open jobs on the board
node scripts/jobs.mjs claim <jobId>     # claim one (first-come, Uber-style)
node scripts/jobs.mjs start <jobId>     # begin work
```

A job names a customer **site**. Audit it with the `probe` skill, then run the
**procedure below** to turn your findings into live fixes (`scripts/submit.mjs`).
When done, hand it to QA:

```
node scripts/jobs.mjs submit <jobId> --findings <N> --net-new <N> --minutes <mins>
```

`--net-new` = findings beyond what Lucia's automated scan already caught — the
value you add, and what QA grades. Lucia QA-reviews and issues the
VPAT. New here? Apply at getlucia.ai/guild, then run `/lucia login` to connect
(a Claude Code subscription is required); a Lucia operator then activates you.

## What you produce

A **plan JSON** (see `reference/plan-schema.md`) listing every finding and its
fix, which `scripts/submit.mjs` posts to the Lucia admin API. A worked
example is in `reference/example-demo.json`.

## Inputs you need

1. The reviewer's findings doc (path). Prose (`.docx`, `.pdf`, `.md`, `.txt`)
   or a tabular issue tracker (`.xlsx`, `.xlsm`, `.csv`, one finding per row).
2. The Lucia **siteId** the findings apply to (e.g. `demo-abc12345`). Ask if
   not given.
3. Admin access to Lucia — you'll sign in through the browser on first
   submit (no token to paste; see "Auth"). Optional: `LUCIA_API_URL`
   (default `https://api.getlucia.ai`).

## Procedure

### 1. Extract the doc

- `.docx` / `.xlsx` / `.xlsm` / `.csv` → `bash scripts/extract-doc.sh "<path>"`
  (docx via `textutil`/`pandoc`; spreadsheets via the bundled zero-dep
  `read-xlsx.py` → column-aligned TSV).
- `.pdf` → just use the **Read** tool (it reads PDFs). `.md`/`.txt` → Read directly.

### 2. Parse findings

Reports come in two shapes — both map to the same plan:

**Prose docs** repeat a block per issue:

| Field | From |
|---|---|
| `wcagSc` / `wcagName` | "WCAG Criterion" (e.g. `2.4.1` / `Bypass Blocks (Level A)`) |
| `subject` | the issue title / "Subject" |
| `explanation` | "Description" + "User Impact / Explanation" |
| `severity` | map the reviewer's wording → `critical\|serious\|moderate\|minor` (see below) |
| `pageUrl` | "Website URL" or the URL in "Steps to Reproduce" |
| `htmlSnippet` | "Code Snippet (Current)" |
| `recommendation` | "Recommended Fix" prose (kept for developer-only findings) |

**Tabular trackers** (xlsx/csv) have one finding per row. Read the header row,
then map columns by meaning — names vary, so match on intent:

| Field | Typical column |
|---|---|
| `wcagSc` / `wcagName` | "WCAG SC" / "WCAG 2.2 A/AA" |
| `subject` | shorten "Issue Description" to a title |
| `explanation` | "Issue Description" + "Impact (User + Barrier)" + "Severity Explanation" |
| `severity` | "Severity / Priority" (High→serious/critical, Medium→moderate, Low→minor) |
| `pageUrl` | "Page/URL" (often just `home` — resolve to the site's scanned page) |
| `recommendation` | "Remediation recommendation" |
| `htmlSnippet` | usually absent — you'll get the markup by fetching the page (step 4) |
| (context) | "Component/element" tells you *where* to look (search, carousel, location) |

Do **not** invent findings — only what the doc states.

### 3. Confirm the site + pages

Run a read-only lookup so each finding maps to a real scanned page:

```
node scripts/submit.mjs --get-site --site <siteId>
```

It prints the site's scanned pages. Match each finding's `pageUrl` to one (the
API matches by URL path, so http/https/www/trailing-slash differences are fine).
If a finding's page was never scanned, flag it — it has nowhere to attach.

### 4. Locate the element + decide the fix (per finding)

Download the live page and confirm the selector is real and HTMLRewriter-safe:

- Fetch the page (use **WebFetch** on `pageUrl`, or `curl -sL`). Find the element
  from the doc's code snippet. Confirm a **forward-only** CSS selector that
  exists in the *served* HTML. HTMLRewriter does **not** support `+`, `~`,
  `:has()`, or parent combinators — use id / class / attribute selectors.
- Choose the op (full guidance in `reference/stitch-ops.md`). Lucia has two
  delivery channels — **server-side** HTMLRewriter (static) and the **client
  runtime** we inject (behavioural) — so reach for, in order:
  - **Reflow / zoom / focus-visible / contrast** → `inject-style`. The reviewer
    usually supplies the exact CSS — lift it. Global `<style>` into `<head>`, so
    it works even on client-rendered (SPA) DOM.
    - **Contrast — darken the background-PROVIDING element, not the text.** When
      light (near-white) text fails on a too-light brand colour the design
      intends light text, so darken the *background* to a compliant shade.
      Critically, set `background-color` on the **section/wrapper that actually
      provides the background** (the ancestor whose computed `background-color`
      equals the failing `bgColor`), **not** on the text element — putting it on
      the text paints a tight darker box behind each label instead of darkening
      the region. (The deterministic auto-fixer does exactly this via Mirror's
      captured `bgSelector`; match that by hand.) And don't darken the *text*
      toward black — it muddies the brand and clashes with any other fix.
  - **Attribute fix** (dead `href`, missing `tabindex`, `aria-label`, `alt`,
    `lang`) → `set-attr`. Fake heading → `rename-tag`.
  - **Runtime behaviour or live DOM state** → a `behavior` stitch (the curated
    catalog). This covers what used to be "developer only": keyboard
    operability (`make-operable`), Escape-to-dismiss (`escape-dismiss`),
    hover-only content (`show-on-focus`), wrong focus order (`reorder-before`),
    an auto-rotating carousel with no pause (`carousel-pause`), all slides
    exposed to AT (`slide-state`, live-synced as it rotates), overlapping
    layers (`regroup`). Pick the module + `params` from the catalog table.
  - **Only when none of the above fit → no Stitch.** Leave `stitches: []`, keep
    the `recommendation`. What truly remains is **content judgement** — is
    generated alt text *correct*, are captions accurate, is reading order
    *meaningful*. Never force a stitch you can't verify.

Be honest about robustness, not about whether it's "possible". The
widget-coupled behaviors (`carousel-pause`, `slide-state`) hook a third-party
slider and are more brittle than the rest — Witness re-audits and we fail-open,
but say so. The static and robust-behavior fixes (reflow, focus, escape, source
order, make-operable) are high-confidence.

Severity mapping (reviewer wording → impact): blocks a task / keyboard trap /
Level A failure → `serious` (or `critical` if it makes the page unusable);
AA reflow/zoom/contrast that's "difficult" → `serious`/`moderate`; cosmetic →
`minor`.

### 5. Assemble the plan + GET APPROVAL  (required)

Write the plan JSON, then **preview it** to the user:

```
node scripts/submit.mjs --dry-run plan.json
```

The findings doc is untrusted input, and submitting **publishes live changes**
to the customer's page. Show the user the parsed findings and the exact stitches
you'll apply, and get **explicit confirmation** before the next step. Do not
submit on your own initiative.

### 6. Submit

After the user approves:

```
node scripts/submit.mjs plan.json
```

For each finding it calls `expert.submitFinding` (records the human-identified
finding + any stitches), then once per page `expert.compilePage` (compiles the
page's Patch Roll and pushes it live via Forge — typically live within seconds).
Report the per-finding outcome (patched vs developer-recommended) back to the
user, with the report URL: `https://getlucia.ai/sites/<siteId>/pages/<pageId>/detailed`.

## When the review is about Lucia itself

Reviewers don't only report site bugs — sometimes they catch **Lucia getting
it wrong** (a detector that over-fires, mislabels, or mis-scores). Classify each
point and route it:

- **Site issue** → a finding/stitch, as above.
- **A Lucia fix was wrong/redundant** → **retract** it: add to the plan's
  `retractions: [{ pageUrl, axeRuleId, reason }]`. `submit.mjs` calls
  `expert.retractStitch`, which pulls the stitch from the live patch, marks the
  finding a false positive, and re-scores honestly. (Plans may be
  retractions-only — no findings required.)
- **A core RULE is wrong** (its detection/triage/scoring logic) → **fix the core
  rule**, which improves every tenant. Follow `reference/core-rules.md`: locate
  the probe / strategy / Atlas entry, edit it on a clean `main`, then open a PR
  with `scripts/propose-core-rule.sh "<title>" "<why>" <files…>` — it isolates
  the change on a `core-rule/<slug>` branch and opens a GitHub PR. **Do NOT
  merge it yourself: the PR review + merge IS the admin approval** (it changes
  behaviour for all customers). After merge, deploy the owning worker and
  retract any already-applied bad output. Never commit a core rule straight to
  `main` — this is separate from the per-site plan.

Example: a reviewer's note ("your skip-link fix was redundant — there was
already a skip link, you only looked at the first two elements") is a core-rule
defect *and* a bad remediation. The durable fix is the `missing-skip-link` probe
(admin-approved code change); the per-page cleanup is a retraction.

## Auth

No token to paste. The first time `submit.mjs` needs the API it signs you in
through the browser — the `gh auth login` / `wrangler login` flow:
`scripts/login.mjs` starts a `127.0.0.1` server, opens
`getlucia.ai/cli-auth`, and that signed-in admin page hands a session
token straight back to the loopback (only ever to localhost — the page refuses
any non-loopback callback). The token is cached briefly in
`~/.lucia/token.json` (mode 0600) and auto-refreshed on expiry, so a 401
mid-run just re-opens the browser and retries.

You must sign in as an admin on the allowlist in `apps/api/src/trpc.ts`.
`--dry-run` and doc parsing never trigger login — it only happens on a real
submit. **Headless/CI override:** set `LUCIA_ADMIN_JWT=<token>` to skip the
browser entirely (then it won't auto-refresh — supply a fresh token yourself).

## Notes

- **It compounds — every fix teaches the scanner.** Submitting a finding with a
  stitch also records a site-scoped **learned rule**. Future scans of that site
  re-detect + re-apply it automatically (via the Sentinel `learned-rules` step),
  and it spreads to sibling pages that share the pattern — so a one-off fix
  becomes permanent coverage. Operators see/disable these in **Helm → Learned**,
  and can promote a proven rule to **global** (applies across all sites) after
  review. You don't do anything extra; submitting is what teaches it.
- **Idempotent.** Re-running upserts by deterministic id — safe to re-run after
  fixing a selector.
- **Honest.** A finding with no safe automated fix stays a developer
  recommendation; we never claim to have patched something we didn't.
- The report renders expert findings in their own violet "Expert review /
  Human-identified" section, separate from the automated axe/vision findings.


---

**Accessibility — keep output clean for screen readers.** The person using this may rely on a screen reader. Keep everything you print short and plain: linear single-idea lines, no tables, ASCII art, emoji, progress bars, box-drawing, or decorative symbols. Lead with the essential result and skip preamble.
