# ============================================================
#  打包 Cline 一键汉化包 ZIP（用于 GitHub Release 发布）
#  - 复制必要文件到临时目录
#  - 排除 node/、logs/、.git 等不需要发布的内容
#  - 输出 cline-desktop-zh-one-click.zip
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\pack-one-click.ps1
# ============================================================
$ErrorActionPreference = 'Stop'
$base = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$out = Join-Path $base 'cline-desktop-zh-one-click.zip'
$tmp = Join-Path $env:TEMP ('cline-zh-pack-' + [guid]::NewGuid().ToString('N'))

# ---------- 要打包的文件/目录 ----------
$include = @(
  'one-click/one-click-setup.ps1',
  'one-click/one-click-launch.vbs',
  'one-click/README-ONE-CLICK.md',
  'dict/zh-cn.json',
  'dict/fragments.json',
  'dict/manual.json',
  'dict/overrides.json',
  'scripts/launch.ps1',
  'scripts/setup.ps1',
  'tools/cline-zh.mjs',
  'tools/apply-dict.mjs',
  'tools/translator.js',
  'tools/config.mjs',
  'config.json',
  'LICENSE',
  'NOTICE.md',
  'README.md'
)

if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

foreach ($rel in $include) {
  $src = Join-Path $base $rel
  $dst = Join-Path $tmp $rel
  if (-not (Test-Path $src)) {
    Write-Warning "跳过（不存在）: $rel"
    continue
  }
  $dstDir = Split-Path -Parent $dst
  if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Force -Path $dstDir | Out-Null }
  if ((Get-Item $src).PSIsContainer) {
    Copy-Item -Recurse -Force -Path $src -Destination $dst
  } else {
    Copy-Item -Force -Path $src -Destination $dst
  }
  Write-Host "打包: $rel"
}

# ---------- 生成 ZIP ----------
if (Test-Path $out) { Remove-Item -Force $out }
Compress-Archive -Path "$tmp\*" -DestinationPath $out -Force
Remove-Item -Recurse -Force $tmp

$size = [math]::Round((Get-Item $out).Length / 1KB, 1)
Write-Host ''
Write-Host ('打包完成: ' + $out)
Write-Host ('大小: ' + $size + ' KB')
