# Lucia Guild

The **Lucia Guild** is Lucia's marketplace where freelance accessibility experts
("Lucians") claim customer-paid web-accessibility audit jobs and deliver them
straight from their own Claude Code.

This repository is a Claude Code **plugin + marketplace**. Install it and you get:

- a **`/lucia`** command — the Guild job loop (login, browse, claim, start, submit);
- the **`expert-review`** skill — turn a human reviewer's findings document into
  live Lucia fixes (parse findings, locate the element, author a fix, submit);
- the **`probe`** skill — an agentic assistive-technology tester that drives a real
  browser as a screen-reader / keyboard-only / low-vision user to find the
  interaction- and state-dependent WCAG failures scanners can't reach, **verifies
  every finding deterministically**, and proposes live edge fixes.

New to the Guild? Apply at **getlucia.ai/guild**, then run `/lucia login` to connect
your Claude Code. A Lucia operator activates you, and the job board opens up.

## Install

In Claude Code:

```
/plugin marketplace add lucia-hq/lucia-guild
/plugin install lucia@lucia-guild
```

### No `/plugin` command?

`/plugin` lives in the **terminal `claude` CLI** — it isn't exposed in the
**Claude Desktop app** or the VS Code / JetBrains panels, where you'll see
_"/plugin isn't available in this environment."_ Open a real terminal (Terminal,
iTerm, …), start Claude Code, and run the install there:

```bash
claude
# then, inside the session:
#   /plugin marketplace add lucia-hq/lucia-guild
#   /plugin install lucia@lucia-guild
```

If `/plugin` still isn't found in a terminal, update Claude Code
(`npm i -g @anthropic-ai/claude-code@latest`) and restart. Or skip the
marketplace entirely with the manual install below.

### Manual install (no marketplace)

Prefer not to use the marketplace, or can't? Drop the skills and the `/lucia`
command straight into your user-level `~/.claude/`:

```bash
git clone https://github.com/lucia-hq/lucia-guild ~/.lucia-guild
mkdir -p ~/.claude/skills ~/.claude/commands
cp -r ~/.lucia-guild/plugins/lucia/skills/* ~/.claude/skills/
cp ~/.lucia-guild/plugins/lucia/commands/lucia.md ~/.claude/commands/lucia.md
```

Then **restart Claude Code** and run `/lucia login`. To update later:
`git -C ~/.lucia-guild pull`, then re-copy.

### One-time setup for the `probe` skill

The `probe` skill drives a real browser with [Playwright](https://playwright.dev/),
so install its dependencies once:

```
cd plugins/lucia/skills/probe/scripts
npm install
npx playwright install chromium
```

(The `expert-review` skill has no dependencies — it uses Node 18+'s built-in fetch.)

## Workflow

```
/lucia login            # sign in via the browser, connect this Claude Code to your Guild account
/lucia jobs             # see the open jobs on the board
/lucia claim <id>       # claim one (first-come)
/lucia start <id>       # begin work
```

Then audit the job's site and deliver the fixes:

1. **Audit** the site with the `probe` skill — it drives the browser as an AT user,
   verifies each issue, and produces a plan of findings + fixes.
2. **Submit** the fixes with the `expert-review` skill (it previews the plan and
   asks for your explicit approval before publishing anything live).
3. **Hand it to QA:**

   ```
   /lucia submit <id> --findings <N> --net-new <N>
   ```

You can also run `expert-review` on its own when a human reviewer hands you a
findings document (Word / PDF / Markdown / spreadsheet) and a Lucia siteId.

## What's in here

```
.claude-plugin/marketplace.json     the marketplace manifest
plugins/lucia/
├── .claude-plugin/plugin.json      the plugin manifest
├── commands/lucia.md               the /lucia command
└── skills/
    ├── expert-review/              import a reviewer's findings → live fixes
    └── probe/                      agentic AT-user accessibility tester
```

A small, well-formed example plan lives at
`plugins/lucia/skills/expert-review/reference/example-demo.json`, targeting the
public [W3C Before-and-After demo](https://www.w3.org/WAI/demos/bad/before/home.html).

## License

Licensed under the **MIT License** — see [LICENSE](LICENSE). (Swap it for a
different license, or set the copyright holder to your legal entity, before you
publish.)
