# _test/e2e.ps1 —— 端到端验证: 真浏览器(Edge/WebView2 引擎) + cline-zh.mjs 注入器
$ErrorActionPreference = 'Continue'
$base = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$node = Join-Path $base 'node\node.exe'
$edge = @(
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe')
) | Where-Object { Test-Path $_ } | Select-Object -First 1
$port = 9411
$profile = Join-Path $env:TEMP 'cline-zh-e2e'
$log = Join-Path $base 'test\e2e-injector.log'

if (-not $edge) { Write-Host '未找到 Edge/Chrome，跳过端到端测试。'; exit 3 }
if (-not (Test-Path $node)) { Write-Host '尚未安装便携 Node.js（先运行 launcher\setup.cmd）。'; exit 3 }

Write-Host '[0/5] 仓库自检（词典 / 脚本 / 关键文件）...'
& $node (Join-Path $base 'tools\validate.mjs')
if ($LASTEXITCODE -ne 0) { Write-Host '自检未通过，测试中止。'; exit 4 }

function Kill-TestEdge {
  foreach ($name in @('msedge.exe', 'chrome.exe')) {
    Get-CimInstance Win32_Process -Filter "Name='$name'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -match 'cline-zh-e2e' } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  }
}
Kill-TestEdge
Remove-Item -Recurse -Force $profile -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

Write-Host '[1/5] 启动 Edge headless 测试页 ...'
Start-Process -FilePath $edge -ArgumentList @(
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  "--remote-debugging-port=$port", "--user-data-dir=$profile",
  "file:///$($base -replace '\\','/')/test/page.html"
) -WindowStyle Hidden | Out-Null

$ready = $false
for ($i = 0; $i -lt 20; $i++) {
  try { Invoke-RestMethod "http://127.0.0.1:$port/json/version" -TimeoutSec 1 | Out-Null; $ready = $true; break }
  catch { Start-Sleep -Milliseconds 500 }
}
if (-not $ready) { Write-Host 'Edge 调试端口未就绪, 测试中止'; Kill-TestEdge; exit 2 }
Write-Host '      端口就绪'

Write-Host '[2/5] 后台启动 cline-zh.mjs 注入器 ...'
$injArgs = @(
  (Join-Path $base 'tools\cline-zh.mjs'), 'run', '--port', "$port",
  '--exe', (Join-Path $env:SystemRoot 'System32\where.exe'),
  '--dict', '..\dict\zh-cn.json'
)
$inj = Start-Process -FilePath $node -ArgumentList $injArgs -WorkingDirectory $base -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $log -RedirectStandardError "$log.err"

$passed = $false
for ($i = 0; $i -lt 12; $i++) {
  Start-Sleep -Milliseconds 1200
  $out = & $node (Join-Path $base 'test\probe.mjs') $port 2>&1 | Out-String
  # 只用 ASCII 标记判定，避免 PowerShell 以 GBK 解码 node 的 UTF-8 输出导致中文匹配误判
  if ($out -match 'VERIFY-RESULT: PASS') { $passed = $true; Write-Host $out.Trim(); break }
}
if (-not $passed) { Write-Host '注入结果未通过:'; $out }

Write-Host '[3/5] 关闭注入器与测试浏览器 ...'
if ($inj -and -not $inj.HasExited) { Stop-Process -Id $inj.Id -Force -ErrorAction SilentlyContinue }
Kill-TestEdge

Write-Host '[4/5] 结果:'
if ($passed) { Write-Host '  端到端注入链验证通过 ✔'; exit 0 } else { Write-Host '  端到端注入链验证失败 ✘'; exit 1 }
