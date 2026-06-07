#!/usr/bin/env bash
# First-run welcome for the Lucia Guild plugin. On the first session after
# install, surfaces a one-time orientation via SessionStart additionalContext,
# then writes a marker so it never repeats. Silent on every later session.
set -euo pipefail

MARKER="${HOME}/.lucia/welcomed"
[ -f "$MARKER" ] && exit 0
mkdir -p "$(dirname "$MARKER")" 2>/dev/null || true
: > "$MARKER" 2>/dev/null || true

MSG="The Lucia Guild plugin is installed. Greet the user warmly and tell them, in two short sentences: start with /lucia:login to connect, then /lucia:train for a guided first audit — you spin up a demo site, watch Lucia auto-remediate it, fix one issue yourself, and see it live, all before activation. Mention /lucia:welcome shows the full command list (login, train, whoami, jobs, claim, start, submit)."

if command -v jq >/dev/null 2>&1; then
  jq -n --arg c "$MSG" '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$c}}'
else
  esc=${MSG//\"/\\\"}
  printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$esc"
fi
