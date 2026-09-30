# Cline 桌面版中文界面 · cline-desktop-zh

> 给官方 **Cline 桌面版**（Windows，Tauri + WebView2）加上中文界面。
> 通过本机 CDP 调试通道在**运行时**替换界面文案 —— **不修改任何官方文件**，官方自动更新不受影响。

[English](README.en.md) | 简体中文

- 🚀 **安装一步到位**：双击 `launcher\setup.cmd`，自动下载便携版 Node.js（不需要管理员权限、不写注册表）
- 🌏 **词典 2097 条**（精确 2010 + 正则 87），由 4 个开源汉化项目的词典合并去重而来（见 [NOTICE.md](NOTICE.md)），并可用 `dict/overrides.json` 自行覆盖
- 🈶 **无黑框启动**：桌面快捷方式「Cline 中文版」双击即用
- 🔁 **随时切回英文**：用原来的 Cline 图标启动就是英文原版
- 🧩 **可自行扩充词典**：漏翻文案可一键抓取 → 热更新，无需重启
- ✅ **实测环境**：Cline 桌面版 0.0.37 / Windows 11 / WebView2 140（注入链已在 Chromium 内核端到端自测通过）

## 工作原理

```
┌────────────────────┐   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=
│ launcher/cline-zh  │   --remote-debugging-port=9223 --lang=zh-CN
│  .vbs → launch.ps1 │──────────►┌───────────────────────────────┐
└────────────────────┘           │ cline-app.exe（官方原版）      │
          │                       │   └─ WebView2 界面（内嵌 UI）  │
          │ 隐藏窗口启动            └───────────────────────────────┘
          ▼                                        ▲
┌────────────────────┐    CDP（仅本机回环）        │ 注入 词典 + translator.js
│ tools/cline-zh.mjs │────────────────────────────┘ 文本/属性实时替换 + MutationObserver
│  （注入器 / Node） │    每 2 秒兜底重注入；Cline 退出后自动结束
└────────────────────┘
```

1. 启动器只对 Cline 进程设置环境变量，为其 WebView2 打开一个**仅监听 127.0.0.1** 的调试端口；
2. 后台注入器连接该端口，把词典与翻译脚本注入界面页面；
3. 翻译脚本按词典替换文本节点以及 `placeholder / title / aria-label / alt / data-tooltip` 属性，
   并跳过 `pre / code / textarea / [contenteditable]` —— **聊天内容、代码块、你的输入不会被改动**；
4. Cline 关闭后注入器自动退出，不留后台进程。

## 安装

### 方式一：一键安装（推荐）

1. 下载本仓库（`git clone`，或 Download ZIP 后解压到任意可写目录）；
2. 双击 **`launcher\setup.cmd`** —— 自动下载便携 Node.js（约 40MB，来自 nodejs.org，失败自动回退 npmmirror 镜像）并创建快捷方式；
3. 桌面出现 **「Cline 中文版」** 快捷方式，双击即可用中文界面启动 Cline。

> 若 Cline 正在以英文模式运行，启动器会弹窗询问是否关闭并重新以中文模式启动。

