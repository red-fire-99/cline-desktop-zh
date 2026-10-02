# 更新记录

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [v1.0.7] — 2026-10-02

**性能：解决长会话下 Cline 明显卡顿的问题。**

### 问题根因

翻译器原先每 1.2 秒做一次全量 DOM 遍历，且对**每个文本节点**逐条扫描整个片段词典（`indexOf`）。
长会话（本项目实测 8000 个文本节点）下实测：

| 版本 | 每轮遍历耗时 | CPU 占用（每 1.2s 一次） |
| --- | --- | --- |
| 修复前 | 644 / 675 / 760 / **752 ms** | **约 60% 的一个核心** |
| 修复后 | 703 ms（首轮）/ **11 / 13 / 11 ms** | 约 0.5%（且频率降到 2.5s） |

旧版在长会话里每 1.2 秒就要占用主线程 0.7 秒，界面自然卡。

### 优化项

1. **节点级缓存**（`WeakMap`）：记录上次处理时的文本，内容未变直接跳过 —— 稳态从 ~730ms 降到 ~12ms
2. **片段合并正则预筛**：所有片段编译成一条正则做一次命中判断，没命中就不再逐条 `indexOf`（92 条 × N 节点 → 1 次正则测试）
3. **全量遍历频率** 1.2s → 2.5s，并加**自适应节流**：上一轮超过 150ms 自动跳过一次
4. **空白折叠匹配**只在文本确实含多空白时才做，避免每个节点跑一次正则替换

顺带提供 `launcher\toggle-zh.cmd`：**一键开/关汉化**（不重启 Cline），可立刻对比手感。

### 验证

- 端到端测试新增**性能回归项**：合成 2000 个节点测遍历耗时（实测首轮 15ms / 缓存轮 3ms）

## [v1.0.6] — 2026-10-02

**重大改进：已翻译的内容会随词典更新"自动升级"**（解决"加了词条但界面还是老样子"）。

**原理**

翻译器在替换文本时，会把**原文**记录到元素属性 `data-zh-src` 上（仅限元素只有一个文本子节点的安全场景）。
之后每次词典热更新（`hot-apply-dict.cmd`）都会：取出原文 → 用**当前**词典重新翻译 → 覆盖旧译文。

**效果**

```
原文 Hub connection closed (code=1006, reason=Connection ended)
旧译文 与 Hub 的连接已关闭（code=1006，原因：连接已结束）
词典新增更优译文后 → 【新译文】  ← 旧译文自动被替换
```

**注意**：该机制从本版起生效。升级前已经被翻译过的旧消息没有记录原文，
重启一次 Cline（或切换会话让消息重新渲染）之后，之后所有内容都会被跟踪并可自动升级。

同时修复：二次翻译路径下 `raw`（旧译文）与 `core`（原文）不匹配导致替换失效的问题（改为整段替换）。

新增**二次翻译**能力：词典更新后，已经翻过的界面也会自动升级到新译文。

**修复**

- 翻译器在替换文本时，把**原文**记录到元素的 `data-zh-src` 属性（仅限「元素只有一个子节点」的安全场景）；
  后续每次翻译（含每次热更新词典后的重新遍历）都会**优先用记录的原文**重新翻译，
  因此「我明明加了词条，旧消息却还是老样子」的问题消失。
- 二次翻译路径改为「首尾空白 + 译文」整段替换，避免因为原文与当前文本不一致而替换失败。
- 实测：把某条译文改成新版后重新遍历，界面立即显示新译文；还原词典后又能变回原译文（**双向可逆**）。

> 注意：本功能只对**翻译之后**的节点生效。此前已翻译但未记录原文的旧消息，
> 在切换会话或重启 Cline（用「Cline 中文版」快捷方式）后会以英文原文重新渲染，届时即按最新词典翻译。

## [v1.0.5] — 2026-10-02

连接类错误全覆盖 + 修掉一个「只翻一半」的结构性缺口。

**修复（翻译器）**

- 正则规则的替换结果**再过一遍片段词典**。此前只要兜底规则（如 `The run failed: …`）命中就直接返回，
  剩余英文细节不再翻译；现在组合文本也能完整汉化：
  `The run failed: Hub connection closed (code=1006, reason=Connection ended)`
  → `运行失败：与 Hub 的连接已关闭 (code=1006, reason=连接已结束)`

**新增译文**

- 整条：`Hub connection closed (code=1006, reason=Connection ended)` → `与 Hub 的连接已关闭（code=1006，原因：连接已结束）`
- **错误码加中文说明（保留原码，便于复制/求助）**，共 20 个常见码：
  `INFERENCE_CAP_ERROR（推理额度或频率已达上限）`、`RATE_LIMIT_EXCEEDED（超出速率限制）`、
  `QUOTA_EXCEEDED（配额已用尽）`、`INVALID_API_KEY（API 密钥无效）`、`CONTEXT_LENGTH_EXCEEDED（超出上下文长度）` 等
- 片段词典 58 → **92** 条：WebSocket 关闭原因（RFC 6455）、Node 网络错误码（`ECONNRESET` 等）、
  以及常见错误短语的大小写变体（`Too many requests` / `unauthorized` / `network error` …）

词典 **2241** 条 + 片段 **92** 条；单元测试 14 例全通过；已在真实页面环境端到端验证。

## [v1.0.4] — 2026-10-01

补齐 Node / undici `fetch()` 网络错误汉化（片段词典 28 → 47 条）。

