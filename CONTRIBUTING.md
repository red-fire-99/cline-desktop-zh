# 参与贡献 · CONTRIBUTING

感谢参与 Cline 桌面版中文界面（cline-desktop-zh）。**大部分贡献不需要写代码 —— 补词典就是最直接的贡献。**

## 一、贡献词典（最常见）

### 1. 抓取漏翻文案

1. 用「Cline 中文版」启动 Cline，把界面停在你发现没翻译的页面（下拉菜单、弹窗可以保持展开）；
2. 运行 `launcher\find-missing.cmd`；
3. 清单在 `tools\out\todo.txt`（`out\todo-template.json` 是可直接复制的模板）。

### 2. 填写译文

编辑 `dict\overrides.json`（最高优先级，不会被词典重建覆盖）：

```json
{
  "Settings": "设置",
  "^Thought for (\\d+)s$": "思考了 $1 秒",
  "(?i)^(\\d+) available$": "$1 个可用"
}
```

规则：

| 写法 | 含义 |
| --- | --- |
| `"英文原文": "中文"` | 精确匹配（界面原文前后空白会被忽略） |
| key 以 `^` 开头 | 正则词条，替换里用 `$1` `$2` 引用捕获组 |
| key 以 `(?i)` 开头 | 该正则不区分大小写 |

注意：

- 原文要和界面里看到的**完全一致**（含大小写、省略号是 `…` 还是 `...`、弯引号 `’`）；
- **不要翻译产品名、模型名、服务名**（如 DeepSeek、OpenAI、GPT、Cline 本身）；
- 同一原文在 `dict/overrides.json` 里出现多次时，以最后一次为准。

### 3. 生效与提交

1. 运行 `launcher\hot-apply-dict.cmd` —— 立即热更新到正在运行的界面，无需重启；
2. 确认没问题后提 PR（建议一个 PR 只做一类改动，便于审核）。

也可以**完全不改代码**：把 `todo.txt` 里的清单连同你的译文发成 Issue，我来合并。

## 二、贡献代码

### 本地准备

```powershell
git clone https://github.com/red-fire-99/cline-desktop-zh.git
cd cline-desktop-zh
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1   # 安装便携 Node
```

### 提交前必跑的自检

```powershell
# 1) 仓库自检：词典格式 / 脚本语法 / 关键文件（CI 跑的就是它）
.\node\node.exe tools\validate.mjs

# 2) 端到端注入测试：临时开无头 Edge/Chrome 验证“注入 → 翻译”全链路
powershell -NoProfile -ExecutionPolicy Bypass -File .\test\e2e.ps1

# 3) 启动器干跑：只打印将要执行的动作，不做任何改动
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\launch.ps1 -DryRun
```

### 代码约定

- **缩进 2 空格**，换行 CRLF（见 `.editorconfig` / `.gitattributes`）；
- **PowerShell 脚本存为 UTF-8 with BOM**（中文输出才不会乱码）；
- ⚠️ **`.ps1` 里禁止使用印刷引号 `“ ”`**：PowerShell 会把它们当作字符串定界符，导致解析失败。
  中文引号请用 `「」`，或把整句放进单引号字符串。`tools\validate.mjs` 会 lint 这条规则；
- 不要提交 `node/`、`vendor/`、`logs/`、`tools/out/`（已在 `.gitignore` 中）。

### 目录速查

| 路径 | 作用 |
| --- | --- |
| `dict/zh-cn.json` | 合并生成的词典（**不要手改**，会被 `rebuild-dict.cmd` 覆盖） |
| `dict/overrides.json` | 人工覆盖词条（**优先手改这里**） |
| `tools/translator.js` | 注入页面的 DOM 翻译脚本 |
| `tools/cline-zh.mjs` | 注入器本体（run / dump / verify / kill） |
| `launcher/` | 用户双击的入口（vbs + cmd 包装） |
| `scripts/` | PowerShell 实现（启动、安装、快捷方式、状态） |
| `test/` | 端到端自测 |

## 三、维护者：打 Release

> 只有维护者需要看这节。日常发布用的是独立工具
> [git-publish-wizard](https://github.com/red-fire-99/git-publish-wizard)（与 Cline 汉化无关的通用发布向导）。

```powershell
# 网络正常：git push 通道
powershell -File <git-publish-wizard>\publish-github.ps1 -RepoDir <本仓库目录>

# 网络受限（github.com:443 不通）：GitHub API 通道，生成的 commit SHA 与本地完全一致
powershell -File <git-publish-wizard>\publish-github-api.ps1 -RepoDir <本仓库目录>
```

发布清单：

1. 改 `CHANGELOG.md` 的版本号与日期；
2. 提交并推送；
3. 打包发行资产（只含 git 跟踪的文件，不含 `node/`）：

```powershell
git archive --format=zip --prefix='cline-desktop-zh-v1.0.1-slim/' `
    --output=cline-desktop-zh-v1.0.1-slim.zip HEAD
```

4. 创建 Release 并上传资产：

```bash
gh release create v1.0.1 cline-desktop-zh-v1.0.1-slim.zip `
   --title "v1.0.1 · Cline 桌面版中文界面（汉化版 / Chinese UI）" `
   --notes-file release-notes.md
```

## 四、安全与隐私

- **不要提交任何密钥**（Token、API Key、Cookie）。如果你不小心提交了，请**先在对应平台撤销该凭据**，
  再告知维护者处理历史（仅删文件是不够的，密钥会留在 git 历史里）。
- 提交前可自查：

```powershell
git grep -n -I -E 'gh[pors]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----' HEAD
```

- 发现安全问题请**私下**联系维护者，不要直接开公开 Issue。

## 五、行为准则

- 对事不对人；不同翻译风格请讨论，不要人身攻击；
- 新增词条尽量与既有译法保持一致（不确定就在 PR 里问）；
- 大改动（改注入机制、改启动器行为）请先开 Issue 讨论，避免白做。

## 六、许可

提交贡献即表示同意你的内容以本项目的 **MIT** 许可发布（见 [LICENSE](LICENSE)）。
若贡献内容明显来自第三方项目，请一并说明来源与许可证，并补充到 [NOTICE.md](NOTICE.md)。
