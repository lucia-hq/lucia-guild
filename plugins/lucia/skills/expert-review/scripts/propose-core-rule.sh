#!/usr/bin/env bash
# Open a reviewable PR for a CORE-RULE change — the admin-approval gate.
#
# Core rules (Sentinel probes, Loom strategies, Atlas scoring) affect EVERY
# tenant, so a change to one is never committed straight to main. This isolates
# the edit on a `core-rule/<slug>` branch and opens a GitHub PR; the admin
# reviewing + merging that PR IS the approval, and the merge → deploy ships it.
#
# Usage:
#   bash propose-core-rule.sh "<title>" "<body>" <changed-file> [more-files...]
# Run AFTER editing the rule file(s) on a clean main. Only the listed files are
# committed to the branch.
#
# No git remote? It still isolates the change on a branch and tells you how to
# review/merge it locally (the gate holds — main stays clean until you merge).

set -euo pipefail

title="${1:-}"; body="${2:-}"
[ -z "$title" ] && { echo "usage: propose-core-rule.sh <title> <body> <file...>" >&2; exit 2; }
shift 2 || true
[ "$#" -ge 1 ] && [ -n "${1:-}" ] || { echo "error: list at least one changed rule file" >&2; exit 2; }

cd "$(git rev-parse --show-toplevel)"
base="$(git branch --show-current)"
slug="$(printf '%s' "$title" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-*//; s/-*$//' | cut -c1-48)"
branch="core-rule/${slug:-change}"

git switch -c "$branch"
git add -- "$@"
git commit -m "$(cat <<EOF
$title

$body

Core-rule change — affects ALL tenants. Admin approval = reviewing + merging
this branch/PR. Redeploy the owning worker after merge.
EOF
)"

prbody="$body

---
**Blast radius:** core rule — changes detection/scoring for ALL tenants, not one page.
**Deploy:** redeploy the owning worker after merge (e.g. \`pnpm --filter @lucia/sentinel run deploy\`).
**Approval:** merging this PR is the admin sign-off. Prompted by expert review."

if git remote | grep -q .; then
  git push -u origin "$branch"
  gh pr create --base "$base" --head "$branch" --title "$title" --body "$prbody" \
    && echo "✓ PR opened against '$base'. Review + merge to approve, then deploy."
else
  echo ""
  echo "⚠ No git remote configured — can't open a GitHub PR."
  echo "  The core-rule change is isolated on branch '$branch' (main is untouched)."
  echo "  Approve it locally:   git switch $base && git merge --no-ff $branch"
  echo "  Or wire a remote:     git remote add origin <url> && bash $0 ... (re-run)"
fi
echo ""
echo "You're on '$branch'. The change is NOT on '$base' until approved/merged."
