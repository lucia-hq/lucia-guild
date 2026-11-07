---
description: Start a job you've claimed, or resume one QA sent back for rework
argument-hint: <jobId>
---
Start work on a job you've claimed for the user via the Lucia job CLI.

Locate this plugin's job CLI — `skills/expert-review/scripts/jobs.mjs` (or `.claude/skills/expert-review/scripts/jobs.mjs`; if unsure, `find ~/.claude/plugins -name jobs.mjs -path '*lucia*' 2>/dev/null | head -1`) — and run it with Bash:

`node <path-to-jobs.mjs> start $ARGUMENTS`

Moves the job to in_progress (a claimed job must be started within 10 minutes of claiming, or it returns to the board). If the job came back from QA for rework, show the user QA's notes (from `node <path-to-jobs.mjs> mine`) before continuing. Offer to audit the site next with the `probe` skill.

Then summarise the output for the user.