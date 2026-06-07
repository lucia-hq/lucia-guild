---
description: Scored training audit — find the accessibility issues on a demo site; you're graded, and passing is required before activation
argument-hint: ""
---

Run the Lucia Guild **training assessment**. The trainee audits a deliberately-
broken demo site; you score their findings against a hidden key (server-side, so
they can't read it) and record the result. **A passing score is required** before
a Lucia operator can activate them.

**Accessibility:** the person doing this may rely on a screen reader. Keep
everything you print short, plain, and linear — no tables, ASCII art, emoji, or
decorative symbols. Lead with the key result.

Locate this plugin's training CLI `skills/expert-review/scripts/train.mjs` and the
`probe` skill (both in this plugin; if unsure,
`find ~/.claude/plugins -name train.mjs -path '*lucia*'`).

Steps:

1. **Set the task — don't give it away.** Tell the trainee: "Here's a website.
   Audit it for accessibility problems and tell me what you find." The site is
   **https://getlucia.ai/training-demo**. Do NOT say how many issues there are,
   what categories they fall in, or that the page is special in any way. This is
   their test.

2. **Let them find and explain first.** Ask the trainee what problems they
   notice and to explain *why* each is a barrier (who it affects). Let them lead.
   Then use the **`probe`** skill to drive a real browser over the page and
   confirm/expand — but don't just hand them the answers; coach.

3. **Collect findings.** Build a list of what they (with probe) identified. For
   each: the element's CSS selector if you have one, a category (image-alt,
   label, contrast, link-text, button-name, link-name, keyboard, aria, dialog,
   heading-order, landmark, skip-link, table-headers, lang, title), and the WCAG
   criterion if known. Write it to a temp JSON file — an array of
   `{ "selector": "...", "category": "...", "wcag": "...", "note": "..." }`.

4. **Score it.** Run:
   `node <train.mjs> score --file <that-file.json>`
   Report the result plainly: their score out of 100, pass or not, how many of
   the issues they caught, recall and precision.

5. **Teach from the misses.** The command prints what they MISSED (revealed only
   now, after they've submitted — never before). Walk through each missed issue
   briefly: what it is, who it affects, how you'd fix it.

6. **Close.** If they passed, tell them they've met the training requirement and
   a Lucia operator will activate them. If not, encourage another attempt focused
   on the categories they missed — they can re-run any time.

Be encouraging and concise. This is an assessment, but also their first lesson.
