# ============================================================
#  Cline 桌面版一键汉化包（无需代码基础，解压即用）
#  - 自动检测已安装的 Cline 桌面版
#  - 自动下载便携 Node.js 运行环境（约 40MB，来自 nodejs.org）
#  - 一键创建桌面 / 开始菜单快捷方式「Cline 中文版」
#  - 以后双击快捷方式即可启动中文界面 Cline
#  用法: 双击 one-click-setup.ps1（或右键 → 用 PowerShell 运行）
# ============================================================
param(
  [switch]$Quiet
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

# ---------- 本脚本所在目录 = 汉化包根目录 ----------
$base = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $base) { $base = '.' }
$base = (Resolve-Path $base).Path

$nodeDir = Join-Path $base 'node'
$nodeExe = Join-Path $nodeDir 'node.exe'
$launchPs1 = Join-Path $base 'scripts\\launch.ps1'
$vbsShim   = Join-Path $base 'one-click-launch.vbs'

function Say($m) { $s = "[$(Get-Date -Format 'HH:mm:ss')] $m"; Write-Host $s }

function ShowMsg([string]$text, [int]$type = 0) {
  return (New-Object -ComObject WScript.Shell).Popup($text, 0, 'Cline 一键汉化包', $type)
}

# ---------- 步骤 1：检测已安装的 Cline 桌面版 ----------
Say '正在检测 Cline 桌面版安装路径 ...'
$candidates = @(
  (Join-Path $env:LOCALAPPDATA 'Cline\\cline-app.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs\\Cline\\cline-app.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs\\cline\\cline-app.exe'),
  (Join-Path $env:ProgramFiles 'Cline\\cline-app.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Cline\\cline-app.exe')
)
$clineExe = $null
foreach ($c in $candidates) {
  if (Test-Path $c) { $clineExe = $c; break }
}
if (-not $clineExe) {
  # 尝试从注册表读取安装位置
  try {
    $un = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue |
          Where-Object { $_.DisplayName -eq 'Cline' } | Select-Object -First 1
    if ($un -and $un.InstallLocation) {
      $cand = Join-Path ($un.InstallLocation.Trim('"')) 'cline-app.exe'
      if (Test-Path $cand) { $clineExe = $cand }
    }
  } catch { }
}
if (-not $clineExe) {
  $msg = '未检测到已安装的 Cline 桌面版。`n`n' +
         '请先从 https://cline.bot 下载并安装官方 Cline 桌面客户端，' +
         '安装完成后再运行本脚本。'
  Say $msg
  if (-not $Quiet) { ShowMsg $msg 16 }
  exit 1
}
Say ('已检测到 Cline：' + $clineExe)

