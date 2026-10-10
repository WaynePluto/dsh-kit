# DSH Station suite (dsh-remote)

[简体中文](README.md) | **English**

Verified against official dsh: `0.2.0-rc.2` (plugin adaptation baseline and upgrade procedure: see [docs/02-dsh-facts.md](docs/02-dsh-facts.md) and the `dsh-upgrade` skill)

A **single-package plugin suite** for the official DeepSeek Harness (dsh). There is no
standalone desktop app or release media any more (decision D27): install or upgrade
everything — remote access plus 22 feature components — by entering **one path** in the
official dsh plugin manager ("+ Add plugin").

- dsh is never forked or patched; all extensions ride the official plugin mechanism,
  and dsh upgrades are decoupled from this project
- Remote access bootstraps itself inside the plugin: the `remote-runtime` component
  spawns relay and connector from the dsh host (two-level detached launchers that
  survive host process-tree kills and are re-claimed after restarts), hands the dsh
  login token over via a file, and injects trustedHosts into the connection row —
  **no separate launcher**
- Remote semantics unchanged: exposed machines never listen on public ports and dial
  out instead; every non-loopback browser visit requires login (password + TOTP);
  the entry machine routes to each machine's dsh

## Install

1. Install the official dsh desktop app (or run official dsh web on a server).
2. Clone and build this repository:
   ```powershell
   pnpm install
   pnpm plugins:build
   node scripts/build-suite.mjs   # generates the suite patch and materializes deps
   ```
3. dsh → Plugins → Add plugin → enter the absolute path of `packages/plugins/suite`
   → Install → Enable → restart dsh. To upgrade, rebuild, then uninstall and reinstall.

Installing from a single GitHub repository URL is structurally ready (`file:` relative
dependencies) and will be verified once the repository is public.

## Runtime data and configuration

- Data directory `~/.dsh-remote`: relay database, device keys, membership, dsh-token,
  process registry and logs (`logs/`)
- See [packaging/dsh-remote.config.example.json](packaging/dsh-remote.config.example.json)
  (place at `~/.dsh-remote/dsh-remote.config.json`; LAN mode and relay port 30809 by default)
- Known limitation: after changing the remote entry, restart dsh manually so the new
  trustedHosts take effect (a plugin cannot restart its own host)

## Components

Remote settings, model catalog/capabilities/favorites, Copilot login, egress proxy,
global prompt, conversation retry/scroll/fork, concise mode (native tools plus run_code programs),
pinned YOLO, resident services, interactive terminal, tool/skill history, file browsing,
web directory picker, browser-compat shims, desktop notifications, web-search switch.
See the [plugin index](docs/plugins.md) (Chinese).

## Development

```powershell
pnpm install
pnpm lint && pnpm build && pnpm typecheck && pnpm test   # same as CI
pnpm plugins:build && node scripts/build-suite.mjs       # suite artifact
pnpm dev                                                  # legacy dev stack (transitional)
```

Always rebuild and restart dsh after changing either half of a plugin; smoke scripts are
listed in [dsh facts](docs/02-dsh-facts.md). The feasibility probe and desktop-verified
findings live in [spike/remote-probe/README.md](spike/remote-probe/README.md).