| 原文 | 中文 |
| --- | --- |
| `The socket connection was closed unexpectedly.` | 套接字连接意外中断。 |
| `Client network socket disconnected before secure TLS connection was established` | 在建立安全 TLS 连接之前，客户端网络套接字已断开 |
| `ECONNRESET` / `ECONNREFUSED` / `ETIMEDOUT` | 连接被重置 / 连接被拒绝 / 连接超时 |
| `ENOTFOUND` / `EAI_AGAIN` / `EPIPE` | 域名解析失败 / 域名解析暂时失败 / 管道已关闭 |
| `CERT_HAS_EXPIRED` / `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | 证书已过期 / 无法验证证书链 |
| `Body is unusable` / `Body has already been read` | 响应体不可用 / 响应体已被读取 |
| `premature close` / `The operation was aborted` | 连接提前关闭 / 操作已被中止 |

顺带在 README 记录一个已知边界：**句子中夹着行内代码时会被拆成多个文本节点，可能只翻一半**，
补救办法是把被拆开的前后两段也写进片段词典（本项目已这么做）。

## [v1.0.3] — 2026-10-01

扫描范围扩展到全部前端 chunk，词典 2159 → 2239 条。

- `scan-ui-strings.mjs` 除「已加载的 JS」外，还收集 `modulepreload`，并从 bundle 文本里挖出
  「被引用但尚未加载」的 chunk 追加扫描：覆盖从 **35 文件 / 3.5 MB** 提升到 **630 文件 / 22.5 MB**。
- 新增 80+ 条 UI 文案：团队协作、会话复刻、MCP 服务器、图表/表格下载、附件/图片、错误提示等。

## [v1.0.2] — 2026-10-01

用「扫描前端资源」的方式系统性补齐漏翻文案。

**新增**

- `tools\scan-ui-strings.mjs`：通过 CDP 读取应用已加载的前端 JS（**只读，不重启应用、不打断会话**），
  抽取全部英文文案字面量，与词典比对，输出「还没覆盖」的候选清单（`tools\out\ui-strings-missing.txt`），
  并带噪声过滤（排除 JS 符号、CSS 类名、zod 报错、代码高亮 token、主题/字体名等）
- 片段词典 19 → **24** 条；词典 2101 → **2159** 条（新增 59 条来自扫描结果的 UI 文案）

**新增译文（部分）**

| 原文 | 中文 |
| --- | --- |
| `Invalid input` / `Invalid hostname` / `Invalid size` | 输入无效 / 主机名无效 / 大小无效 |
| `Tool call execution denied.` | 工具调用被拒绝。 |
| `Streaming transcription network connection was lost` | 转写的流式网络连接已断开 |
| `Gateway request failed` / `fetch failed` | 网关请求失败 / 请求失败 |
| `Clipboard API not available` | 剪贴板 API 不可用 |
| `temperature is not supported for reasoning models` | 推理模型不支持 temperature 参数 |
| `Record speech` / `Attach images` | 录制语音 / 附加图片 |
| `Pin failed` / `Unpin failed` / `Check again` | 置顶失败 / 取消置顶失败 / 重新检查 |
| `Cloud repo` / `Cloud branch` / `Cloud session` | 云端仓库 / 云端分支 / 云端会话 |
| `access forbidden: … is not available in your region Sign in to Cline again in Settings → Account, then try again.` | 无访问权限：… 在你所在的地区不可用 请在「设置 → 账户」中重新登录 Cline 后重试。 |

## [v1.0.1] — 2026-10-01

修复「偶发控制台窗口一闪而过」+ 增强运行时错误的中文覆盖。

**修复**

- 消除本工具自身可能弹出的控制台窗口：所有子进程调用补 `windowsHide`（`cline-zh.mjs` 的 `tasklist` / `taskkill` / 启动 Cline、`validate.mjs` 的语法检查），自检时不再闪 14 下
- 启动器判定「调试端口是否已开启」改为**直接探本机端口**（毫秒级），不再用 CIM 扫描几十个 WebView2 进程的命令行（原实现要 20~30 秒，机器上 WebView2 多时更慢）
- 注入器改为写 `logs\injector.pid`，启动器 / 停止脚本按 PID 精确结束旧进程；无 PID 文件时回退到「按可执行文件路径匹配」，彻底去掉慢查询
- 停止脚本 `stop-injector.cmd` 同样走 PID 文件，速度从数秒降到毫秒级

**增强**

- 新增 **片段词典** `dict/fragments.json`（19 条）：整条文本没命中时，再对文本中出现的错误短语逐一替换，
  专门对付「被包在 JSON / 长句里」的运行时错误（例如
  `The run failed: {"error":{"code":"...","message":"Error 429: Daily free limit reached..."}}`）
- 词典排序规则改为**正则按长度降序**：更具体的规则永远排在兜底规则之前，不再依赖字符编码顺序
- 新增「每日免费额度耗尽」等 JSON 运行时错误的完整中文译文；词典 2100 → 2101

## [v1.0.0] — 2026-09-30

首个版本：Cline 桌面版（Windows）运行时中文界面工具。

**下载**：GitHub Release 提供 `cline-desktop-zh-v1.0.0-slim.zip`（约 145 KB，含全部代码与 2097 条词典）。
首次运行 `launcher\setup.cmd` 会自动下载便携 Node.js（nodejs.org，失败回退 npmmirror），无需管理员权限。

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