# 汉化开关：开着就关掉，没开就接上（不重启 Cline）
# 用法: launcher\toggle-zh.cmd
$ErrorActionPreference = 'Continue'
$base = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$node = Join-Path $base 'node\node.exe'
$pidFile = Join-Path $base 'logs\injector.pid'

function Get-Injector {
  $procs = @(Get-Process node -ErrorAction SilentlyContinue)
  foreach ($p in $procs) {
    try { if ($p.Path -eq $node) { return $p } } catch { }
  }
  return $null
}

function Test-Port([int]$p) {
  try { Invoke-WebRequest "http://127.0.0.1:$p/json/version" -TimeoutSec 1 -UseBasicParsing | Out-Null; return $true } catch { return $false }
}

$cfgPort = 9223
try {
  $cfg = Get-Content (Join-Path $base 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($cfg.port) { $cfgPort = [int]$cfg.port }
} catch { }

$inj = Get-Injector
if ($inj) {
  Stop-Process -Id $inj.Id -Force -ErrorAction SilentlyContinue
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  Write-Host ('已关闭汉化注入器（PID ' + $inj.Id + '）。') -ForegroundColor Green
  Write-Host '界面里已翻译的内容会保留，但后续新内容不再翻译。'
  exit 0
}

if (-not (Test-Path $node)) {
  Write-Host '缺少便携 Node.js，请先运行 launcher\setup.cmd' -ForegroundColor Red
  exit 1
}
if (-not (Test-Port $cfgPort)) {
  Write-Host ("调试端口 $cfgPort 未开启 —— 当前这个 Cline 实例不是用「Cline 中文版」快捷方式启动的，无法接入汉化。") -ForegroundColor Yellow
  Write-Host '请完全退出 Cline，再双击桌面上的「Cline 中文版」快捷方式启动。'
  exit 1
}

$exe = Join-Path $env:LOCALAPPDATA 'Cline\cline-app.exe'
$logDir = Join-Path $base 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }
Start-Process -FilePath $node `
  -ArgumentList @(('"' + (Join-Path $base 'tools\cline-zh.mjs') + '"'), 'run', '--port', "$cfgPort", '--exe', ('"' + $exe + '"'), '--dict', '"..\dict\zh-cn.json"') `
  -WorkingDirectory $base -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logDir 'injector.out.log') `
  -RedirectStandardError (Join-Path $logDir 'injector.err.log') | Out-Null
Write-Host '已重新启动汉化注入器。' -ForegroundColor Green