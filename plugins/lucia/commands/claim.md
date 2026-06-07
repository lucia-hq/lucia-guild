---
description: Claim an open job (first-come)
argument-hint: <jobId>
---
Claim an open job (first-come) for the user via the Lucia job CLI.

Locate this plugin's job CLI — `skills/expert-review/scripts/jobs.mjs` (or `.claude/skills/expert-review/scripts/jobs.mjs`; if unsure, `find ~/.claude/plugins -name jobs.mjs -path '*lucia*' 2>/dev/null | head -1`) — and run it with Bash:

`node <path-to-jobs.mjs> claim $ARGUMENTS`

The argument is the job id from `/lucia:jobs`.

Then summarise the output for the user.