---
description: Sign in to the Lucia Guild and connect this Claude Code
---
Sign in to the Lucia Guild and connect this Claude Code for the user via the Lucia job CLI.

Locate this plugin's job CLI — `skills/expert-review/scripts/jobs.mjs` (or `.claude/skills/expert-review/scripts/jobs.mjs`; if unsure, `find ~/.claude/plugins -name jobs.mjs -path '*lucia*' 2>/dev/null | head -1`) — and run it with Bash:

`node <path-to-jobs.mjs> login`

It opens your browser to sign in, then records the connection so a Lucia operator can activate you.

Then summarise the output for the user.