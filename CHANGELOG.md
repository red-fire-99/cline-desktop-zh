# 更新记录

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [v1.0.0] — 2026-09-30

首个版本：Cline 桌面版（Windows）运行时中文界面工具。

**下载**：GitHub Release 提供两个压缩包
- `cline-desktop-zh-v1.0.0-full.zip`：含便携 Node.js（约 40MB），解压即用、可离线
- `cline-desktop-zh-v1.0.0-slim.zip`：不含 Node.js（约 250KB），首次运行自动下载

**功能**

- 通过 WebView2 本机 CDP 调试通道注入翻译脚本，运行时替换界面文案；不修改任何官方文件，官方自动更新不受影响。
- 词典 2097 条（精确 2010 + 正则 87），合并自 4 个开源来源，见 `NOTICE.md`；另提供 `dict/overrides.json` 作为最高优先级的本地覆盖。
- 无黑框启动器（`launcher/cline-zh.vbs` → `scripts/launch.ps1`），自动定位官方客户端、必要时询问重启、后台静默启动注入器。
- 内置 `scripts/setup.ps1`：一键下载便携 Node.js（nodejs.org，失败回退 npmmirror），无需管理员权限。
- 配套工具：状态检查、漏翻查找、词典热更新、词典重建、来源下载、调试窗口启动。
- `tools\report.mjs`：界面汉化覆盖报告（中文占比 + 漏翻清单，写入 `tools\out\coverage-report.txt`）。
- `dict\overrides.json`：本地覆盖词条（最高优先级，不被词典重建覆盖）。
- 端到端自测：`test/e2e.ps1` 使用本机 Edge/Chrome 无头实例验证“注入 → 翻译”全链路。
- CI：`tools/validate.mjs` 校验词典与脚本（GitHub Actions）。

**已实测环境**

- Cline 桌面版 0.0.37（Windows 11，WebView2 Runtime 140）
- 注入链在 Chromium 内核（Edge headless）端到端验证通过

**已知限制**

- 托盘原生右键菜单（New Session / Settings / Quit）不经过网页，仍为英文。
- 聊天内容、代码块、输入框内容不会被翻译（刻意跳过 `pre / code / textarea / [contenteditable]`）。
- 官方大版本更新后可能出现新文案未覆盖，可用 `launcher/find-missing.cmd` 补齐词典。
