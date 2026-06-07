# Fixing a CORE rule (not just a site)

Sometimes a reviewer isn't reporting a site bug — they're reporting that
**Lucia got it wrong**: a detector that over-fires, mislabels, or mis-scores.
That's the highest-value feedback, because fixing the *rule* improves every
tenant, not one page. The skill can do this — but a core-rule change is
**admin-gated** (it affects all customers) and, for code rules, needs a deploy.

## First, classify the feedback

| The reviewer is saying… | Action |
|---|---|
| The *site* has an issue | Normal finding → stitch (or developer rec). |
| Lucia applied a *wrong/redundant* fix | **Retract** it (per-page) — add to `plan.retractions`; `submit.mjs` calls `expert.retractStitch`. |
| Lucia's *detection/triage/scoring logic* is wrong | **Fix the core rule** (below) — durable, all tenants. |

A bad remediation usually means BOTH: retract the live output **and** fix the
rule so it doesn't recur. (The skip-link note below was exactly this.)

## Where core rules live

| Layer | Path | What it controls | Change = |
|---|---|---|---|
| **Sentinel probe** | `workers/sentinel/src/probes/*.ts` | Detection + auto-fix for issues axe can't see (the `lucia/*` rules) | edit code → redeploy `sentinel` |
| **Loom strategy** | `packages/loom/src/strategies/*.ts` | How a fix *value* is generated (alt text, labels, …) | edit code → redeploy workers using loom |
| **Loom registry** | `packages/loom/src/registry.ts` + `loom_registry` D1 table | axe-rule-id → {bucket auto/caveat/manual, severity, task, wcag} | D1 `UPDATE` at **runtime** (no deploy), or edit registry.ts |
| **Atlas scoring** | `packages/atlas/src/score.ts` | The Beacon Score model (weights, coverage, k) | edit code → redeploy `inspector`/`witness` |

Rule of thumb: **detection wrong → probe**; **fix-quality wrong → strategy**;
**triage/severity wrong → registry (runtime-tunable)**; **score wrong → Atlas**.

## The fix workflow (REQUIRED)

1. **Locate** the rule from the table above (grep the `axeRuleId`, e.g.
   `lucia/missing-skip-link`).
2. **Diagnose** precisely — quote the offending lines and explain the defect in
   the reviewer's terms.
3. **Edit the rule** (smallest correct change) on a clean `main`, and add/extend
   a fixture test under `tests/fixtures` where one exists.
4. **Open a PR — never commit a core rule to `main` directly.** Run:
   ```
   bash scripts/propose-core-rule.sh "<title>" "<why, incl. the expert finding>" <changed files…>
   ```
   It isolates the edit on a `core-rule/<slug>` branch and opens a GitHub PR
   (or, when there's no remote, a local review branch — `main` stays clean
   either way). The PR body auto-states the blast radius + deploy step.
5. **The PR review + merge IS the admin approval — do NOT merge it yourself.**
   A core-rule change alters behaviour for *every* tenant; the admin reviews the
   diff and merges to sign off. (loom_registry *data* edits are the exception:
   an admin-run `UPDATE loom_registry`, live with no deploy — still admin-only.)
6. **Deploy after merge** — code rules need the owning worker redeployed
   (`pnpm --filter @lucia/<worker> run deploy`).
7. **Retract** any already-applied bad output on affected pages
   (`expert.retractStitch`) so customers aren't left with the old mistake.

## Worked example — the skip-link probe

Defect: `missing-skip-link` scanned only the first 2 KB of `<body>` and matched
only conventional hrefs, so a skip link after the a11y toggles (href `#1`) was
missed → Lucia inserted a redundant one.

Fix (applied, admin-approved): `workers/sentinel/src/probes/missing-skip-link.ts`
now scans the full header region (64 KB) and recognises an existing skip link by
container (`#skiplinks`), role, link text, or href — and flags a present-but-
broken target instead of inserting a duplicate. Deploy: `sentinel`. Per-page
cleanup: retract `lucia/missing-skip-link` on the affected page.