### 方式二：手动

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1
# 之后每次启动：wscript .\launcher\cline-zh.vbs   （或直接双击该 vbs）
```

## 日常使用

| 我想…… | 怎么做 |
| --- | --- |
| 用中文界面 | 双击桌面「Cline 中文版」（或 `launcher\cline-zh.vbs`） |
| 用英文原版 | 直接用原来的 Cline 图标启动 |
| 检查汉化是否生效 | `launcher\status.cmd` |
| 排查启动问题 | `launcher\cline-zh-debug.cmd`（可见注入日志） |
| 找漏翻的文案 | 把 Cline 停在对应页面，运行 `launcher\find-missing.cmd` |
| 改完词典立即生效 | `launcher\hot-apply-dict.cmd`（无需重启） |
| 重新合并词典 | `launcher\fetch-sources.cmd` → `launcher\rebuild-dict.cmd` |
| 关闭后台注入器 | `launcher\stop-injector.cmd` |
| 发布/更新到 GitHub | `launcher\publish-github.cmd`（向导式，见下文） |
| 网络受限时的发布 | `launcher\publish-github-api.cmd`（走 API 通道，见下文） |

日志位置：`logs\injector.out.log` / `logs\injector.err.log`。

## 目录结构

```
.
├─ launcher/                 # 用户双击的入口（vbs + cmd 包装）
│   ├─ cline-zh.vbs          #   无黑框启动器（转调 scripts\launch.ps1）
│   ├─ cline-zh-debug.cmd    #   调试窗口启动（可见日志）
│   ├─ setup.cmd             #   安装便携 Node.js + 创建快捷方式
│   ├─ status.cmd            #   汉化状态检查
│   ├─ find-missing.cmd      #   查找当前页面的漏翻文案
│   ├─ hot-apply-dict.cmd    #   词典热更新（无需重启）
│   ├─ rebuild-dict.cmd      #   重新合并词典
│   ├─ fetch-sources.cmd     #   下载词典来源到 vendor/
│   ├─ publish-github.cmd    #   向导式一键发布到 GitHub
│   ├─ create-shortcuts.cmd  #   重新创建快捷方式
│   └─ stop-injector.cmd     #   结束后台注入器
├─ scripts/                  # PowerShell 实现
│   ├─ launch.ps1            #   启动器主逻辑（-DryRun 可只打印计划）
│   ├─ setup.ps1             #   下载便携 Node.js（nodejs.org / npmmirror）
│   ├─ fetch-sources.ps1     #   下载词典来源
│   ├─ create-shortcuts.ps1  #   创建桌面 / 开始菜单快捷方式
│   ├─ status.ps1            #   状态检查
│   ├─ publish-github.ps1    #   一键发布到 GitHub（-SelfTest 可离线自检）
│   └─ stop-injector.ps1     #   结束后台注入器
├─ tools/                    # Node 工具（注入器 / 翻译脚本 / 词典维护）
│   ├─ cline-zh.mjs          #   注入器：run / dump / verify / kill
│   ├─ translator.js         #   注入页面的 DOM 翻译脚本
│   ├─ config.mjs            #   读取 config.json（端口 / 语言）
│   ├─ build-dict.mjs        #   合并 vendor/ 各来源 → dict/zh-cn.json
│   ├─ validate.mjs          #   仓库自检（CI 使用）
│   ├─ find.mjs              #   查找漏翻文案 → tools/out/todo.txt
│   ├─ apply-dict.mjs        #   热更新词典到运行中的实例
│   ├─ ui-check.mjs          #   检查界面骨架英文残留
│   ├─ report.mjs            #   汉化覆盖报告（中文占比 + 漏翻清单）
│   └─ harvest-*.mjs / scan-runtime.mjs   # 各界面文案采集器
├─ dict/zh-cn.json           # 词典（精确 + 正则词条）
├─ test/                     # 端到端自测（无头 Chromium 验证注入链）
├─ config.json               # 调试端口（默认 9223）与浏览器语言
├─ licenses/                 # 上游项目许可证全文
└─ NOTICE.md                 # 来源与许可说明
```

运行环境 `node/`、词典来源快照 `vendor/`、日志 `logs/`、采集输出 `tools/out/` 均为本地生成，已被 `.gitignore` 排除。

## 词典

- 词条格式（`dict/zh-cn.json`）：
  - 精确匹配：`"Settings": "设置"`
  - 正则词条（key 以 `^` 开头，替换支持 `$1`）：`"^Thought for (\\d+)s$": "思考了 $1 秒"`
  - 忽略大小写的正则：`"(?i)^(\\d+) available$": "$1 个可用"`
- 合并优先级（后者覆盖前者）：
  官方 i18n 资源（HybridTalentComputing/cline-chinese）
  < JACK5920/cline-desktop-zh < aaxianyu/cline-desktop-chinese < Seventy73-oss/cline-desktop-cn
- 合并脚本会自动过滤 URL、路径、模板占位符等非文案，并在词条数异常偏少时拒绝覆盖（防止把词典写坏）。
- 详细来源与许可证见 [NOTICE.md](NOTICE.md)。

### 扩充词典

1. 把 Cline 停在没翻译的页面（下拉菜单/弹窗可保持展开），运行 `launcher\find-missing.cmd`；
2. 打开 `tools\out\todo.txt`，把译文按格式填进 `dict\zh-cn.json`（或把清单发到 Issue 让别人帮忙翻）；
3. 运行 `launcher\hot-apply-dict.cmd` —— 立即生效，无需重启。

## 常见问题

- **启动后仍是英文**：多半是用原来的 Cline 图标启动的（没有调试端口）。先完全退出 Cline，再用「Cline 中文版」快捷方式启动；仍不行请查看 `logs\injector.err.log`。
- **提示“无法连接调试端口”**：Cline 已经在运行且未带端口。完全退出后重新用启动器启动。
- **托盘右键菜单（New Session / Settings / Quit）还是英文**：它是 Tauri 原生菜单，不经过网页，无法通过 DOM 替换，属已知限制。
- **端口被占用**：修改 `config.json` 里的 `port`（所有工具与启动器都会读取它）。
- **公司电脑禁止下载**：可手动把 Node.js 解压到仓库的 `node\` 目录（要求 `node\node.exe` 存在），再运行启动器。

## 已知限制

- 仅支持 **Windows**（依赖 WebView2 的 CDP 通道与 Windows 脚本宿主）。
- 托盘原生菜单、系统级弹窗（如文件选择器）保持英文。
- 聊天内容、代码块、输入框内容不会被翻译（刻意跳过）。
- 官方大版本更新后可能出现新文案未覆盖，用 `launcher\find-missing.cmd` 补齐即可；注入机制本身不受影响。

## 卸载

1. 关闭 Cline；
2. 删除本仓库目录，以及桌面 / 开始菜单的「Cline 中文版」快捷方式；
3. Cline 本体、设置与数据完全不受影响（用原图标启动即回到英文）。

## 开发 / 自测

```powershell
# 词典 + 脚本 + 关键文件自检（CI 也会跑）
.\node\node.exe tools\validate.mjs

