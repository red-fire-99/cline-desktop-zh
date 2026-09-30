# 停止后台汉化注入器（不影响正在运行的 Cline，界面保持中文直到重启）
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'cline-zh\.mjs' }
if (-not $procs) { Write-Host '没有发现正在运行的后台汉化进程。'; exit 0 }
foreach ($p in $procs) {
  try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; Write-Host ("已停止注入器 PID " + $p.ProcessId) }
  catch { Write-Host ("停止失败 PID " + $p.ProcessId + ": " + $_.Exception.Message) }
}
