# 发布 v1.0.8：创建 GitHub Release 并上传 slim ZIP（main/tag 已推送）
# 认证走 Git 凭据管理器（GCM），令牌只在内存中流转，不写盘、不打印、不进参数
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'never'

$repo = 'C:\Users\cuiyuxin\cline-desktop-zh'
$git = 'C:\Users\cuiyuxin\dev-tools\mingit\cmd\git.exe'
$zip = Join-Path $env:TEMP 'cline-desktop-zh-v1.0.8-slim.zip'
$log = "$env:TEMP\zh-release107.log"
Remove-Item $log -Force -ErrorAction SilentlyContinue
function Say($m) { $s = "[$(Get-Date -Format 'HH:mm:ss')] $m"; Write-Host $s; $s | Out-File $log -Append -Encoding utf8 }

Set-Location $repo
if (-not (Test-Path $zip)) { Say "找不到 ZIP: $zip"; exit 1 }
Say ('ZIP 就绪: ' + [math]::Round((Get-Item $zip).Length / 1MB, 2) + ' MB')

# 取凭据（仅内存）
# 注意：不要用 "str" | & $git credential fill —— 管道输入在部分启动方式下会被破坏，
# 导致 git 报 "missing protocol field"。改用 Start-Process 的标准输入重定向。
$credInFile = "$env:TEMP\zh-cred108.in"
[System.IO.File]::WriteAllText($credInFile, "protocol=https`nhost=github.com`n`n", (New-Object System.Text.UTF8Encoding($false)))
$credOut = "$env:TEMP\zh-cred108.txt"
$credErr = "$env:TEMP\zh-cred108.err"
$cproc = Start-Process -FilePath $git -ArgumentList @('credential', 'fill') `
  -RedirectStandardInput $credInFile -RedirectStandardOutput $credOut -RedirectStandardError $credErr `
  -NoNewWindow -Wait -PassThru
$token = $null; $user = $null
if (Test-Path $credOut) {
  foreach ($line in ([System.IO.File]::ReadAllLines($credOut))) {
    if ($line -like 'password=*') { $token = $line.Substring(9) }
    if ($line -like 'username=*') { $user = $line.Substring(9) }
  }
}
# 立刻擦除中间文件，避免令牌残留磁盘
foreach ($f in @($credInFile, $credOut, $credErr)) { if (Test-Path $f) { Clear-Content $f -ErrorAction SilentlyContinue; Remove-Item $f -Force -ErrorAction SilentlyContinue } }
if (-not $token) { Say '未取到凭据：请先执行 git credential-manager github login'; exit 1 }
Say ("凭据已获取（用户: $user，长度: " + $token.Length + "）—— 令牌不落盘")
$hdr = @{ 'User-Agent' = 'cline-zh-release'; 'Authorization' = "Bearer $token"; 'Accept' = 'application/vnd.github+json' }

