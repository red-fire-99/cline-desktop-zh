# ============================================================
#  安装/修补便携 Node.js 运行环境（无需管理员权限）
#  - 下载 Node.js LTS 官方 zip 并解压到 <仓库根>\node
#  - 失败时自动尝试 npmmirror 镜像
#  - 完成后可选创建桌面/开始菜单快捷方式
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup.ps1 [-Quiet]
# ============================================================
param(
  [switch]$Quiet
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

$base = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$nodeDir = Join-Path $base 'node'
$nodeExe = Join-Path $nodeDir 'node.exe'

if (Test-Path $nodeExe) {
  Write-Host "便携 Node.js 已存在: $nodeExe"
  & $nodeExe --version
} else {
  Write-Host '正在查询 Node.js LTS 版本 ...'
  $version = $null
  foreach ($mirror in @('https://nodejs.org/dist/index.json', 'https://registry.npmmirror.com/-/binary/node/index.json')) {
    try {
      $idx = Invoke-RestMethod -Uri $mirror -Headers @{ 'User-Agent' = 'cline-desktop-zh-setup' } -TimeoutSec 20
      $lts = $idx | Where-Object { $_.lts } | Select-Object -First 1
      if ($lts -and $lts.version) { $version = $lts.version; break }
    } catch { Write-Host "  镜像不可用: $mirror" }
  }
  if (-not $version) { throw '无法获取 Node.js 版本信息，请检查网络后重试。' }
  Write-Host "目标版本: $version"

  $zipPath = Join-Path $env:TEMP "node-$version-win-x64.zip"
  $urls = @(
    "https://nodejs.org/dist/$version/node-$version-win-x64.zip",
    "https://registry.npmmirror.com/-/binary/node/$version/node-$version-win-x64.zip"
  )
  $downloaded = $false
  foreach ($u in $urls) {
    try {
      Write-Host "下载: $u"
      Invoke-WebRequest -Uri $u -OutFile $zipPath -Headers @{ 'User-Agent' = 'cline-desktop-zh-setup' } -TimeoutSec 300
      $downloaded = $true
      break
    } catch { Write-Host "  下载失败: $($_.Exception.Message)" }
  }
  if (-not $downloaded) { throw 'Node.js 下载失败（nodejs.org 与 npmmirror 均不可用）。' }

  Write-Host "解压到: $nodeDir"
  $tmp = Join-Path $env:TEMP "node-extract-$([guid]::NewGuid().ToString('N'))"
  Expand-Archive -Path $zipPath -DestinationPath $tmp -Force
  $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
  if (Test-Path $nodeDir) { Remove-Item -Recurse -Force $nodeDir }
  Move-Item -Path $inner.FullName -Destination $nodeDir
  Remove-Item -Recurse -Force $tmp
  Remove-Item -Force $zipPath -ErrorAction SilentlyContinue

  if (-not (Test-Path $nodeExe)) { throw "解压后未找到 node.exe: $nodeExe" }
  Write-Host ('便携 Node.js 安装完成: ' + (& $nodeExe --version))
}

if (-not $Quiet) {
  $msg = '运行环境已就绪。' + "`n`n" + '是否创建桌面 / 开始菜单快捷方式「Cline 中文版」？'
  $ans = (New-Object -ComObject WScript.Shell).Popup($msg, 0, 'Cline 中文版 安装', 4 + 64)
  if ($ans -eq 6) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $base 'scripts\create-shortcuts.ps1')
  }
  Write-Host ''
  Write-Host '安装完成。以后双击 「Cline 中文版」 快捷方式即可用中文界面启动 Cline。'
}
