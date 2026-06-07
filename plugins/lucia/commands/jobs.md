---
description: List open audit jobs on the Guild board
---
List open audit jobs on the Guild board for the user via the Lucia job CLI.

Locate this plugin's job CLI — `skills/expert-review/scripts/jobs.mjs` (or `.claude/skills/expert-review/scripts/jobs.mjs`; if unsure, `find ~/.claude/plugins -name jobs.mjs -path '*lucia*' 2>/dev/null | head -1`) — and run it with Bash:

`node <path-to-jobs.mjs> list`

Shows each open job's size tier, quote, estimated hours and page counts.

Then summarise the output for the user.