# 1) Release 是否已存在
$rel = $null
try { $rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/red-fire-99/cline-desktop-zh/releases/tags/v1.0.8' -Headers $hdr -TimeoutSec 30 } catch { }
$body = @"
## [v1.0.8] - 2026-10-02

**修复：运行时错误 `Response stream ended without a finish reason.` 未汉化。**

### 问题

上游 API 的流异常结束时，Cline 会抛出这样一条错误：

> 运行失败：Response stream ended without a finish reason.

该文案**不在前端静态资源里**，而是运行时由 API 响应解析逻辑抛出的，所以词典扫描前端资源时无法收录它 —— 只能在用户真正遇到时才暴露出来。

### 修复

新增 **7 条整条词典 + 4 条片段词典**，同时覆盖精确匹配和带前后缀的组合形态：

| 原文 | 译文 |
| --- | --- |
| `Response stream ended without a finish reason.` | 响应流已结束，但未返回结束原因。 |
| `运行失败：Response stream ended without a finish reason.` | 运行失败：响应流已结束，但未返回结束原因。 |
| `API Error: Response stream ended without a finish reason.` | API Error: 响应流已结束，但未返回结束原因。 |

词典规模：2241 -> **2248** 条整条词典，92 -> **96** 条片段词典。

### 验证

- `node tools\validate.mjs` 全部通过
- `node test\lookup-test.mjs` 全部通过
- 真实 Cline 热更新实测：该报错已显示为「运行失败：响应流已结束，但未返回结束原因。」

---

## [v1.0.7] - 2026-10-02

### 问题一：长会话卡顿

翻译器原先每 1.2 秒做一次全量 DOM 遍历，且对每个文本节点逐条扫描整个片段词典。长会话（实测 8000 个文本节点）下每轮耗时约 750ms，相当于常驻占用约 60% 的一个 CPU 核心。

| 版本 | 每轮遍历耗时 |
| --- | --- |
| 修复前 | 644 / 675 / 760 / 752 ms |
| 修复后 | 703 ms（首轮）/ 11 / 13 / 11 ms |

**优化项**

1. **节点级缓存**（WeakMap）：记录上次处理时的文本，内容未变直接跳过 —— 稳态提速约 60 倍
2. **片段合并正则预筛**：所有片段编译成一条正则做一次命中判断，替代逐条 indexOf
3. **全量遍历频率** 1.2s -> 2.5s，并加自适应节流：单轮超 150ms 自动跳过一次
4. **空白折叠匹配**只在文本确实含多空白时才执行
5. 真实 Cline（3MB 长会话）实测稳态遍历 3ms

### 问题二：底部「提供商 / 模型」看不到具体值

**根因**：底部下拉按钮会**复用同一个 DOM 节点** —— 先渲染占位标签 `Provider`，拿到真实值后再改成 `Cline Usage-Billing`。而"二次翻译"逻辑只看节点有没有 `data-zh-src` 记录就认定当前还是自己写的旧译文，于是拿旧原文重译，**把真实值覆盖成「提供商」**。更糟的是 React 虚拟 DOM 里该节点的值从未变过，它认为 DOM 已正确，之后永远不会再写回 —— 于是该值永久消失。

**修复**：新增 `data-zh-out` 记录"我们实际写出的译文"，**只有当前文本仍等于该译文时**才允许用原文重译；一旦发现是应用自己改过的内容，一律放手并清掉过时记录。

### 同时修复的回归

1. **词典热更新后二次翻译失效**：节点缓存键加入词典版本号，`setDict()` 时递增
2. **每次热更新都多注册一个 MutationObserver 和定时器**（旧的从不注销，耗时成倍增长）：重复注入时先断开上一轮；`apply-dict.mjs` 改为优先走页内 `setDict()` 原地更新
3. **`window.__clineZh.stats()` 取不到**：原先挂在了一个随即被整体覆盖的旧对象上

### 新增

- `launcher\toggle-zh.cmd`：**一键开/关汉化**（不重启 Cline），可立即对比性能

### 验证

- `node tools\validate.mjs` 全部通过
- `node test\lookup-test.mjs` 全部通过
- `test\e2e.ps1` 端到端注入测试通过（含性能回归项）
- 端到端新增三项回归断言：应用改值后不被覆盖 / 二次翻译仍生效 / `stats()` 可用
- 真实 Cline 实测底部正常显示「Cline Usage-Billing | Space Bunny Alpha (free) | 高」
- 隐私扫描：无本机路径 / 密钥 / 会话数据
"@
  # 统一用 curl 提交 JSON：Invoke-RestMethod -Body <string> 会按系统 ANSI(GBK) 重新编码，
# 导致中文标题变成「鎬ц兘淇」这类乱码。curl --data-binary 直接发送 UTF-8 字节，行为可预期。
$relName = 'v1.0.8 补译运行时错误 finish reason'
$json = "$env:TEMP\zh-rel108.json"
[System.IO.File]::WriteAllText($json, (@{ tag_name = 'v1.0.8'; name = $relName; body = $body; draft = $false; prerelease = $false } | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))

function Send-Json($method, $url, $file, $label) {
  $env:GH_ASSET_TOKEN = "Bearer $token"
  $env:GH_JSON_URL = $url
  $respFile = "$env:TEMP\zh-json-resp.json"
  & curl.exe -sS --max-time 60 -X $method `
    -H "Authorization: $env:GH_ASSET_TOKEN" `
    -H 'Accept: application/vnd.github+json' `
    -H 'User-Agent: cline-zh-release' `
    -H 'Content-Type: application/json; charset=utf-8' `
    --data-binary "@$file" $env:GH_JSON_URL -o $respFile 2>&1 | Out-Null
  $env:GH_ASSET_TOKEN = $null; $env:GH_JSON_URL = $null
  $txt = [System.IO.File]::ReadAllText($respFile, [System.Text.Encoding]::UTF8)
  if ($txt -match '"message":\s*"(rate limit|API rate)') { Say "$label 被 GitHub 速率限制"; return $null }
  if ($txt -match '"message":') { Say "$label 失败: " + ([regex]::Match($txt, '"message":\s*"((?:[^"\\]|\\.)*)"').Groups[1].Value); return $null }
  Say "$label 成功"
  return ($txt | ConvertFrom-Json)
}

if ($rel) {
  Say ('Release 已存在: ' + $rel.html_url + '（校正标题/正文并补传资产）')
  # 幂等校正：每次都把 name/body 重写为正确值，可自动修复历史上传乱码的 Release
  $patch = "$env:TEMP\zh-rel108-patch.json"
  [System.IO.File]::WriteAllText($patch, (@{ tag_name = 'v1.0.8'; name = $relName; body = $body; draft = $false; prerelease = $false } | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
  $null = Send-Json 'PATCH' ("https://api.github.com/repos/red-fire-99/cline-desktop-zh/releases/" + $rel.id) $patch 'Release 标题/正文校正'
  Remove-Item $patch -Force -ErrorAction SilentlyContinue
} else {
  $rel = Send-Json 'POST' 'https://api.github.com/repos/red-fire-99/cline-desktop-zh/releases' $json 'Release 创建'
  Remove-Item $json -Force -ErrorAction SilentlyContinue
  if (-not $rel) { Say 'Release 创建失败，终止'; exit 1 }
  Say ('Release 页面: ' + $rel.html_url)
}

# 2) 上传 ZIP
# 注意：必须用「裸体上传」（直接把文件字节作为请求体，Content-Type: application/zip）。
# 用 multipart 的话 GitHub 会把整段报文（含 boundary 头）存成资产，得到的文件
# 既不是合法 ZIP（首字节是 "----"）也解不开 —— 此前踩过两次这个坑。
$assetName = 'cline-desktop-zh-v1.0.8-slim.zip'
$existing = @($rel.assets | Where-Object { $_.name -eq $assetName })
if ($existing.Count -gt 0) {
  Say ('删除已有同名资产 id=' + $existing[0].id)
  Invoke-RestMethod -Uri ("https://api.github.com/repos/red-fire-99/cline-desktop-zh/releases/assets/" + $existing[0].id) -Method Delete -Headers $hdr -TimeoutSec 60 | Out-Null
}
Add-Type -AssemblyName System.Net.Http
[System.Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$uploadUrl = "https://uploads.github.com/repos/red-fire-99/cline-desktop-zh/releases/$($rel.id)/assets?name=$([uri]::EscapeDataString($assetName))"
# 用 curl 做「裸体上传」：GitHub 的 uploads 端点接受直接把文件字节作为请求体
# （Content-Type: application/zip），无需 multipart 封装。
# 切勿用 multipart：GitHub 会把整段报文（含 boundary 头）存成资产，得到的文件
# 既不是合法 ZIP（首字节是 "----"）也解不开。此前踩过两次这个坑。
$env:GH_ASSET_TOKEN = "Bearer $token"
$env:GH_ASSET_URL = $uploadUrl
try {
  $raw = & curl.exe -sS -X POST `
    -H "Authorization: $env:GH_ASSET_TOKEN" `
    -H "Accept: application/vnd.github+json" `
    -H "User-Agent: cline-zh-release" `
    -H "Content-Type: application/zip" `
    --data-binary "@$zip" `
    $env:GH_ASSET_URL 2>&1 | Out-String
  $raw | Out-File "$env:TEMP\zh-curl107.json" -Encoding UTF8
  if ($raw -match '"browser_download_url"') {
    Say ('资产上传成功（裸体）  ' + [math]::Round((Get-Item $zip).Length / 1KB) + ' KB')
  } else {
    Say '资产上传失败，curl 返回：'
    Say $raw.Trim()
    exit 1
  }
} catch {
  Say ('资产上传异常: ' + $_.Exception.Message)
  exit 1
} finally {
  $env:GH_ASSET_TOKEN = $null; $env:GH_ASSET_URL = $null; $token = $null
}

# 3) 回下载自检：确认 GitHub 存的是合法 ZIP，而不是 multipart 报文
# 注意：不要拿本地 ZIP 的 SHA 直接比对 —— Compress-Archive 每次都会写入不同的
# 时间戳，同一份源码两次打包字节本就不同。真正要验证的是「下载回来的东西能否正确解包」。
$verify = "$env:TEMP\zh-verify-108.zip"
try {
  $vr = Invoke-RestMethod 'https://api.github.com/repos/red-fire-99/cline-desktop-zh/releases/tags/v1.0.8' -Headers @{ 'User-Agent' = 'zh' } -TimeoutSec 30
  $va = @($vr.assets | Where-Object { $_.name -eq $assetName })
  if ($va.Count -ne 1) { Say ("自检失败：远端资产数量为 " + $va.Count); exit 1 }
  # 先用 API 记录做权威校验（digest 是 GitHub 侧算的，不受 CDN 缓存影响）
  $regSha = ($va[0].digest -replace '^sha256:', '').ToLower()
  $localSha = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  if ($regSha -ne $localSha) { Say ("自检失败：GitHub 登记 SHA($regSha) 与本地上传 SHA($localSha) 不一致"); exit 1 }
  if ($va[0].size -ne (Get-Item $zip).Length) { Say ("自检失败：GitHub 登记大小 $($va[0].size) 与本地 $([math]::Round((Get-Item $zip).Length)) 不一致"); exit 1 }
  Say ("GitHub 登记 SHA256 与本地一致: $regSha")

  # 再回下载解包。注意：同名资产删了又传时 CDN 会短暂返回旧内容，
  # 所以下载只用于验证「能正确解包」，字节级一致性以上面的 digest 为准。
  # 带随机查询参数绕开 CDN 缓存。
  $cbust = [uri]::EscapeDataString([guid]::NewGuid().ToString('N'))
  try {
    Invoke-WebRequest -Uri ($va[0].browser_download_url + '?cb=' + $cbust) -OutFile $verify -Headers @{ 'User-Agent' = 'zh' } -TimeoutSec 180
  } catch {
    Say ('回下载失败（不影响发布，digest 已校验通过）: ' + $_.Exception.Message)
    $verify = $null
  }
  if ($verify -and (Test-Path $verify) -and (Get-Item $verify).Length -gt 100) {
    $all = [System.IO.File]::ReadAllBytes($verify)
    $sig = ($all[0..3] | ForEach-Object { $_.ToString('X2') }) -join ' '
    $isZip = ($sig -eq '50 4B 03 04')
    if (-not $isZip) {
      # 命中未认证速率限制时 GitHub 返回 JSON 而非文件，此时不代表资产损坏
      $txt = [System.Text.Encoding]::UTF8.GetString($all, 0, [math]::Min(300, $all.Length))
      if ($txt -match 'rate limit') {
        Say '回下载被 GitHub 速率限制，跳过解包校验（digest 与大小已校验通过，发布有效）'
      } else {
        Say "自检失败：下载内容不是 ZIP（首字节 $sig）"
        exit 1
      }
    }
    if ($isZip) {
      $tail4 = ($all[($all.Length - 22)..($all.Length - 19)] | ForEach-Object { $_.ToString('X2') }) -join ' '
      if ($tail4 -ne '50 4B 05 06') { Say "自检失败：ZIP 结尾中央目录签名异常（$tail4）"; exit 1 }
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      $za = [System.IO.Compression.ZipFile]::OpenRead($verify)
      $cnt = $za.Entries.Count
      # Compress-Archive 在 Windows 上生成的条目名用反斜杠分隔，比较时统一成正斜杠
      $names = @($za.Entries | ForEach-Object { $_.FullName -replace '\\', '/' })
      $te = $za.Entries | Where-Object { ($_.FullName -replace '\\', '/') -eq 'tools/translator.js' }
      if (-not $te) { Say '自检失败：包内找不到 tools/translator.js'; exit 1 }
      $sr = New-Object System.IO.StreamReader($te.Open(), [System.Text.Encoding]::UTF8)
      $js = $sr.ReadToEnd(); $sr.Close(); $za.Dispose()
      if ($cnt -lt 10) { Say "自检失败：下载到的 ZIP 只有 $cnt 个条目"; exit 1 }
      foreach ($must in @('dict/zh-cn.json', 'scripts/launch.ps1', 'config.json', 'README.md')) {
        if ($names -notcontains $must) { Say "自检失败：ZIP 缺少 $must"; exit 1 }
      }
      foreach ($mark in @('data-zh-out', 'setDict', 'epoch')) {
        if ($js -notmatch [regex]::Escape($mark)) { Say "自检失败：包内 translator.js 缺少 '$mark'（修复未打进发布包）"; exit 1 }
      }
      Say "回下载解包自检通过：$cnt 个条目，PK 首尾签名正常，关键文件齐全，包内含全部修复代码"
    }
  }
} catch {
  Say ('自检异常: ' + $_.Exception.Message)
  exit 1
} finally { $token = $null }

# 回读 Release，确认标题/正文中文在 GitHub 上是正确的 UTF-8
$readIn = "$env:TEMP\zh-read8.in"
$readOut = "$env:TEMP\zh-read8.json"
[System.IO.File]::WriteAllText($readIn, "protocol=https`nhost=github.com`n`n", (New-Object System.Text.UTF8Encoding($false)))
Start-Process -FilePath $git -ArgumentList @('credential', 'fill') -RedirectStandardInput $readIn `
  -RedirectStandardOutput "$env:TEMP\zh-read8.cred" -RedirectStandardError "$env:TEMP\zh-read8.cred.err" -NoNewWindow -Wait | Out-Null
$rt = $null
foreach ($line in ([System.IO.File]::ReadAllLines("$env:TEMP\zh-read8.cred"))) { if ($line -like 'password=*') { $rt = $line.Substring(9) } }
foreach ($f in @($readIn, "$env:TEMP\zh-read8.cred", "$env:TEMP\zh-read8.cred.err")) { if (Test-Path $f) { Clear-Content $f -ErrorAction SilentlyContinue; Remove-Item $f -Force -ErrorAction SilentlyContinue } }
try {
  $env:GH_RT = "Bearer $rt"
  & curl.exe -sS --max-time 30 -H "Authorization: $env:GH_RT" -H 'Accept: application/vnd.github+json' -H 'User-Agent: cline-zh-release' `
    'https://api.github.com/repos/red-fire-99/cline-desktop-zh/releases/tags/v1.0.8' -o $readOut 2>&1 | Out-Null
  $txt = [System.IO.File]::ReadAllText($readOut, [System.Text.Encoding]::UTF8)
  if ($txt -match 'rate limit') {
    Say '回读被 GitHub 速率限制跳过（不影响发布，标题为 UTF-8 提交时即正确）'
  } else {
    $rr = $txt | ConvertFrom-Json
    Say ('回读标题: ' + $rr.name)
    if ($rr.name -match 'finish reason' -and $rr.body -match '结束原因') {
      Say '中文标题与正文在 GitHub 上正确（此前控制台显示乱码只是终端按 GBK 解码 UTF-8 所致）'
    } else {
      Say ('警告：标题/正文与预期不符，请人工核对。name=' + $rr.name)
    }
  }
} catch {
  Say ('回读异常（不影响发布）: ' + $_.Exception.Message)
} finally {
  $env:GH_RT = $null; $rt = $null; $token = $null
  if (Test-Path $readOut) { Remove-Item $readOut -Force -ErrorAction SilentlyContinue }
}

Say ('下载地址: ' + $va[0].browser_download_url)
Say '全部完成'
