# ============================================================
#  通过 GitHub API 发布（当 github.com 连不通、但 api.github.com 可用时）
#  例如: 国内网络下 git push 超时，但 API 通道可用。
#
#  用法: launcher\publish-github-api.cmd
#  参数: -User your-github-user -Repo cline-desktop-zh [-Visibility public]
# ============================================================
param(
  [string]$User = 'your-github-user',
  [string]$Repo = 'cline-desktop-zh',
  [string]$Visibility = 'public',
  [string]$Description = 'Cline 桌面版（Windows）中文界面工具：运行时注入词典翻译，不修改官方文件，自动更新不受影响',
  [string]$Topics = 'cline,chinese,localization,i18n,zh-cn,windows,webview2,cdp,tauri'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$base = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$node = Join-Path $base 'node\node.exe'
if (-not (Test-Path $node)) { Write-Host '缺少便携 Node.js，请先运行 launcher\setup.cmd' -ForegroundColor Red; exit 1 }

function Call-Api {
  param([string]$Method, [string]$Uri, $Body, $Headers)
  $h = $Headers
  $params = @{ Method = $Method; Uri = $Uri; Headers = $h; TimeoutSec = 25 }
  if ($null -ne $Body) {
    $params['ContentType'] = 'application/json; charset=utf-8'
    $params['Body'] = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 5 -Compress))
  }
  Invoke-RestMethod @params
}

Write-Host '=== 1/4  检查网络与仓库 ===' -ForegroundColor Cyan
try {
  Invoke-RestMethod -Uri 'https://api.github.com/rate_limit' -Headers @{ 'User-Agent' = 'check' } -TimeoutSec 10 | Out-Null
  Write-Host 'api.github.com 可访问'
} catch {
  Write-Host ('api.github.com 不可访问: ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host '本通道依赖 API，请先确保 api.github.com 能连通（或配置代理）。'
  exit 1
}

Write-Host ''
Write-Host '=== 2/4  填写 Token ===' -ForegroundColor Cyan
Write-Host '打开 https://github.com/settings/tokens/new'
Write-Host 'Note 随便填，Expiration 选 30 days，勾选 repo，Generate token 后复制（只显示一次）'
$sec = Read-Host '粘贴 Token（输入不可见，直接粘贴后回车）' -AsSecureString
$token = [System.Net.NetworkCredential]::new('', $sec).Password
if (-not $token) { Write-Host '未提供 Token，已取消。' -ForegroundColor Red; exit 1 }
$headers = @{ 'User-Agent' = 'cline-desktop-zh-publish'; 'Authorization' = "Bearer $token"; 'Accept' = 'application/vnd.github+json' }
$api = "https://api.github.com/repos/$User/$Repo"

Write-Host ''
Write-Host '=== 3/4  准备远端仓库 ===' -ForegroundColor Cyan
$repoInfo = $null
try { $repoInfo = Call-Api -Method 'GET' -Uri $api -Headers $headers } catch { }
if (-not $repoInfo) {
  Write-Host "远端仓库不存在，正在创建 $User/$Repo ..."
  $repoInfo = Call-Api -Method 'POST' -Uri 'https://api.github.com/user/repos' -Headers $headers `
    -Body @{ name = $Repo; description = $Description; private = ($Visibility -eq 'private'); auto_init = $false; has_wiki = $false }
  Write-Host ('已创建: ' + $repoInfo.html_url) -ForegroundColor Green
} else {
  Write-Host ('远端仓库已存在: ' + $repoInfo.html_url)
}
# 空仓库无法直接使用 Git Data API（返回 409），先建一个占位提交
$commits = @()
try { $commits = @(Call-Api -Method 'GET' -Uri "$api/commits?per_page=1" -Headers $headers) } catch { }
if ($commits.Count -eq 0) {
  Write-Host '远端为空仓库，先创建占位提交（稍后会被正式历史替换）...'
  $ph = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('placeholder'))
  Call-Api -Method 'PUT' -Uri "$api/contents/.gitkeep" -Headers $headers `
    -Body @{ message = 'chore: 初始化仓库'; content = $ph; branch = 'main' } | Out-Null
  Write-Host '占位提交已创建。'
}
if ($Topics) {
  try {
    Call-Api -Method 'PUT' -Uri "$api/topics" -Headers $headers `
      -Body @{ names = @($Topics -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }) } | Out-Null
    Write-Host 'Topics 已设置'
  } catch { Write-Host ('Topics 设置失败: ' + $_.Exception.Message) -ForegroundColor Yellow }
}

Write-Host ''
Write-Host '=== 4/4  同步提交历史（blob / tree / commit / 分支） ===' -ForegroundColor Cyan
$env:GITHUB_TOKEN = $token
& $node (Join-Path $base 'tools\publish-via-api.mjs') --repo "$User/$Repo"
$code = $LASTEXITCODE
$env:GITHUB_TOKEN = $null
$token = $null

if ($code -ne 0) { Write-Host '发布失败，请把上面的错误信息发出来。' -ForegroundColor Red; exit 1 }
Write-Host ''
Write-Host '✔ 发布完成' -ForegroundColor Green
Write-Host ('  仓库: https://github.com/' + $User + '/' + $Repo)
Write-Host ''
Write-Host '提醒: Token 只在本次运行内存中使用；若曾粘贴到聊天/脚本里，请到'
Write-Host '      https://github.com/settings/tokens 撤销它。'
