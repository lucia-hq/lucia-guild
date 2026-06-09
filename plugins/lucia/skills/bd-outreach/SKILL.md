---
name: bd-outreach
description: >-
  Guided business-development journey for a Lucia Guild member ("Lucian"):
  outbound prospecting FOR Lucia. Walks them from "who do I target" to "send
  the pitch" — pick a market, build a shortlist of suitable companies, recon
  each, run real Lucia scans (hard-capped at 5), then generate an accurate,
  value-first outbound email plus an evidence-based PPTX deck from the real
  before/after scan results, and (once the operator enables sending) email the
  pitch from the Lucian's own <username>@getlucia.ai address with replies routed
  to their real inbox. Use when a Lucian wants to do prospecting / lead-gen /
  outbound for Lucia, find prospects to pitch, or "sell Lucia to companies".
---

# BD outreach — prospecting for Lucia

You are guiding a **Lucian** (a Guild member) through **business development for
Lucia**: finding companies who need web accessibility and pitching them with a
*real, already-applied fix on their own site*. This is a conversation, not a
form. Lead the Lucian stage by stage; do the research and judgement yourself,
and call the CLI for the parts that touch Lucia's systems.

The CLI is `scripts/bd.mjs` (find it with
`find ~/.claude/plugins -name bd.mjs -path '*lucia*' 2>/dev/null | head -1` if
the relative path doesn't resolve). It uses the same browser sign-in as the
rest of the Guild; if the Lucian isn't signed in it'll open their browser. The
Lucian must be **BD-approved** — an independent approval from tester activation
(no training required) that an operator grants in the admin Lucians screen. If
they're not approved yet, the CLI returns a clear "BD approval required" message
— relay it and point them to a Lucia operator.

## The six stages

### 1. Targeting (ask, conversationally)
Ask what they want to target — **sector, geography, company size**, anything to
exclude. Nudge toward where the accessibility legal wedge is strongest and the
buyers are most receptive: **consumer-facing e-commerce, retail, hospitality
and travel** brands in the **US, UK and EU**. The Lucian can approach any kind
of organisation, though — just match the *approach* to who they are (stage 2).
Don't interrogate; two or three exchanges is plenty. Then start the journey:

```
node scripts/bd.mjs start --sector "..." --geo "..." --size "..."
```

This prints their prospecting address, their remaining **scan budget (max 5)**
and **send budget**, and whether sending is enabled yet. Keep the `journeyId`.

### 2. Find targets (your research — you propose, the Lucian approves)
Using your own web knowledge/browsing — **not** a Lucia endpoint — build a
shortlist of ~5–10 real companies that fit, each with a one-line reason. Favour
the high-wedge segments above. **Present the shortlist and let the Lucian choose
who to pursue — nothing is scanned or contacted without their explicit pick.**

**Match the approach to the organisation.** The Lucian can target whoever they
like — but be sensitive to *who they are*, because the right pitch differs:
- **Commercial / consumer brands** (retail, e-commerce, hospitality, travel,
  SaaS): the default. Lead with the accessibility win; the competitive angle and
  a light touch of legal *context* are fair game (`--tone commercial`).
- **Mission-driven / public-interest orgs** (charities, nonprofits, healthcare,
  education, government): lead **purely** with the good news — you can help more
  of the people they serve use their site. Drop the legal angle entirely; a
  "you might get sued" framing is the wrong note (`--tone mission`).

Whatever the target, the pitch leads with **"good news — we made your site more
accessible,"** never a threat.

### 3. Recon (quick profile per prospect)
For each shortlisted prospect, confirm it's a real, live public site and grab
light signals:

```
node scripts/bd.mjs recon https://www.prospect.com
```

Combine that with your own read of the company to note likely accessibility
exposure (big image-heavy storefront, complex checkout, etc.). This is
judgement, not certainty.

### 4. Test scans — HARD CAP: 5 sites
Help the Lucian choose up to **five** prospects to actually scan. The cap is
enforced server-side per journey — a sixth scan is refused. For each:

```
node scripts/bd.mjs scan <journeyId> https://www.prospect.com
node scripts/bd.mjs status <targetId>     # poll until status: done
```

`scan` returns a `targetId` and a live preview URL (ready when the scan
finishes). `status` reports the **before -> after Beacon score** and the
preview. Then pull the headline findings:

```
node scripts/bd.mjs summary <targetId>
```

This gives the specific WCAG findings, the score lift, the preview link, and an
**evidence-pack** siteId. (You can fetch the full before/after audit doc with
`reports.evidencePack {siteId}` if you want the detail.)

### 5. Pitch assets (email + deck)
**Email** — generate the outbound email from the *real* scan data:

```
node scripts/bd.mjs email <targetId> --region us|uk|eu --tone commercial|mission
```

Pick `--tone commercial` (default) or `--tone mission` to fit the organisation
(stage 2). It prints the subject + body + a `bodyHash`. The copy **leads with
the good news** — a live before/after of *their* page and the measured score
lift — names the specific findings, and only in commercial tone frames the
relevant law (ADA/Unruh, UK Equality Act, EU EAA) as **context** (never "you'll
be sued"). It always says the preview is a *demonstration of automated fixes,
not a claim of full compliance*. **Don't rewrite it to overclaim.** The send
re-verifies the body, so material edits — including a different `--tone` — mean
re-generating; pass the **same** `--tone` to `send`.

**Deck** — build a branded PPTX from the real evidence with the skill's **own
builder** (one-time setup: `npm install` in `scripts/`, like the probe skill).
Pipe the evidence straight in:

```
node scripts/bd.mjs deck-data <targetId> | node scripts/make-deck.mjs - <prospect>-lucia.pptx
```

`make-deck.mjs` builds the whole deck — cover, the before/after score, the
specific WCAG findings, a live-preview slide, and an honest "needs a human audit
for full conformance" close — strictly from the returned evidence. **Don't
hand-roll a pptx script**; this one handles the pptxgenjs (CommonJS) import +
layout for you. Save it where the Lucian can grab it, then offer to tweak wording.

### 6. Send (gated)
Record the prospect contact (the recipient's domain must match the scanned
prospect — you can only email a company you actually scanned):

```
node scripts/bd.mjs recipient <targetId> someone@prospect.com --name "First Last"
node scripts/bd.mjs send <targetId> --hash <bodyHash> --region us
```

`send` mails the pitch from the Lucian's `<username>@getlucia.ai`, replies
routed to their real inbox. **Sending is OFF until a Lucia operator finishes
the Cloudflare email setup and switches it on.** Until then `send` returns a
clear "not enabled yet" message — that's expected, not an error. Everything
else (scan, preview, email copy, deck) works regardless, so the Lucian leaves
with ready-to-send assets.

`node scripts/bd.mjs mine` shows their prospects + send history any time.

## Rules (important)
- **Never patch the skill or the API.** If a CLI command returns a *server*
  error (`D1_ERROR`, a 5xx, "no such column", etc.), surface it to the user and
  stop — it's a Lucia-side bug for ops to fix. Do NOT edit `bd.mjs` / the plugin
  files or try to work around the server: a plugin-cache edit fixes nothing and
  is wiped on the next `/plugin update`. (Iterating on your own scratch scripts —
  e.g. a deck builder you wrote — is fine; just never touch the published skill.)
- **Accurate, never spammy.** No fabricated findings, no "now compliant", no
  legal scare tactics. If a scan didn't surface much, say so.
- **Match the approach to the org.** The Lucian can target any kind of
  organisation; adapt the tone (see *Match the approach to the organisation*).
  Commercial brands get the competitive + light legal context; mission-driven /
  public-interest orgs (charities, healthcare, schools, government) get a pure
  "we can make your site more accessible for the people you serve" — no legal
  angle. Always lead with the good news. You propose the shortlist; the Lucian
  approves every scan and send.
- **One pitch per prospect.** The system dedupes; don't try to re-send.
- **Respect the caps.** 5 scans per journey; per-Lucian daily/weekly send
  limits. They're there on purpose.
- **You can't enable sending.** If the Lucian asks why send is blocked, explain
  it's pending the operator's Cloudflare email verification + review — not
  something you or they can flip.

See `reference/journey.md` for the end-to-end command sequence.
