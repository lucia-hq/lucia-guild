---
description: Submit a finished job for QA review
argument-hint: <jobId> --findings N --net-new N [--minutes N]
---
Submit a finished job for QA review for the user via the Lucia job CLI.

Locate this plugin's job CLI — `skills/expert-review/scripts/jobs.mjs` (or `.claude/skills/expert-review/scripts/jobs.mjs`; if unsure, `find ~/.claude/plugins -name jobs.mjs -path '*lucia*' 2>/dev/null | head -1`) — and run it with Bash:

`node <path-to-jobs.mjs> submit $ARGUMENTS`

Pass the job id and the finding counts; `--minutes` records the actual time spent.

Then summarise the output for the user.