---
description: Guided first audit — spin up a demo site, watch it auto-remediate, fix one issue, see it live
argument-hint: "[url]   (optional; defaults to the W3C accessibility demo)"
---

Run the Lucia Guild **training** flow for the user: a guided first audit that ends
with their own fix live on a preview URL. This works **before activation** — it's
how a new Lucian learns the loop.

Locate this plugin's training CLI `skills/expert-review/scripts/train.mjs` (or
`.claude/skills/expert-review/scripts/train.mjs`; if unsure,
`find ~/.claude/plugins -name train.mjs -path '*lucia*' 2>/dev/null | head -1`).
The `probe` and `expert-review` skills are in this same plugin.

Do these steps in order, narrating clearly and encouragingly:

1. **Start.** Run `node <train.mjs> start $ARGUMENTS`. It creates a demo training
   site (defaults to the W3C before/after demo), queues Lucia's full automated
   remediation, and prints a `siteId` and a live `previewUrl`. Tell the user
   what's happening.

2. **Watch the robots work.** Poll `node <train.mjs> status <siteId>` every ~5s
   until `status` is `done` (100%). Report the before→after score. Open the
   `previewUrl` and point out a couple of the automated fixes (alt text, labels,
   contrast) — explain Lucia's pipeline (Mirror→Inspector→Mender→Forge→Witness)
   just handled the mechanical issues.

3. **Find what the robots can't.** Use the **`probe`** skill against the preview
   URL to find ONE interaction/state-dependent issue a scanner misses — a
   keyboard trap, a broken focus order, an unlabelled custom control, a missing
   live-region announcement. Explain why a human is needed for it.

4. **Fix it.** Use the **`expert-review`** skill to author and submit that one fix
   for this `siteId` (it previews the plan and asks for explicit approval before
   publishing). The trainee is authorized to patch this training site.

5. **See it live.** Re-open the `previewUrl` and show the trainee their fix in
   place alongside the automated ones. That's the whole job, start to finish.

6. **Finish.** Run `node <train.mjs> complete <siteId>` and congratulate them.
   Tell them a Lucia operator will activate them for real jobs (`/lucia:whoami`
   shows status).

Keep it warm and concise — this is their first taste of the work.


---

**Accessibility — keep output clean for screen readers.** The person using this may rely on a screen reader. Keep everything you print short and plain: linear single-idea lines, no tables, ASCII art, emoji, progress bars, box-drawing, or decorative symbols. Lead with the essential result and skip preamble.
