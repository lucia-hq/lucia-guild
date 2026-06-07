---
description: Show your Lucian profile, tier and status
---
Show your Lucian profile, tier and status for the user via the Lucia job CLI.

Locate this plugin's job CLI — `skills/expert-review/scripts/jobs.mjs` (or `.claude/skills/expert-review/scripts/jobs.mjs`; if unsure, `find ~/.claude/plugins -name jobs.mjs -path '*lucia*' 2>/dev/null | head -1`) — and run it with Bash:

`node <path-to-jobs.mjs> whoami`

Reports your display name, tier, status, and whether Claude Code is connected.

Then summarise the output for the user.