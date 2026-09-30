# ============================================================
#  Cline 中文版启动器（真实逻辑；由 launcher\cline-zh.vbs 以隐藏窗口调用）
#  1) 校验便携 Node.js（缺失时可自动下载安装）
#  2) 定位官方 cline-app.exe
#  3) 若 Cline 正以英文模式运行 → 询问后重启
#  4) 以本机 CDP 调试端口启动 Cline，并后台静默启动注入器
#  -DryRun: 只打印将要执行的动作，不做任何改动（用于排查/自测）
# ============================================================
param([switch]$DryRun)

$ErrorActionPreference = 'Continue'
$base = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$sh = New-Object -ComObject WScript.Shell

function ShowMsg([string]$text, [int]$type = 0) {
  return $sh.Popup($text, 0, 'Cline 中文版', $type)
}

$node = Join-Path $base 'node\node.exe'

# ---------- 1) 便携 Node.js ----------
if (-not (Test-Path $node)) {
  if ($DryRun) { Write-Host "[DryRun] 缺少便携 Node.js: $node（正式运行会提示下载）" }
  else {
    $ans = ShowMsg "首次运行需要下载便携版 Node.js（约 40MB，来自 nodejs.org）。`n`n是否现在下载？下载后会放在：`n$base\node" (4 + 48)
    if ($ans -ne 6) { exit 0 }
    Start-Process -FilePath 'powershell.exe' `
      -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $base 'scripts\setup.ps1')) -Wait
    if (-not (Test-Path $node)) {
      ShowMsg 'Node.js 未能安装成功。请手动运行 launcher\setup.cmd 查看详细输出。' 16
      exit 1
    }
  }
}

# ---------- 2) 定位官方 Cline ----------
$exe = @(
  (Join-Path $env:LOCALAPPDATA 'Cline\cline-app.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs\Cline\cline-app.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs\cline\cline-app.exe'),
  (Join-Path $env:ProgramFiles 'Cline\cline-app.exe')
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $exe) {
  $un = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -eq 'Cline' } | Select-Object -First 1
  if ($un -and $un.InstallLocation) {
    $cand = Join-Path ($un.InstallLocation.Trim('"')) 'cline-app.exe'
    if (Test-Path $cand) { $exe = $cand }
  }
}
if (-not $exe) {
  ShowMsg "未找到 Cline 桌面版 cline-app.exe。`n请先从 https://cline.bot 安装官方客户端。" 16
  exit 1
}

# ---------- 3) 端口 / 语言（读 config.json） ----------
$port = 9223
$lang = 'zh-CN'
$cfgPath = Join-Path $base 'config.json'
if (Test-Path $cfgPath) {
  try {
    $j = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($j.port) { $port = [int]$j.port }
    if ($j.lang) { $lang = [string]$j.lang }
  } catch { }
}

# ---------- 3.5) DryRun: 只打印计划，不做任何改动 ----------
if ($DryRun) {
  $running = @(Get-Process cline-app -ErrorAction SilentlyContinue).Count
  $debugOn = @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*--remote-debugging-port=$port*" }).Count -gt 0
  Write-Host '[DryRun] 计划如下（未执行任何操作）:'
  Write-Host ("  仓库根目录 : " + $base)
  Write-Host ("  便携 Node  : " + $node + " " + $(if (Test-Path $node) { '已安装 ' + (& $node --version) } else { '缺失' }))
  Write-Host ("  Cline 主程序: " + $exe)
  Write-Host ("  调试端口   : " + $port + "   语言: " + $lang)
  Write-Host ("  Cline 进程 : " + $(if ($running -gt 0) { "正在运行($running)" } else { '未运行' }) + "；WebView2 调试端口: " + $(if ($debugOn) { '已开启' } else { '未开启' }))
  Write-Host ("  将设置环境变量 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=$port --lang=$lang")
  Write-Host ("  将启动注入器命令: " + $node + " tools\cline-zh.mjs run --port $port --exe `"$exe`" --dict ..\dict\zh-cn.json")
  exit 0
}

# ---------- 4) Cline 运行状态 ----------
$procs = @(Get-Process cline-app -ErrorAction SilentlyContinue)
$debugOn = $false
Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*--remote-debugging-port=$port*" } |
  ForEach-Object { $script:debugOn = $true }

if ($procs.Count -gt 0 -and -not $debugOn) {
  $ans = ShowMsg "Cline 正在以英文模式运行。`n`n是否关闭它并以中文模式重新启动？`n（尚未发送的输入可能会丢失）" (4 + 48)
  if ($ans -ne 6) { exit 0 }
  $procs | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 1500
  $procs = @()
}

# ---------- 5) 带调试端口启动 Cline ----------
if ($procs.Count -eq 0) {
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$port --lang=$lang"
  Start-Process -FilePath $exe | Out-Null
  Start-Sleep -Milliseconds 1500
}

# ---------- 6) 重启后台注入器（隐藏窗口，日志写入 logs\） ----------
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'cline-zh\.mjs' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

$logDir = Join-Path $base 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }

$injArgs = @(
  (Join-Path $base 'tools\cline-zh.mjs'), 'run',
  '--port', "$port",
  '--exe', ('"' + $exe + '"'),
  '--dict', '..\dict\zh-cn.json'
)
Start-Process -FilePath $node -ArgumentList $injArgs -WorkingDirectory $base -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logDir 'injector.out.log') `
  -RedirectStandardError  (Join-Path $logDir 'injector.err.log') | Out-Null
