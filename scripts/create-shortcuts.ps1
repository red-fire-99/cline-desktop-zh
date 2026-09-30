# 创建 “Cline 中文版” 桌面与开始菜单快捷方式
$ErrorActionPreference = 'Stop'
$base = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$vbs = Join-Path $base 'launcher\cline-zh.vbs'
$icon = Join-Path $env:LOCALAPPDATA 'Cline\cline-app.exe'
if (-not (Test-Path $icon)) { $icon = Join-Path $env:ProgramFiles 'Cline\cline-app.exe' }

$ws = New-Object -ComObject WScript.Shell
$targets = @(
  [Environment]::GetFolderPath('Desktop'),
  [System.IO.Path]::Combine($env:APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
)
foreach ($dir in $targets) {
  if (-not (Test-Path $dir)) { continue }
  $lnkPath = Join-Path $dir 'Cline 中文版.lnk'
  $lnk = $ws.CreateShortcut($lnkPath)
  $lnk.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
  $lnk.Arguments = '"' + $vbs + '"'
  $lnk.WorkingDirectory = $base
  $lnk.Description = 'Cline 桌面版（中文界面）'
  if (Test-Path $icon) { $lnk.IconLocation = "$icon,0" }
  $lnk.Save()
  Write-Host "已创建快捷方式: $lnkPath"
}
Write-Host ''
Write-Host '完成。以后从这个 “Cline 中文版” 快捷方式启动即为中文界面；'
Write-Host '从原来的 Cline 图标启动仍是英文界面。'
