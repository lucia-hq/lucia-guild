# Plan JSON schema

The plan you assemble and pass to `scripts/submit.mjs`. One object:

```jsonc
{
  "siteId": "demo-abc12345",        // required — the Lucia site
  "reviewer": {                      // optional — shown on every finding's footer
    "name": "the reviewer",
    "date": "2026-05-21",
    "environment": "Windows 11, Chrome 148, 200%/400% zoom, keyboard-only"
  },
  "findings": [                      // required — one per issue in the doc
    {
      "pageUrl": "https://www.example.com/",  // required — matched to a scanned page by URL path
      "wcagSc": "2.4.1",                            // required — SC number
      "wcagName": "Bypass Blocks (Level A)",        // optional — human label
      "subject": "Skip link doesn't move focus to main content",  // required — short title
      "explanation": "After activating the skip link, focus moves to…",  // optional — user-impact prose
      "severity": "serious",         // critical | serious | moderate | minor   (default serious)
      "selector": "#skiplinks a",    // required — the PRIMARY offending selector (labels the finding)
      "htmlSnippet": "<a href=\"#1\">Skip to Content</a>",  // optional — the offending markup
      "recommendation": "Point href at #main, add tabindex=-1…",  // shown when stitches is empty (developer fix)
      "stitches": [                  // 0+ — empty = developer-only finding (status "manual")
        { "op": "set-attr", "selector": "#skiplinks a", "name": "href", "value": "#main" }
      ]
    }
  ]
}
```

## Stitch object

Each stitch is `{ op, selector, …op-specific }`. The server fills the rest
(id, severity, ruleSrc, axeRuleId, confidence) and validates against the shared
`Stitch` schema before anything is written, so a malformed stitch is rejected,
not silently dropped.

| op | required fields | use for |
|---|---|---|
| `set-attr` | `name`, `value`, (`onlyIfMissing?`) | dead `href`, `tabindex`, `aria-label`, `alt`, `lang` |
| `remove-attr` | `name` | strip a harmful attribute (e.g. `aria-hidden` on a focusable) |
| `set-text` | `value` | replace an element's text |
| `inject-style` | `css` | reflow / zoom / focus-visible / contrast — global `<style>` into `<head>` |
| `prepend-html` / `append-html` / `before-html` / `after-html` / `wrap-inner` | `html` | inject a skip link, visually-hidden label, etc. |
| `rename-tag` | `tag` | promote a `<div role=button>` to a real element (rare; risky) |
| `behavior` | `name` (catalog module) + `params` (string map) | runtime/behavioural fixes — keyboard operability, carousel pause, Escape-to-dismiss, per-slide aria-hidden, source-order moves, regrouping. See `stitch-ops.md` → behavior catalog |

For `inject-style` the stitch's `selector` is just a label (the CSS carries its
own selectors); set it to the affected element for a readable report row.

## Behaviour notes

- **Idempotent**: ids are derived from the finding + stitch content, so
  re-running upserts in place. Fix a selector and re-run freely.
- **status**: a finding with ≥1 stitch is recorded as `patched`; with none, as
  `manual` (developer recommendation). Both show on the report, both flagged
  human-identified.
- `submit.mjs` calls `expert.compilePage` once per distinct `pageUrl` after all
  findings — that's what pushes the stitches live.

## Retractions (optional)

When a reviewer flags a Lucia remediation as a **false positive**, add a
top-level `retractions` array (the plan may be retractions-only — `findings`
isn't required):

```jsonc
"retractions": [
  { "pageUrl": "https://www.example.com/",
    "axeRuleId": "lucia/missing-skip-link",   // the Lucia rule whose stitches to pull
    "reason": "Already had a skip link; ours was redundant." }
]
```

Each calls `expert.retractStitch`: removes that rule's stitches from the page,
marks its findings ignored, recompiles, and re-scores. Pair it with a core-rule
fix (see `core-rules.md`) so the mistake doesn't recur on the next scan.
