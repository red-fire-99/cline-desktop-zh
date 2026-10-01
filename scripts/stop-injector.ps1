# 停止后台汉化注入器（不影响正在运行的 Cline，界面保持中文直到重启）
param([string]$RepoDir)
$ErrorActionPreference = 'Continue'
$base = if ($RepoDir) { (Resolve-Path -LiteralPath $RepoDir).Path } else { Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path) }
$pidFile = Join-Path $base 'logs\injector.pid'

$stopped = 0
if (Test-Path $pidFile) {
  $oldPid = (Get-Content $pidFile -Raw -ErrorAction SilentlyContinue).Trim()
  if ($oldPid -match '^\d+$') {
    $p = Get-Process -Id ([int]$oldPid) -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -eq 'node') {
      Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
      Write-Host ('已停止注入器 PID ' + $p.Id)
      $stopped++
    }
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

if ($stopped -eq 0) {
  # 回退方案：结束所有「由本工具便携 Node 启动」的 node 进程（毫秒级，不依赖 CIM）
  $node = Join-Path $base 'node\node.exe'
  foreach ($p in @(Get-Process node -ErrorAction SilentlyContinue)) {
    try {
      if ($p.Path -eq $node) {
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
        Write-Host ('已停止注入器 PID ' + $p.Id)
        $stopped++
      }
    } catch { }
  }
  if ($stopped -eq 0) { Write-Host '没有发现正在运行的后台汉化进程。' }
}
