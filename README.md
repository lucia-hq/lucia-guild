# Lucia Guild

The **Lucia Guild** is Lucia's marketplace where freelance accessibility experts
("Lucians") claim customer-paid web-accessibility audit jobs and deliver them
straight from their own Claude Code.

This repository is a Claude Code **plugin + marketplace**. Install it and you get:

- a set of **`/lucia:*`** commands — the Guild job loop (`/lucia:login`,
  `/lucia:jobs`, `/lucia:claim`, `/lucia:start`, `/lucia:submit`), plus
  **`/lucia:train`** — a guided first audit on a demo site, runnable before
  you're activated, that ends with your fix live on a preview URL;
- the **`expert-review`** skill — turn a human reviewer's findings document into
  live Lucia fixes (parse findings, locate the element, author a fix, submit);
- the **`probe`** skill — an agentic assistive-technology tester that drives a real
  browser as a screen-reader / keyboard-only / low-vision user to find the
  interaction- and state-dependent WCAG failures scanners can't reach, **verifies
  every finding deterministically**, and proposes live edge fixes.
- the **`bd-outreach`** skill (**`/lucia:prospect`**) — a guided business-development
  journey for active Lucians doing outbound *for* Lucia: pick a market, research a
  shortlist of suitable companies, run real Lucia scans on up to five, and generate
  an evidence-backed pitch email and deck from the before/after results.

New to the Guild? Apply at **getlucia.ai/guild**, then run `/lucia:login` to connect
your Claude Code and **`/lucia:train`** for a guided first audit (no activation
needed). A Lucia operator then activates you, and the job board opens up.

## Install

Lucia runs in **Claude Code in a terminal** (Terminal, iTerm, or your IDE's
integrated terminal). In a terminal session:

```
/plugin marketplace add https://github.com/lucia-hq/lucia-guild.git
/plugin install lucia@lucia-guild
```

Run each line on its own and let it finish before the next. The full `https://….git`
URL matters: the `owner/repo` shorthand makes Claude Code clone over **SSH**, which
fails if you don't have GitHub SSH keys (`Permission denied (publickey)`) — HTTPS
needs none for a public repo.

**Updating to the latest** — three steps, *in this order*:

```
/plugin marketplace update lucia-guild
/plugin update lucia@lucia-guild
/reload-plugins
```

The first step matters and is easy to skip. The plugin lives *inside* the
marketplace repo, and `/plugin update` only compares your install against your
**local catalog clone** — not GitHub. So if you skip `/plugin marketplace update`,
`/plugin update` reports *"already at the latest version"* against a stale copy and
fetches nothing. `marketplace update` git-pulls the catalog, `update` re-points your
install at it, `reload-plugins` loads it into the running session. The plugin isn't
version-pinned, so the catalog's newest commit is always the latest build.

### Using the desktop app (Cowork)?

Cowork runs Claude Code in a remote sandbox, so `/lucia:login` — which signs you in
through a loopback to a browser on *your* machine — can't complete there yet. **Use
Claude Code in a terminal** for now; that's where sign-in works. (You can browse and
install the plugin from Cowork's **Customize → Plugins**, but you'll still need a
terminal to log in and work jobs.)

### No `/plugin` command in a terminal?

Update Claude Code (`npm i -g @anthropic-ai/claude-code@latest`) and restart — or
use the manual install below. (`~/.claude/skills/` is shared between the terminal
CLI and Cowork, so either install shows up in both.)

### Manual install (no marketplace)

Prefer not to use the marketplace, or can't? Drop the skills and the `/lucia:*`
commands straight into your user-level `~/.claude/`:

```bash
git clone https://github.com/lucia-hq/lucia-guild ~/.lucia-guild
mkdir -p ~/.claude/skills ~/.claude/commands/lucia
cp -r ~/.lucia-guild/plugins/lucia/skills/* ~/.claude/skills/
cp ~/.lucia-guild/plugins/lucia/commands/*.md ~/.claude/commands/lucia/
```

Then **restart Claude Code** and run `/lucia:login` (the `lucia/` command
subfolder groups them under `/lucia:`). To update later:
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
/lucia:login            # sign in via the browser, connect this Claude Code to your Guild account
/lucia:jobs             # see the open jobs on the board
/lucia:claim <id>       # claim one (first-come)
/lucia:start <id>       # begin work
```

Then audit the job's site and deliver the fixes:

1. **Audit** the site with the `probe` skill — it drives the browser as an AT user,
   verifies each issue, and produces a plan of findings + fixes.
2. **Submit** the fixes with the `expert-review` skill (it previews the plan and
   asks for your explicit approval before publishing anything live).
3. **Hand it to QA:**

   ```
   /lucia:submit <id> --findings <N> --net-new <N>
   ```

You can also run `expert-review` on its own when a human reviewer hands you a
findings document (Word / PDF / Markdown / spreadsheet) and a Lucia siteId.

## What's in here

```
.claude-plugin/marketplace.json     the marketplace manifest
plugins/lucia/
├── .claude-plugin/plugin.json      the plugin manifest
├── commands/                       the /lucia:* commands (login, jobs, claim, start, submit, …)
└── skills/
    ├── expert-review/              import a reviewer's findings → live fixes
    ├── probe/                      agentic AT-user accessibility tester
    └── bd-outreach/                guided outbound BD: shortlist → scan → pitch
```

A small, well-formed example plan lives at
`plugins/lucia/skills/expert-review/reference/example-demo.json`, targeting the
public [W3C Before-and-After demo](https://www.w3.org/WAI/demos/bad/before/home.html).

## License

Licensed under the **MIT License** — see [LICENSE](LICENSE). (Swap it for a
different license, or set the copyright holder to your legal entity, before you
publish.)
