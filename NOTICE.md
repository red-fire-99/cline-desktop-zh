# 参考来源与许可（NOTICE）

本项目（Cline 桌面版中文界面工具）以 **MIT** 许可证发布，但其中包含/改编了以下开源项目的内容，
在此逐一致谢并声明许可。上游完整许可证文本见 `licenses/` 目录。

## 1. 代码来源

| 上游项目 | 本项目中的用途 | 许可证 |
| --- | --- | --- |
| [aaxianyu/cline-desktop-chinese](https://github.com/aaxianyu/cline-desktop-chinese) | `tools/cline-zh.mjs`（注入器）、`tools/translator.js`（翻译脚本）、`tools/find.mjs`、`tools/apply-dict.mjs`、`tools/ui-check.mjs`、`tools/harvest-*.mjs`、`tools/scan-runtime.mjs` 的原始实现 | MIT |
| [Seventy73-oss/cline-desktop-cn](https://github.com/Seventy73-oss/cline-desktop-cn) | 词典来源之一（`extension/dict.json`、`extension/rules.json`）；启动器/CDP 思路参考 | MIT |
| [JACK5920/cline-desktop-zh](https://github.com/JACK5920/cline-desktop-zh) | 词典来源之一（`dictionary.json` 的 texts/attrs/patterns）；静默启动思路参考 | MIT |
| [HybridTalentComputing/cline-chinese](https://github.com/HybridTalentComputing/cline-chinese) | 词典来源之一：官方 webview 的 `webview-ui/src/locales/{en,zh-CN}/*.json` i18n 资源（按 key 配对生成英中对照） | Apache-2.0（Cline 上游项目为 Apache-2.0） |
| [Node.js](https://nodejs.org/) | 由 `scripts/setup.ps1` 在安装时下载的便携运行环境（**不随仓库分发**） | MIT |

## 2. 本项目自有内容

以下文件由本项目编写/生成，采用仓库根目录 `LICENSE`（MIT）：

- `tools/config.mjs`、`tools/validate.mjs`、`tools/build-dict.mjs`、`tools/report.mjs`
- `dict/zh-cn.json`（由上述来源合并、去重、清洗生成的衍生词典）、`dict/overrides.json`（本地覆盖词条）
- `launcher/`、`scripts/`、`test/` 下的脚本
- `README.md`、`README.en.md`、`CHANGELOG.md`、本文件

## 3. 词典（dict/zh-cn.json）说明

词典是上述上游词条（MIT / Apache-2.0）的聚合衍生作品，合并脚本为 `tools/build-dict.mjs`：
按 `Seventy73 > aaxianyu > JACK5920 > 官方 i18n` 的优先级覆盖同名原文，
并过滤明显非界面文案（URL、路径、模板占位符等）。因此词典整体按 MIT 分发，
其中来源于 HybridTalentComputing/cline-chinese 的 i18n 文本沿用其 Apache-2.0 许可。

## 4. 与 Cline 官方的声明

本项目为社区非官方项目，与 Cline 官方（[cline.bot](https://cline.bot)、[cline/cline](https://github.com/cline/cline)）
无任何隶属关系，不提供官方支持，也不分发或修改任何官方程序文件。
工具仅通过 WebView2 的本机调试通道在运行时替换界面文本。