# 端到端注入测试：临时开无头 Edge/Chrome 验证“注入 → 翻译”全链路，跑完自动关闭
powershell -NoProfile -ExecutionPolicy Bypass -File .\test\e2e.ps1

# 启动器干跑：只打印将要执行的动作，不做任何改动
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\launch.ps1 -DryRun
```

## Cline 更新后还能用吗？

**能用。** 本工具不碰官方任何文件，只在运行时替换界面文字，所以官方自动更新照常进行（不涉及签名/哈希问题）。

更新后按这个顺序确认一下（每次大版本更新花 2 分钟）：

```powershell
# 1) 先用「Cline 中文版」快捷方式重新启动一次
# 2) 看覆盖报告
launcher\status.cmd
```

| 现象 | 原因 | 怎么办 |
| --- | --- | --- |
| 更新后界面变回英文 | 官方更新重启了应用，新实例没带调试端口 | 退出 Cline，用「Cline 中文版」快捷方式再启动一次 |
| 界面有少量新英文 | 新版本新增了文案，词典里还没有 | `launcher\find-missing.cmd` 抓漏翻 → 填进 `dict\overrides.json` → `launcher\hot-apply-dict.cmd`（立刻生效，不用等发版） |
| `status.cmd` 显示「翻译器已挂载：否」 | 这次启动没走启动器，或 Cline 换了 UI 框架/不再用 WebView2 | 先确认用启动器启动；仍失败请看 `logs\injector.err.log`，这种情况才需要更新工具本身 |

想提前验证，也可以在开发环境跑一次自测（不开 Cline）：`powershell -File .\test\e2e.ps1`。

## 发布到 GitHub（傻瓜向导）

**第 1 步：双击** `launcher\publish-github.cmd`

**第 2 步：照着回答问题**（每个都有默认值，直接按回车就行）

1. 你的名字/昵称、邮箱 → 决定提交记录里显示的作者
2. 你的 GitHub 用户名
3. 仓库名（默认 `cline-desktop-zh`）
4. 公开 `public` / 私有 `private`

**第 3 步：选 A 或 B 决定怎么建远程仓库**

- **方式 A（推荐，全自动）**
  1. 浏览器打开 <https://github.com/settings/tokens/new>
  2. Note 随便填，Expiration 选 30 days，勾选 **repo**，点 Generate token
  3. 复制那串 token（只显示一次），粘贴回窗口（屏幕不显示字符是正常的，直接粘贴 + 回车）
  → 脚本自动建好仓库并推送完成
- **方式 B（不想用 token）**
  脚本会打开 `https://github.com/<你的用户名>/cline-desktop-zh/new` 页面，你点 **Create repository**，
  **注意不要勾选** README / .gitignore / license（本地已经有了，否则会冲突），回来按回车继续

