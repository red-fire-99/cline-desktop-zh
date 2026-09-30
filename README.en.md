# Cline Desktop ZH — Chinese UI for Cline Desktop (unofficial)

> Adds a **Chinese interface** to the official **Cline Desktop** app (Windows, Tauri + WebView2).
> It translates the UI at **runtime** through the local WebView2 debugging channel —
> **no official file is modified**, so Cline's auto-update keeps working.

- 🚀 **One-step install**: double-click `launcher\setup.cmd` — it downloads a portable Node.js
  (no admin rights, nothing written to the registry).
- 🌏 **2097 dictionary entries** (2010 exact + 87 regex) merged from 4 open-source projects — see [NOTICE.md](NOTICE.md);
  you can override any entry via `dict/overrides.json`.
- 🈶 **Windowless launcher**: a “Cline 中文版” desktop shortcut (double-click and go).
- 🔁 **Switch back anytime**: launching the original Cline icon still gives you the English UI.
- 🧩 **Extensible dictionary**: find missing strings, add translations, hot-apply without restart.
- ✅ **Tested on**: Cline Desktop 0.0.37 / Windows 11 / WebView2 140 (injection chain verified end-to-end on a headless Chromium).

## How it works

1. The launcher sets `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223 --lang=zh-CN`
   for the Cline process only (the port listens on `127.0.0.1` locally).
2. A background injector (`tools/cline-zh.mjs`, run by a bundled Node.js) connects over CDP and injects
   the dictionary plus `tools/translator.js` into the UI page, re-injecting every ~2 s as a safety net.
3. The translator rewrites text nodes and `placeholder / title / aria-label / alt / data-tooltip`
   attributes, and skips `pre / code / textarea / [contenteditable]` — chat content, code blocks and
   your input are never touched.
4. When Cline exits, the injector exits too (no leftover processes).

## Install

1. Download this repository (`git clone` or “Download ZIP” and extract it to any writable folder).
2. Double-click **`launcher\setup.cmd`** — it downloads portable Node.js (~40 MB from nodejs.org,
   falling back to the npmmirror mirror) and creates the desktop / start-menu shortcut.
3. Double-click the **“Cline 中文版”** shortcut to start Cline with the Chinese UI.

Manual alternative:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\launch.ps1   # or wscript .\launcher\cline-zh.vbs
```

## Daily use

| I want to… | Do this |
| --- | --- |
| Use the Chinese UI | Double-click the “Cline 中文版” shortcut (or `launcher\cline-zh.vbs`) |
| Use the English UI | Start Cline from the original icon |
| Check whether injection works | `launcher\status.cmd` |
| Troubleshoot startup | `launcher\cline-zh-debug.cmd` (visible injector log) |
| Find untranslated strings | Leave Cline on that page and run `launcher\find-missing.cmd` |
| Apply dictionary edits instantly | `launcher\hot-apply-dict.cmd` (no restart) |
| Rebuild the dictionary | `launcher\fetch-sources.cmd` → `launcher\rebuild-dict.cmd` |
| Stop the background injector | `launcher\stop-injector.cmd` |

Logs: `logs\injector.out.log`, `logs\injector.err.log`.

## Repository layout

```
launcher/   user-facing entry points (windowless vbs + cmd wrappers)
scripts/    PowerShell implementation (launch / setup / shortcuts / status / fetch-sources)
tools/       Node tools: injector (cline-zh.mjs), translator.js, dict builder, coverage report, validators
dict/        zh-cn.json (merged dictionary) + overrides.json (local overrides)
test/       e2e self-test using a headless Chromium (injection chain verification)
licenses/   full license texts of upstream projects
config.json debug port (default 9223) and browser language
```

`node/` (runtime), `vendor/` (dictionary sources) and `logs/` are generated locally and git-ignored.

## Dictionary

- Entry formats:
  - exact: `"Settings": "设置"`
  - regex (key starts with `^`): `"^Thought for (\\d+)s$": "思考了 $1 秒"`
  - case-insensitive regex: `"(?i)^(\\d+) available$": "$1 个可用"`
- Merge order (later wins): official i18n resources < JACK5920 < aaxianyu < Seventy73. See `NOTICE.md`.

Add missing strings:

1. Open the page in Cline, run `launcher\find-missing.cmd` → `tools/out/todo.txt`
2. Add `"English": "中文"` entries to `dict\zh-cn.json`
3. Run `launcher\hot-apply-dict.cmd`

## Troubleshooting

- **Still English after launch** — you probably started Cline from the original icon (no debug port).
  Quit Cline completely and start it via the “Cline 中文版” shortcut; check `logs\injector.err.log`.
- **“Cannot connect to the debugging port”** — Cline is already running without the port; quit it first.
- **The tray context menu stays English** — it is a native Tauri menu, not part of the web page.
- **Port already in use** — change `port` in `config.json` (all tools read it).

## Uninstall

Delete this folder and the desktop/start-menu shortcut. Cline itself and its settings are untouched.

## Development

```powershell
node tools\validate.mjs                       # dictionary + script self-check (also runs in CI)
powershell -File .\test\e2e.ps1               # end-to-end injection test (needs Edge/Chrome)
powershell -File .\scripts\launch.ps1 -DryRun # show what the launcher would do, change nothing
```

## Will it survive Cline updates?

**Yes.** Nothing in the official installation is modified — translations are applied at runtime — so Cline's
auto-update works normally (no signature/hash issues).

After an update, do this 2-minute check:

1. Quit Cline and start it again via the “Cline 中文版” shortcut (an updated app that restarts itself loses the debug port).
2. Run `launcher\status.cmd` and read the coverage report.

| Symptom | Cause | Fix |
| --- | --- | --- |
| UI back to English | The update restarted Cline without the debug port | Quit Cline, launch via the Chinese shortcut |
| A few new English strings | New copy in the new version | `launcher\find-missing.cmd` → add to `dict\overrides.json` → `launcher\hot-apply-dict.cmd` |
| Report says “translator not mounted” | Not started via the launcher, or Cline changed UI framework | Launch via the shortcut; check `logs\injector.err.log` |

## Publishing this repository (maintainers)

The publishing tooling is generic (not Cline-specific) and now lives in its own project,
**git-publish-wizard** — a guided “double-click and answer a few questions” publisher for any local git
repository, including a GitHub API channel for networks where `github.com` is unreachable.

```powershell
# publish this repository
powershell -File <git-publish-wizard>\publish-github.ps1 -RepoDir <this repo>

# network-restricted alternative (identical commit SHAs)
powershell -File <git-publish-wizard>\publish-github-api.ps1 -RepoDir <this repo>
```

## Disclaimer & License

Unofficial community project; not affiliated with Cline ([cline.bot](https://cline.bot)).
It does not redistribute or modify any official binary. Licensed under **MIT**;
upstream attributions and licenses are listed in [NOTICE.md](NOTICE.md) and `licenses/`.
