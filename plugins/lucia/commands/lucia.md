---
description: Lucia Guild — log in and work accessibility audit jobs from Claude Code
argument-hint: login | jobs | claim <id> | mine | start <id> | submit <id> | whoami
---

The user wants to run a Lucia Guild action: **$ARGUMENTS**

The Guild is Lucia's marketplace where freelance accessibility experts ("Lucians")
claim customer-paid audit jobs. Drive it through the `expert-review` skill's job
CLI — run the matching command with Bash. The skill is usually at
`.claude/skills/expert-review/`; if `jobs.mjs` isn't there, locate it first.

Map the argument to a command (let `J` = `node .claude/skills/expert-review/scripts/jobs.mjs`):

- `login`            → `J login`   — signs in via the browser, connects this Claude Code to the user's Guild account
- `jobs` / `list`    → `J list`
- `mine`             → `J mine`
- `claim <id>`       → `J claim <id>`
- `start <id>`       → `J start <id>`
- `submit <id>`      → `J submit <id> --findings <N> --net-new <N>`
- `whoami` / empty   → `J whoami`

The first `login` opens the browser to sign in (it caches the token, so later
commands are instant). After running, summarise the output for the user. If they
just claimed and started a job, offer to audit the job's site next with the
`probe` skill, then submit the fixes with the `expert-review` skill.
