# Personas, task briefs & check types

Each **brief** is one persona × one WCAG theme — short, so the loop stays
bounded and each finding maps to a single deterministic `check`. Run the MVP
brief first; add others on request or for a full sweep.

## Check types (what `verify.mjs` can confirm)

A candidate finding carries a `check` object. `verify.mjs <pageUrl> '<check>'`
re-runs it from a clean load and returns `{ ok, evidence, box }`.

| `type` | params | confirms (the observable fact) |
|---|---|---|
| `unreachable` | `selector` | Tab-walking from the top never lands on the element (keyboard can't reach it) |
| `focus-not-visible` | `selector` | the element receives focus but has **no** visible focus indicator (no outline/box-shadow/ring delta vs unfocused) |
| `no-accessible-name` | `selector` | the control is focusable/operable but its AX `name` is empty |
| `focus-order` | `selectors[]` | the DOM/visual order of these nodes ≠ their Tab order |
| `escape-noop` | `openSelector`, `dialogSelector` | after activating `openSelector`, a dialog appears but **Escape** does not close it |
| `focus-not-trapped-in` | `openSelector`, `dialogSelector` | opening the dialog does **not** move focus into it (focus stays behind the overlay) |
| `keyboard-trap` | `selector` | once focused, Tab/Shift-Tab cannot leave the element/region |
| `reflow-hscroll` | `width` (default 320) | at the narrow viewport the **page** needs horizontal scrolling (content clipped, 1.4.10) |
| `component-overflow` | `selector`, `width` (default 320) | a **specific component** (a menu / table / form) clips or overflows horizontally at high zoom (1.4.10) — find candidates with the `overflow <width>` harness verb |
| `skip-link` | `selector?` (else auto-detect the first in-page anchor) | activating the skip link does **not** move focus into the target / `main` (2.4.1) |
| `hover-only` | `triggerSelector`, `revealSelector`, `focusSelector?` | content revealed on **hover** is **not** revealed on keyboard **focus** (1.4.13 / 2.1.1). "Visible" is decided by **hit-testing** (`elementFromPoint`), so it catches content hidden by a 3D flip (`rotateY`/backface-visibility), occlusion, or z-index — not just `opacity`/`display`. `focusSelector` lets the keyboard target (the focusable link) differ from the hover target (the card). |
| `select-navigates` | `selector` (a `<select>`) | changing the select's value causes a **change of context** — navigation or submit — without the user activating a separate control (3.2.2 On Input; the "jump menu" failure). |
| `focus-removed` | `selector` | focusing the element runs script that **removes focus** (e.g. `onfocus="blur()"`), so focus can never be seen or held on it (2.4.7 Focus Visible / 3.2.1 On Focus). |
| `pointer-only` | `selector` | the element has an **inline pointer-only** handler (`onmouseover`/`onmousedown`/`onclick`), **no** keyboard handler, and is **not** focusable — a keyboard user can't trigger it (2.1.1 Keyboard). Inline handlers only; `addEventListener` ones aren't visible. |
| `no-label` | `selector` (a form control) | a form control (`input`/`select`/`textarea`) has **no** associated `<label>` / `aria-label` / `title` (3.3.2). Unlike `no-accessible-name` it does **not** count a select's option text as a label. |
| `ambiguous-link-text` | `selector` (a link) | the link's accessible name is a **generic** phrase ("click here", "read more", "more"…) **or** the same name is reused by other links pointing to **different** destinations — purpose unclear out of context (2.4.4). |

`skip-link` (no selector) also flags the **absence** of a bypass: if no in-page skip
link is the first focusable element AND there's no `<main>` landmark AND a sizable
nav block exists, that's a 2.4.1 failure (not just a *broken* skip link).
| `overlap` | `selectorA`, `selectorB` | two elements that should not overlap have intersecting boxes while both visible (clipped/colliding UI) |
| `text-spacing` | `selector`, `width?` | with the WCAG **text-spacing** overrides applied (line 1.5 / letter 0.12em / word 0.16em / para 2em), the component **clips** content — scroll size exceeds the box AND overflow is `hidden`/`clip` (genuine content loss, 1.4.12). A container that simply grows to fit is **not** a failure. |
| `carousel-autoplay-no-pause` | `selector` (carousel) | the carousel **auto-advances** (front slide changes over ~12s) AND has **no** pause/stop/play control within it (2.2.2). |
| `slides-all-exposed` | `selector` (the slide elements) | more than one carousel slide's text is **exposed to the AX tree at once** (inactive slides are not `aria-hidden`/`display:none`/`visibility:hidden`), so a screen reader announces several slides (1.3.2). |
| `offscreen-focusable` | `selector` (the slide elements) | tabbing reaches focusable controls inside slides that are **off-screen / not visible** (opacity 0, or rect outside the viewport) — focus enters invisible slides (2.4.3). |
| `contrast` | `selector` | the element's text contrast is **below** WCAG 1.4.3 (4.5:1 normal / 3:1 large ≥24px or ≥18.66px bold). Foreground = computed `color`; background = first opaque ancestor `background-color`, alpha-composited over white. Text over a background **image/gradient** → `inconclusive` (not computable from styles). |
| `abbr-present` | `abbr` (the token, e.g. `AU`) | the abbreviation is **used** as a whole word in the body text but **never** wrapped in `<abbr title>` (no mechanism to find its expansion, 3.1.4). `ok:true` = used-but-unexpanded; `ok:false` = ≥1 proper `<abbr title>` now wraps it; not found at all → `inconclusive`. Case-sensitive, whole-word — `AU` won't match "because"/"nautical". Fix with the `expand-abbr` behavior. |

`focus-order` compares the Tab order to the **visual reading order** (top-to-bottom,
left-to-right), not the DOM order — a control shown first but tabbed later (e.g. a
search input left of a button that tabs *after* it) is the 2.4.3 failure.

`focus-not-visible` is robust to **state-dependent** elements: if a clean
tab-walk can't reach the element (e.g. it's on a rotating carousel slide), it
falls back to focusing it directly and asserting that focusing produces **no**
computed-style change → no focus indicator.

