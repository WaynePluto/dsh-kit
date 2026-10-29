# DSH Kit suite (dsh-kit)

[简体中文](README.md) | **English**

Verified against official dsh: `0.2.1-rc.3` (adaptation baseline and upgrade procedure: see [docs/02-dsh-facts.md](docs/02-dsh-facts.md) and the `dsh-upgrade` skill)

A third-party **plugin suite** for the official DeepSeek Harness (dsh): 26 components
that improve everyday model, conversation, workspace and runtime workflows. Install or
upgrade everything by entering **one address** in the official dsh plugin manager
("+ Add plugin").

- dsh is never forked or patched; all extensions ride the official plugin mechanism
  (Profile Bundle plus per-row disabling), and dsh upgrades are decoupled
- No remote access: no relay/connector, no project-specific data directory, no
  injected environment variables
- The suite never overrides official rows: toggling it online never hot-restarts
  upstream services (decision D16)

## Components

Global prompt, egress proxy, Copilot login, model catalog, model capabilities,
favorite models, model provider label, DeepSeek API switch, turn retry, chat scroll
navigation, session-stats hours, user-message fork, session rename, session
workspace indicator, copy workspace path, collapse/focus workspaces, task
notifications, sidebar panel row toggle-back, session park on away, tool status,
skill status, file browsing, resident services, interactive terminal, web-search
switch, suite update checker.
See the [plugin index](docs/plugins.md) and each package README (Chinese).

## Install

dsh → Plugins → Add plugin → enter the download address below → Install →
Enable → restart dsh.

**GitHub install (recommended, no clone needed)**

```text
https://github.com/WaynePluto/dsh-kit/releases/download/v0.0.1/dsh-kit.tar.gz
```

The address has the form `releases/download/<tag>/dsh-kit.tar.gz`; the tag above
is **updated on every release**, and the same kind of address serves both the
first install and upgrades. Upgrading needs no uninstall: paste the new
release's address into "Add plugin" and the suite is replaced in place and
hot-applied (re-entering the same address is refused as already-installed; a new
tag means a new address). Once installed, the **Suite updates** section on the
suite's plugin detail page checks for new releases and copies the upgrade
address for you. Note that the bare repository URL
(`https://github.com/WaynePluto/dsh-kit`) does not work: pnpm treats it as a git
dependency and strips the suite's bundled dependency closure — only the Release
asset above is supported.

**Local directory install (development / offline)**

```powershell
git clone https://github.com/WaynePluto/dsh-kit.git
cd dsh-kit
pnpm install
pnpm plugins:build
pnpm suite:build      # generates the suite patch and materializes dependencies
```

Then enter the **absolute path** of the `plugins/suite` directory in
"Add plugin" (for example `D:\Documents\ai-dev\dsh-kit\plugins\suite`).

**Notes**

- The restart is required for the suite to take effect: when enabling from a dsh
  process that started before the install, every component row defers loading until
  the restart (a resolvability guard prevents `failed to import` errors); on some
  machines the first enable may additionally report one session-controller remount
  race (a known upstream issue, see [roadmap](docs/05-roadmap.md)) which also
  recovers after the restart.
- The suite never touches npm: components are not published to the registry, and the
  GitHub install downloads only from this repository's releases.

Once installed the suite is an ordinary third-party Bundle: disable the whole suite on
the plugins page, or disable individual components inside it. Uninstalling never
re-adds anything.

## Data and configuration

- No project-specific data directory and no environment variables; everything lives in
  dsh's own profile and settings.

## Development

```powershell
pnpm install
pnpm lint && pnpm build && pnpm typecheck && pnpm test && pnpm check:dependencies
pnpm plugins:build && pnpm suite:build      # plugin artifacts + suite patch/closure
pnpm dev                                    # isolated dev instance: profile dsh-kit-dev, port 3180
```

`pnpm dev` uses `~/.dsh-dev` as DSH_HOME and does not touch your daily instance. Always
rebuild and restart dsh after changing either half of a plugin; the profile has no HMR,
so refreshing the page does not pick up new artifacts. Smoke script entry points are
listed in [dsh facts](docs/02-dsh-facts.md).