# ---------- 步骤 2：便携 Node.js 运行环境 ----------
if (-not (Test-Path $nodeExe)) {
  Say '未找到便携 Node.js，准备下载（约 40MB）...'
  $version = $null
  foreach ($mirror in @('https://nodejs.org/dist/index.json', 'https://registry.npmmirror.com/-/binary/node/index.json')) {
    try {
      $idx = Invoke-RestMethod -Uri $mirror -Headers @{ 'User-Agent' = 'cline-zh-one-click' } -TimeoutSec 20
      $lts = $idx | Where-Object { $_.lts } | Select-Object -First 1
      if ($lts -and $lts.version) { $version = $lts.version; break }
    } catch { Say "  镜像不可用: $mirror" }
  }
  if (-not $version) {
    $msg = '无法获取 Node.js 版本信息，请检查网络后重试。'
    Say $msg
    if (-not $Quiet) { ShowMsg $msg 16 }
    exit 1
  }
  Say ('目标版本: ' + $version)

  $zipPath = Join-Path $env:TEMP "cline-zh-node-$version-win-x64.zip"
  $urls = @(
    "https://nodejs.org/dist/$version/node-$version-win-x64.zip",
    "https://registry.npmmirror.com/-/binary/node/$version/node-$version-win-x64.zip"
  )
  $downloaded = $false
  foreach ($u in $urls) {
    try {
      Say ('下载: ' + $u)
      Invoke-WebRequest -Uri $u -OutFile $zipPath -Headers @{ 'User-Agent' = 'cline-zh-one-click' } -TimeoutSec 300
      $downloaded = $true
      break
    } catch { Say "  下载失败: $($_.Exception.Message)" }
  }
  if (-not $downloaded) {
    $msg = 'Node.js 下载失败（nodejs.org 与 npmmirror 均不可用，请检查网络）。'
    Say $msg
    if (-not $Quiet) { ShowMsg $msg 16 }
    exit 1
  }

  Say '正在解压 Node.js ...'
  $tmp = Join-Path $env:TEMP ("cline-zh-node-extract-" + [guid]::NewGuid().ToString('N'))
  Expand-Archive -Path $zipPath -DestinationPath $tmp -Force
  $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
  if (Test-Path $nodeDir) { Remove-Item -Recurse -Force $nodeDir }
  Move-Item -Path $inner.FullName -Destination $nodeDir
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  Remove-Item -Force $zipPath -ErrorAction SilentlyContinue

  if (-not (Test-Path $nodeExe)) {
    $msg = "解压后未找到 node.exe: $nodeExe"
    Say $msg
    if (-not $Quiet) { ShowMsg $msg 16 }
    exit 1
  }
  Say ('便携 Node.js 安装完成: ' + (& $nodeExe --version))
} else {
  Say ('便携 Node.js 已存在: ' + (& $nodeExe --version))
}

# ---------- 步骤 3：创建快捷方式（桌面 + 开始菜单） ----------
Say '正在创建「Cline 中文版」快捷方式 ...'
$ws = New-Object -ComObject WScript.Shell
$icon = $clineExe

$targets = @(
  [Environment]::GetFolderPath('Desktop'),
  [System.IO.Path]::Combine($env:APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
)
$created = 0
foreach ($dir in $targets) {
  if (-not (Test-Path $dir)) { continue }
  $lnkPath = Join-Path $dir 'Cline 中文版.lnk'
  $lnk = $ws.CreateShortcut($lnkPath)
  $lnk.TargetPath = Join-Path $env:SystemRoot 'System32\\wscript.exe'
  $lnk.Arguments = '\"' + $vbsShim + '\"'
  $lnk.WorkingDirectory = $base
  $lnk.Description = 'Cline 桌面版（中文界面 / 一键汉化包）'
  if (Test-Path $icon) { $lnk.IconLocation = "$icon,0" }
  $lnk.Save()
  Say ('已创建: ' + $lnkPath)
  $created++
}

if ($created -eq 0) {
  $msg = '未能创建快捷方式（未找到桌面或开始菜单目录）。`n`n' +
         '你可以手动运行：' + $base + '\\one-click-launch.vbs'
  Say $msg
  if (-not $Quiet) { ShowMsg $msg 48 }
} else {
  $msg = '安装完成！共创建 ' + $created + ' 个「Cline 中文版」快捷方式。`n`n' +
         '以后双击快捷方式即可启动中文界面 Cline。`n' +
         '如需卸载，直接删除本文件夹即可（不注册表、不写系统目录）。'
  Say $msg
  if (-not $Quiet) { ShowMsg $msg 64 }
}

if (-not $Quiet) {
  Write-Host ''
  Write-Host '========== 使用说明 =========='
  Write-Host '1. 双击桌面上的 “Cline 中文版” 快捷方式启动。'
  Write-Host '2. 首次运行会自动检测并启动 Cline，再自动注入中文词典。'
  Write-Host '3. 如果 Cline 已在运行（英文模式），会提示重启为中文模式。'
  Write-Host '4. 日志保存在：' + (Join-Path $base 'logs')
  Write-Host '5. 如需卸载：直接删除本文件夹即可。'
  Write-Host '=============================='
  $null = $sh.Popup('安装完成！以后双击 “Cline 中文版” 快捷方式启动中文界面。', 0, 'Cline 一键汉化包', 64)
}
