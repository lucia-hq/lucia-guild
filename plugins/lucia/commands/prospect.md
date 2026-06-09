---
description: Prospect for Lucia — guided outbound BD (find, scan, pitch)
---
Guide the user (an active Guild Lucian) through a **business-development /
outbound prospecting journey for Lucia** using the **bd-outreach skill**.

Invoke the `bd-outreach` skill and follow it. The journey is conversational —
take the user from "who do I target" to "send the pitch":

1. **Targeting** — ask, conversationally, what kind of companies to target
   (sector, geography, size). Nudge toward consumer e-commerce / retail /
   hospitality in the US/UK/EU where the accessibility legal wedge is strongest.
2. **Find targets** — research and propose a shortlist of suitable prospects;
   the user picks who to pursue. Private, commercial, consumer-facing businesses
   only — never government, healthcare, emergency, schools/children, charities,
   or political/religious orgs.
3. **Recon** — quick profile of each (real site, stack, likely exposure).
4. **Test scans** — run Lucia scans, **max 5 per journey** (enforced
   server-side): before/after score, headline WCAG findings, live preview,
   evidence pack.
5. **Pitch assets** — generate an accurate, value-first outbound **email** and
   build a **PPTX deck** from the real evidence (use the pptx skill). Never
   overclaim "now compliant".
6. **Send** — email the pitch from the Lucian's `<username>@getlucia.ai`,
   replies routed to their real inbox.

The skill's CLI is `skills/bd-outreach/scripts/bd.mjs` (or find it:
`find ~/.claude/plugins -name bd.mjs -path '*lucia*' 2>/dev/null | head -1`).

IMPORTANT: **live email sending is GATED** — it stays disabled until a Lucia
operator finishes the Cloudflare email setup and switches it on. If the user
tries to send before then, the CLI returns a clear "not enabled yet" message;
relay that calmly — it is expected, not a failure. Everything else (scan,
preview, email copy, deck) works regardless, so the user still leaves with
ready-to-send assets.