`verify.mjs` returns `inconclusive` (not `ok:false`) when the page won't settle
or the selector can't be resolved — never guess.

---

## MVP brief — Blind/SR + keyboard: operability, focus, trap, modal

> Persona: screen-reader + keyboard-only. Start at the top of the page.
> Tab through the entire page once, recording the focus path (`tab` → focused
> node each step). Then:
>
> 1. **Reachability** — is every visibly-interactive control (links, buttons,
>    inputs, menu/disclosure triggers) in the focus path? A control you can
>    `query` + see but that never appears when tabbing → candidate
>    `unreachable`.
> 2. **Focus visible** — at each stop, does `focused` report a visible focus
>    indicator? None → candidate `focus-not-visible` (2.4.7).
> 3. **Operated name/role** — `activate` each control; does the focused node
>    expose a non-empty `name` and a sensible `role`/`value`? Empty name on an
>    operable control → `no-accessible-name` (4.1.2).
> 4. **Modal/cookie** — if a dialog/cookie banner is present or appears: does
>    focus move **into** it (`focus-not-trapped-in`)? Does **Escape** close it
>    (`escape-noop`)? Does focus return sensibly afterwards?
> 5. **No trap** — can you always Tab back out of every widget (`keyboard-trap`)?
>
> Report each failure with the focused node, the `check`, and `reproSteps`
> (e.g. `["Tab×7","Enter","Escape"]`).

This single brief is the P1 decision gate; it's also what the headless
Tier-1 auditor already probes deterministically.

## Brief — Blind/SR: focus order & reading order (2.4.3 / 1.3.2)

Tab through; compare the focus order to the visual/DOM order of the main
landmarks and the primary nav. A Tab order that jumps around vs. the visual
layout → `focus-order`. (Reading-order *meaning* is content judgement — flag as
a manual recommendation, no stitch.)

## Brief — Low-vision: reflow & zoom (1.4.10 / 1.4.4)

`reflow 320` for the page-level signal (`reflow-hscroll`). Then **`overflow 320`**
to list the *specific components* that clip at high zoom — menus, data tables,
forms — and confirm each with `component-overflow {selector}`. (A page can pass
page-level reflow while a menu or table still hides content — those are the
real-world findings.) `zoom 200` / `zoom 400` for the same on actual zoom.
Fix candidates: `inject-style`.

> **Audit the pages where the components live.** Site-wide findings (a nav menu)
> show on the home page, but a data table or a form is on *its* page
> (`/employment`, `/applicant…`). A complete audit walks the home + the top
> templated/section pages, not just `/`.

## Brief — Low-vision: focus-visible & hover-only content (2.4.7 / 1.4.13)

Tab the page at default zoom: any stop with no visible indicator →
`focus-not-visible`. For menus/tooltips that appear on hover, focus their
trigger by keyboard — content that appears on hover but not on focus →
`hover-only` (fix: `behavior: show-on-focus`).

## Brief — Motor / keyboard-only (2.1.1 / 2.1.2 / 2.5.8)

Everything operable by keyboard (reuse reachability + trap checks). Note target
sizes < 24px for `query`'d controls (manual recommendation; geometry is
advisory, not a hard stitch).

## Journeys (multi-step, run a brief across them)

Pick the journeys the site actually has: **primary nav**, **cookie/consent
banner**, **search → results → detail**, **sign-in form** (reach + label + error
identification — but **never submit credentials**), **add-to-cart** (reach +
state announcement — **never complete a purchase**). Each journey is just a
sequence of `tab`/`activate`/`press` with the same per-theme checks applied at
each state.

## Brief — Low-vision: text contrast (1.4.3)

Run **`contrast`** (the harness verb) to scan all visible text and list elements
below the WCAG ratio, worst first. Then **confirm each** on a clean load with
`verify.mjs contrast {selector}` (propose → verify). Watch two traps:
- **Text over a background image/gradient** → the verifier returns `inconclusive`,
  not a pass — judge those by eye (or `shot` the box).
- **A ratio of exactly 1.0** (foreground == background) usually means the text is
  *invisible at rest* — a fill/hover button whose label only appears on hover, or
  a genuine bug. **Screenshot it** (`shot`) before reporting: the pixels settle
  whether it's a real failure or a rendering trick the computed styles can't show.
Fix candidate: `inject-style` (raise the text colour / lower the background).

## Severity mapping

blocks a task / keyboard trap / operable control with no name / Level A failure
→ `serious` (or `critical` if it makes the page unusable). AA reflow/zoom/
focus-visible that's "difficult but possible" → `serious`/`moderate`. Cosmetic →
`minor`.