**第 4 步：** 看到 `✔ 发布成功！` 和仓库地址，浏览器打开即可。

几个说明：

- 建议发布前先跑一次本地自检：`powershell -File scripts\publish-github.ps1 -SelfTest`（不联网，验证 git 链路）
- Token 只在内存里用一次，**不会**写进任何文件或 `.git/config`
- 以后改了内容要更新仓库？再双击一次 `launcher\publish-github.cmd` 就行
- 仍然想手动敲命令的话：

```powershell
git config user.name "你的名字"; git config user.email "你的邮箱"
git remote add origin https://github.com/<用户名>/cline-desktop-zh.git
git push -u origin main
```

发布后建议顺手做的三件事：在仓库 **About** 里填简介并勾选 Topics
（`cline` `chinese` `localization` `i18n` `zh-cn` `windows` `webview2` `cdp`）；
把 README 里的项目名按你的仓库地址微调；给代码补一个星标或写点使用说明。

### 网络受限（github.com 连不通）时怎么发布？

如果 `git push` 卡住或超时（国内网络常见：`github.com:443` 不通，但 `api.github.com` 可通），
改用 API 通道发布：

- 双击 **`launcher\publish-github-api.cmd`**，粘贴一次 Token 即可；
- 它会自动完成：检查网络 →（必要时）创建仓库与占位提交 → 设置 Topics/简介 →
  通过 Git Data API 同步 blob / tree / commit / 分支引用；
- 生成的 **commit SHA 与本地完全一致**，所以网络恢复后可以正常 `git fetch / pull / push`，
  不会出现「历史分叉、只能强推」的麻烦；
- 底层脚本是 `tools\publish-via-api.mjs`，也可以手动用：

```powershell
$env:GITHUB_TOKEN = 'ghp_xxx'
node tools\publish-via-api.mjs --repo <用户名>/<仓库名> [--branch main] [--dry-run]
```

> 原理：GitHub 的 Git Data API（`api.github.com`）与 git 通道（`github.com`）是两套独立入口，
> 前者在国内往往可用。用同一份内容、同一份作者时间与时区构造对象，算出来的对象哈希与本地 git 完全相同。

## 免责声明与许可

本项目为社区非官方项目，与 Cline 官方（[cline.bot](https://cline.bot)）无隶属关系；
不分发、不修改官方程序文件，仅通过本机调试通道在运行时替换界面文本。
本项目以 **MIT** 许可发布，上游来源与许可证见 [NOTICE.md](NOTICE.md) 与 `licenses/`。

