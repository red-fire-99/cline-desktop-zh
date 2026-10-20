# ============================================================
#  创建 GitHub Release 并上传一键汉化包 ZIP
#  认证走 Git 凭据管理器（GCM），令牌仅内存流转
# ============================================================
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$REPO = 'red-fire-99/cline-desktop-zh'
$TAG = 'v1.0.12-one-click'
$ZIP = 'C:\Users\cuiyuxin\cline-desktop-zh\cline-desktop-zh-one-click.zip'
$API = "https://api.github.com/repos/$REPO"

# ---------- 取凭据（仅内存） ----------
$credIn = "$env:TEMP\zh-cred-rel.in"
[System.IO.File]::WriteAllText($credIn, "protocol=https`nhost=github.com`n`n", (New-Object System.Text.UTF8Encoding($false)))
$git = 'C:\Users\cuiyuxin\dev-tools\mingit\cmd\git.exe'
$credOut = "$env:TEMP\zh-cred-rel.out"
Start-Process -FilePath $git -ArgumentList @('credential', 'fill') `
  -RedirectStandardInput $credIn -RedirectStandardOutput $credOut -RedirectStandardError "$credOut.err" `
  -NoNewWindow -Wait | Out-Null
$token = $null
if (Test-Path $credOut) {
  foreach ($line in [System.IO.File]::ReadAllLines($credOut)) {
    if ($line -like 'password=*') { $token = $line.Substring(9) }
  }
}
foreach ($f in @($credIn, $credOut, "$credOut.err")) {
  if (Test-Path $f) { Clear-Content $f -ErrorAction SilentlyContinue; Remove-Item $f -Force -ErrorAction SilentlyContinue }
}
if (-not $token) { throw '取不到 GitHub 凭据：请先执行 git credential-manager github login' }
Write-Host "凭据已获取（长度: $($token.Length)）"

function api($method, $url, $file = $null) {
  $args = @('-sS', '-X', $method, '-H', "Authorization: Bearer $token", '-H', 'Accept: application/vnd.github+json', '-H', 'User-Agent: cline-zh-release')
  if ($file) { $args += @('-H', 'Content-Type: application/json; charset=utf-8', '--data-binary', "@$file") }
  $outFile = "$env:TEMP\zh-api-$method.json"
  $args += @('-o', $outFile, '--max-time', '90', $url)
  try {
    curl.exe @args 2>&1 | Out-Null
  } catch {
    $msg = $_.Exception.Message
    $msg = $msg -replace [regex]::Escape($token), '<TOKEN>'
    throw "API $method 失败: $msg"
  }
  Get-Content $outFile -Raw | ConvertFrom-Json
}

# ---------- 1) 创建/校正 Release ----------
$rel = $null
try {
  $parsed = api 'GET' "$API/releases/tags/$TAG"
  if ($parsed -and $parsed.id -and -not $parsed.message) { $rel = $parsed; Write-Host 'Release 已存在，校正标题/正文' }
} catch { Write-Host "查询 Release: $($_.Exception.Message)" }

if (-not $rel) {
  $body = Get-Content "$env:TEMP\zh-release-body.md" -Raw
  $relName = "$TAG 一键汉化包（零代码基础亦可使用）"
  $payload = @{ tag_name = $TAG; name = $relName; body = $body; draft = $false; prerelease = $false } | ConvertTo-Json -Depth 5
  [System.IO.File]::WriteAllText("$env:TEMP\zh-rel-body.json", $payload, (New-Object System.Text.UTF8Encoding($false)))
  $r = api 'POST' "$API/releases" "$env:TEMP\zh-rel-body.json"
  if (-not $r.html_url) { throw "创建 Release 失败: $r" }
  $rel = $r
  Write-Host "Release 创建成功: $($rel.html_url)"
}

# ---------- 2) 上传资产（裸体上传） ----------
$assetName = 'cline-desktop-zh-one-click.zip'
$existing = @($rel.assets | Where-Object { $_.name -eq $assetName })
if ($existing.Count -gt 0) {
  api 'DELETE' "$API/releases/assets/$($existing[0].id)"
  Write-Host "删除已有同名资产 id=$($existing[0].id)"
}

$uploadUrl = "https://uploads.github.com/repos/$REPO/releases/$($rel.id)/assets?name=$([uri]::EscapeDataString($assetName))"
$args = @('-sS', '-X', 'POST', '-H', "Authorization: Bearer $token", '-H', 'Accept: application/vnd.github+json', '-H', 'User-Agent: cline-zh-release', '-H', 'Content-Type: application/zip', '--data-binary', "@$ZIP", '--max-time', '300', '-o', "$env:TEMP\zh-up.json", $uploadUrl)
try {
  curl.exe @args 2>&1 | Out-Null
} catch {
  $msg = $_.Exception.Message -replace [regex]::Escape($token), '<TOKEN>'
  throw "资产上传失败: $msg"
}
$raw = Get-Content "$env:TEMP\zh-up.json" -Raw
if ($raw -notmatch '"browser_download_url"') { throw "资产上传失败: $raw" }
$asset = $raw | ConvertFrom-Json
$size = [math]::Round((Get-Item $ZIP).Length / 1KB, 1)
Write-Host ""
Write-Host "================ 发布完成 ================"
Write-Host ("资产: " + $asset.name + "  (" + $size + " KB)")
Write-Host ("下载: " + $asset.browser_download_url)
Write-Host ("Release: " + $rel.html_url)
Write-Host "=========================================="
