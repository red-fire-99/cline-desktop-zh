# 查看汉化状态：注入状态 + 界面汉化覆盖报告
$base = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$node = Join-Path $base 'node\node.exe'

if (-not (Test-Path $node)) {
  Write-Host '尚未安装便携 Node.js 运行环境。请先运行 launcher\setup.cmd 。'
  exit 0
}

$port = 9223
$cfgPath = Join-Path $base 'config.json'
if (Test-Path $cfgPath) {
  try { $j = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json; if ($j.port) { $port = [int]$j.port } } catch { }
}

$up = $false
try { Invoke-RestMethod "http://127.0.0.1:$port/json/version" -TimeoutSec 2 | Out-Null; $up = $true } catch { }
if (-not $up) {
  Write-Host "未检测到本机 CDP 调试端口 $port。"
  Write-Host '说明当前 Cline 不是通过 “Cline 中文版” 启动器启动的（或注入器已停止）。'
  Write-Host '请先完全退出 Cline，再用桌面上的 “Cline 中文版” 快捷方式启动，然后重新运行本检查。'
  exit 0
}

Write-Host '=== 注入状态 ==='
& $node (Join-Path $base 'tools\cline-zh.mjs') verify --port $port
Write-Host ''
Write-Host '=== 界面汉化覆盖报告 ==='
& $node (Join-Path $base 'tools\report.mjs') --port $port
Write-Host ''
Write-Host '提示: 报告里的“未翻译”可能包含聊天内容与模型名，属正常现象；'
Write-Host '      若发现界面文案漏翻，把 Cline 停到对应页面后运行 launcher\find-missing.cmd 。'

