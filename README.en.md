# DSH Kit suite (dsh-kit)

[简体中文](README.md) | **English**

Verified against official dsh: `0.2.0-rc.2` (adaptation baseline and upgrade procedure: see [docs/02-dsh-facts.md](docs/02-dsh-facts.md) and the `dsh-upgrade` skill)

A third-party **plugin suite** for the official DeepSeek Harness (dsh): 20 components
that improve everyday model, conversation, workspace and runtime workflows. Install or
upgrade everything by entering **one path** in the official dsh plugin manager
("+ Add plugin").

- dsh is never forked or patched; all extensions ride the official plugin mechanism
  (Profile Bundle plus per-row disabling), and dsh upgrades are decoupled
- No remote access: no relay/connector, no project-specific data directory, no
  injected environment variables
- The model HMR bootstrap barrier ships with the suite, so toggling model components
  never hot-restarts `llm-pi-ai`

## Components

Global prompt, egress proxy, Copilot login, model catalog, model capabilities,
favorite models, DeepSeek API switch, turn retry, chat scroll navigation,
session-stats hours, user-message fork, task notifications, tool status,
skill status, file browsing, resident services, interactive terminal,
concise mode, pinned YOLO, web-search switch.
See the [plugin index](docs/plugins.md) and each package README (Chinese).

## Install

1. Install the official dsh desktop app (or run official dsh web on a server).
2. Clone and build this repository:
   ```powershell
   pnpm install
   pnpm plugins:build
   pnpm suite:build      # generates the suite patch and materializes dependencies
   ```
3. dsh → Plugins → Add plugin → enter the absolute path of `plugins/suite`
   → Install → Enable → restart dsh. The restart is required for the suite to take
   effect: when enabling from a dsh process that started before the install, every
   component row defers loading until the restart (a resolvability guard prevents
   `failed to import` errors); on some machines the first enable may additionally
   report one session-controller remount race (a known upstream issue, see
   [roadmap](docs/05-roadmap.md)) which also recovers after the restart.
   To upgrade, rebuild, then uninstall and reinstall.

Installing from a single GitHub repository URL is structurally ready (`file:` relative
dependencies) and will be verified once the repository is public.

Once installed the suite is an ordinary third-party Bundle: disable the whole suite on
the plugins page, or disable individual components inside it. Uninstalling never
re-adds anything.

## Data and configuration

- No project-specific data directory and no environment variables; everything lives in
  dsh's own profile and settings.
- Pinned YOLO is disabled by default; turning on its row switch and restarting removes
  the interactive permission boundary (turning it off and restarting restores native
  permission control). Read [its README](plugins/yolo-mode/README.md) first.

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
