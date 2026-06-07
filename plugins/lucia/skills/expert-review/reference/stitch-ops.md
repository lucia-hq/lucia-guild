# Choosing a Stitch op

Lucia applies stitches with Cloudflare **HTMLRewriter** (streaming, lol-html)
on the served HTML. v1 does **attribute + CSS + HTML-injection** patches only —
**no structural moves** (no reparenting, no reordering). Pick the op that fixes
the WCAG SC without restructuring; if only a restructure would fix it, record a
developer recommendation instead (empty `stitches`).

## Selector rules (HTMLRewriter)

Matching is **forward-streaming**. Supported: type, `.class`, `#id`,
`[attr]`, `[attr="v"]`, descendant (`a b`) and child (`a > b`) combinators.
**Not supported**: `+`, `~` (siblings), `:has()`, `:not()` with complex args, or
any parent traversal. Confirm your selector exists in the **served** HTML
(fetch the page first) — a selector that only appears after JS won't match at
the edge, *except* `inject-style`, which is global and applies to client-rendered
DOM too.

## Op → issue mapping

### `inject-style` — the workhorse for layout/visual SC
Adds one `<style>` to `<head>`. Best for the issues a human reviewer most often
raises that automation can't:
- **1.4.10 Reflow / 1.4.4 Resize Text** — adapt the reviewer's responsive CSS,
  but do NOT apply it verbatim to an existing nav/menu. Forcing
  `display:flex; flex-direction:column` or full-width block links on a site's
  own menu at `≤1024px` overrides its working mobile menu and breaks it (a
  reviewer caught exactly this). Prefer non-destructive rules — constrain width
  (`max-width:100%`), allow wrapping (`flex-wrap:wrap`, `overflow-wrap`), set
  `white-space:normal` — and verify on a real phone + at 400% zoom. Scoped
  containers (`app-employment .mat-mdc-table`) are safer than site-wide nav.
- **2.4.7 Focus Visible** — add `:focus` outlines to controls with none.
- **1.4.3 / 1.4.11 Contrast** — override colours on the offending selector.

Lift the CSS the reviewer supplies. Because it's global, SPA/Angular content
(`<app-employment>`, `<mat-table>`) is covered even though it renders client-side.
The stitch's `selector` field is a label only — put the affected selector there.

### `set-attr` — attribute corrections
- **2.4.1 Bypass Blocks** — fix a dead skip-link target: `href` → `#main`, and
  `set-attr tabindex="-1"` on the main container so it can receive focus.
- **4.1.2 Name/Role/Value** — `aria-label` on an icon-only control.
- **1.1.1 Non-text** — `alt` on an image.
- **3.1.1 Language** — `lang` on `<html>`.
Use `onlyIfMissing: true` when you must not clobber an existing value.

### HTML injection (`prepend/append/before/after-html`, `wrap-inner`)
- Inject a visually-hidden **skip link** at the top of `<body>`.
- Add a visually-hidden label before an unlabelled control.
Keep injected markup small and self-contained; pair with an `inject-style` for
the visually-hidden CSS rather than inline styles where possible.

### `behavior` — client-side runtime fixes
For issues that need *runtime behaviour* or *live DOM state* — the ones static
patches can't reach. Lucia already injects a runtime (`runtime.ts`) on every
patched page with a MutationObserver replayer; a `behavior` stitch runs a
**curated, audited module** from that runtime against the matched element. This
is NOT arbitrary script — the catalog is fixed in code, each module is
try/caught + idempotent (fail-open), and Witness re-audits the result. Set the
stitch `op: "behavior"`, `selector` to the target, `name` to a module, and
`params` (all string values).

| `name` | params | Fixes (WCAG) |
|---|---|---|
| `make-operable` | `role` (e.g. `button`); optional `navigate` | custom control not keyboard-operable — adds tabindex + role + Enter/Space activate (2.1.1, 4.1.2). With `navigate` set, it acts as a link instead: resolves a URL (el's `href`/`data-link`, else nearest `[data-link]`/`a[href]` ancestor) and navigates there on Enter/Space, and gives generic link text ("Read More") a contextual name — for widget "buttons" that only had a JS click handler |
| `escape-dismiss` | `hide` (selector of content to hide) | hover/focus content can't be dismissed (1.4.13) |
| `show-on-focus` | `reveal` (selector of content) | hover-only content unreachable by keyboard (2.1.1, 1.4.13) |
| `reorder-before` | `before` (selector of the sibling to precede) | wrong source/focus order — moves el ahead of a relative (2.4.3) |
| `carousel-pause` | `label` (a noun, e.g. `announcements`) | auto-rotating content with no pause — injects a Pause/Play toggle, pauses by default (2.2.2) |
| `slide-state` | `slide` (slide selector), `active` (current-slide class — **optional**) | all carousel slides exposed to AT + in tab order — hides non-current ones, live-synced as it rotates. Class-first: pass `active` for class-based sliders (Slick `slick-active`, Swiper `swiper-slide-active`, Owl/Bootstrap `active`); **omit it for class-less sliders** (Slider Revolution rs6) and it falls back to computed visibility. Doesn't cover transform/translate sliders that leave off-screen slides visible — pass a class for those (1.3.2, 2.4.3, 2.1.2) |
| `regroup` | `children` (comma-joined selectors) | independently-positioned layers overlap — wraps them into one flow container (1.4.12) |
| `pair-rows` | `cols` (column selector) | two parallel grid rows read out of order (all details then all labels) — anchor el on the section heading; prefixes each detail with its matching label (by column index, sr-only) + aria-hides the standalone labels. Visually non-destructive (1.3.2, 2.4.6) |
| `expand-abbr` | `abbr` (the token, e.g. `AU`), `title` (its expansion) | an abbreviation/acronym is used but never expanded — wraps whole-word, case-sensitive occurrences under `selector` in `<abbr title>` so a screen reader can read out the expansion (3.1.4). Idempotent + observer-safe: skips text already inside `<abbr>`/`<script>`/`<style>`, guards the container. **Only use a `title` the page itself supports** (it defines `AU` as "Accessible University"); never invent an expansion. One stitch per abbreviation. |

Behaviors that hook a **third-party widget** (a Slider Revolution carousel:
`carousel-pause`, `slide-state`) are more brittle than the rest — they depend on
the widget's structure. That's fine *because* Witness re-audits the patched page
and we fail-open; still, confirm against the live DOM and prefer the robust
modules (`make-operable`, `escape-dismiss`, `reorder-before`) where either works.

### Genuinely human-only (no stitch)
Very little remains — chiefly **content judgement**: is generated alt text
*correct*, are video captions accurate, is the reading order *meaningful* (not
just present). Record these with a `recommendation`; they surface as a developer
/ reviewer note. Don't force a stitch you can't verify.

## Example: skip link (WCAG 2.4.1)

Reviewer: skip link `href="#1"` points at a non-existent id; should target the
existing `<main id="main">`, which needs `tabindex="-1"`, and the link should be
visible on focus.

```json
"stitches": [
  { "op": "set-attr", "selector": "#skiplinks a", "name": "href", "value": "#main" },
  { "op": "set-attr", "selector": "#main", "name": "tabindex", "value": "-1" },
  { "op": "inject-style", "selector": "#skiplinks a",
    "css": "#skiplinks a:focus{position:fixed;left:1rem;top:1rem;z-index:10000;padding:.75rem 1rem;background:#fff;color:#000;border:2px solid #000;}" }
]
```
