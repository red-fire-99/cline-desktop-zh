# ============================================================
#  一键发布到 GitHub（向导式，面向完全没接触过 git 的用户）
#
#  用法:
#    launcher\publish-github.cmd                          向导发布
#    powershell -File scripts\publish-github.ps1 -SelfTest 本地自检（不联网）
#
#  流程: 检查 git -> 检查工作区 -> 设置提交身份 -> 填仓库信息
#        -> （可选）用 Token 自动在 GitHub 建仓库 -> 推送并校验
#  不会把 Token 写入任何文件或 .git/config
# ============================================================
param(
  [switch]$SelfTest,
  [switch]$TokenOnly,     # 跳过所有提问：直接要 Token -> 建仓库 -> 推送
  [switch]$PrepareOnly,   # 只做检查/身份设置/信息收集，不推送
  [string]$User,          # 预填: GitHub 用户名
  [string]$RepoName,      # 预填: 仓库名
  [string]$Email,         # 预填: 提交邮箱
  [string]$DisplayName,   # 预填: 提交昵称
  [string]$Visibility = 'public'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$base = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

# ---------- 找 git ----------
function Find-Git {
  $cands = @()
  $cmd = Get-Command git -ErrorAction SilentlyContinue
  if ($cmd) { $cands += $cmd.Source }
  $cands += "$env:ProgramFiles\Git\cmd\git.exe"
  $cands += "${env:ProgramFiles(x86)}\Git\cmd\git.exe"
  $cands += "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe"
  $cands += "$env:USERPROFILE\dev-tools\mingit\cmd\git.exe"
  foreach ($c in $cands) {
    if ($c -and (Test-Path $c)) { return $c }
  }
  return $null
}

function Invoke-Git {
  param([string[]]$GitArgs, [switch]$AllowFail)
  $out = & $git -C $repo @GitArgs 2>&1
  if ($LASTEXITCODE -ne 0 -and -not $AllowFail) {
    throw "git $($GitArgs -join ' ') 执行失败:`n$($out -join "`n")"
  }
  return $out
}

function Ask([string]$Question, [string]$Default = '') {
  $tip = if ($Default) { "$Question（直接回车 = $Default）" } else { $Question }
  $ans = Read-Host $tip
  if ([string]::IsNullOrWhiteSpace($ans)) { return $Default }
  return $ans.Trim()
}

$git = Find-Git
if (-not $git) {
  Write-Host '未找到 git。' -ForegroundColor Red
  Write-Host '请先安装 Git for Windows: https://git-scm.com/download/win'
  Write-Host '（安装时保持默认选项即可，装完后重新运行本向导）'
  exit 1
}
Write-Host "使用 git: $git" -ForegroundColor DarkGray
$repo = $base

# ---------- 本地自检: 推到临时裸仓库, 证明 git 链路正常 ----------
if ($SelfTest) {
  Write-Host '=== 自检: 用本地临时仓库验证 git 链路（不联网） ==='
  $tmp = Join-Path $env:TEMP ("cline-zh-selftest-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  $bare = Join-Path $tmp 'remote.git'
  try {
    & $git init --bare -q $bare 2>$null | Out-Null
    & $git -C $repo push --quiet $bare main 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '推送到临时仓库失败' }
    $refs = & $git --git-dir $bare for-each-ref refs/heads 2>$null
    Write-Host ('临时远程分支: ' + (($refs | Out-String).Trim()))
    if (($refs | Out-String) -match 'main') {
      Write-Host '✔ 自检通过: 提交可以正常推送（本机 git 与仓库均正常）' -ForegroundColor Green
      exit 0
    }
    throw '临时远程仓库里没有 main 分支'
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
}
# ============================================================
#  第 1 步: 确认仓库状态（是否有未提交的改动）
# ============================================================
Write-Host ''
Write-Host '=== 第 1 步 / 检查仓库状态 ===' -ForegroundColor Cyan
Invoke-Git @('rev-parse', '--is-inside-work-tree') | Out-Null
$dirty = @(Invoke-Git @('status', '--porcelain') | Where-Object { $_ -and $_.Trim() })
$commits = Invoke-Git @('rev-list', '--count', 'HEAD') -AllowFail | Select-Object -First 1
if (-not $commits) { $commits = 0 }
if ([int]$commits -eq 0) {
  Invoke-Git @('add', '-A') | Out-Null
  Invoke-Git @('commit', '-m', 'feat: 初始版本') | Out-Null
  Write-Host '已创建首次提交。'
}
if ($dirty.Count -gt 0) {
  Write-Host ("发现 {0} 处未提交的改动:" -f $dirty.Count) -ForegroundColor Yellow
  $dirty | Select-Object -First 10 | ForEach-Object { Write-Host ("  " + $_) }
  $ans = Ask '是否现在把它们一起提交？(y/n)' 'y'
  if ($ans -match '^[yY]') {
    Invoke-Git @('add', '-A') | Out-Null
    Invoke-Git @('commit', '-m', 'chore: 更新内容') | Out-Null
    Write-Host '已提交。' -ForegroundColor Green
  }
}

# ============================================================
#  第 2 步: 提交身份（作者信息）
# ============================================================
Write-Host ''
Write-Host '=== 第 2 步 / 提交身份 ===' -ForegroundColor Cyan
$curName = Invoke-Git @('config', 'user.name') -AllowFail | Select-Object -First 1
$curMail = Invoke-Git @('config', 'user.email') -AllowFail | Select-Object -First 1
$isPlaceholder = (-not $curName) -or ($curName -eq 'cline-desktop-zh')
Write-Host ("当前身份: {0} <{1}>" -f ($(if ($curName) { $curName } else { '(未设置)' })), ($(if ($curMail) { $curMail } else { '(未设置)' })))
# 预填了邮箱就自动设置身份，并把历史提交作者统一成该身份（未推送前可安全改写）
$presetIdentity = $false
if ($Email) {
  $presetIdentity = $true
  if (-not $DisplayName) { $DisplayName = $User }
  Invoke-Git @('config', '--local', 'user.name', $DisplayName) | Out-Null
  Invoke-Git @('config', '--local', 'user.email', $Email) | Out-Null
  Write-Host ('已设置提交身份: ' + $DisplayName + ' <' + $Email + '>') -ForegroundColor Green
  $authors = Invoke-Git @('log', '--pretty=%ae') -AllowFail | Select-Object -Unique
  if (@($authors | Where-Object { $_ -ne $Email }).Count -gt 0) {
    Write-Host '正在把历史提交作者统一为该身份 ...'
    Invoke-Git @('rebase', '--root', '--exec', 'git commit --amend --reset-author --no-edit') -AllowFail | Out-Null
    Write-Host '历史作者已统一。' -ForegroundColor Green
  }
}
if ((-not $presetIdentity) -and $isPlaceholder) {
  Write-Host '这是占位身份，建议改成你自己的（会显示在提交记录里）。' -ForegroundColor Yellow
  $name = Ask '你的名字/昵称' $env:USERNAME
  $email = Ask '你的邮箱（GitHub 账号邮箱即可）' ''
  if ($email) {
    Invoke-Git @('config', '--local', 'user.name', $name) | Out-Null
    Invoke-Git @('config', '--local', 'user.email', $email) | Out-Null
    $ans = Ask '是否把最近一次提交的作者也改成这个身份？(y/n)' 'y'
    if ($ans -match '^[yY]') {
      Invoke-Git @('commit', '--amend', '--reset-author', '--no-edit') | Out-Null
      Write-Host '已更新提交作者。' -ForegroundColor Green
    }
  }
}

# ============================================================
#  第 3 步: 仓库信息
# ============================================================
Write-Host ''
Write-Host '=== 第 3 步 / 仓库信息 ===' -ForegroundColor Cyan
$ghUser = if ($User) { $User } else { Ask '你的 GitHub 用户名（例如 octocat）' '' }
if (-not $ghUser) { Write-Host '缺少用户名，已取消。' -ForegroundColor Red; exit 1 }
$repoName = if ($RepoName) { $RepoName } else { Ask '仓库名' 'cline-desktop-zh' }
$desc = 'Cline 桌面版（Windows）中文界面工具：运行时注入词典翻译，不修改官方文件，自动更新不受影响'
$isPrivate = ($Visibility -match 'private|私有|priv')
Write-Host ('  用户名: ' + $ghUser + '   仓库名: ' + $repoName + '   可见性: ' + $(if ($isPrivate) { '私有' } else { '公开' }))
$repoUrl = "https://github.com/$ghUser/$repoName"
$remote = "https://github.com/$ghUser/$repoName.git"

if ($PrepareOnly) {
  Write-Host ''
  Write-Host '✔ 准备工作完成（未推送任何内容）。' -ForegroundColor Green
  Write-Host ('  目标仓库: ' + $repoUrl)
  Write-Host '  下一步: 双击 launcher\finish-publish.cmd 粘贴 Token 即可自动建仓库并推送；'
  Write-Host '          或双击 launcher\publish-github.cmd 走完整向导。'
  exit 0
}
# ============================================================
#  第 4 步: 在 GitHub 上创建远程仓库
# ============================================================
Write-Host ''
Write-Host '=== 第 4 步 / 在 GitHub 上创建仓库 ===' -ForegroundColor Cyan
$token = $null
Write-Host '方式 A（推荐，全自动）：用 Token 让我帮你建仓库并推送。'
Write-Host '  1) 打开 https://github.com/settings/tokens/new'
Write-Host '  2) Note 随便填，Expiration 选 30 days，勾选 repo，然后 Generate token'
Write-Host '  3) 复制 token（只显示一次），粘贴到下面（输入时屏幕不显示，属正常）'
Write-Host '方式 B：自己在网页建仓库 —— 打开下面的地址点 Create repository，'
Write-Host '        注意不要勾选 README / .gitignore / license（本地已经有了）。'
Write-Host ''
Write-Host ("  " + $repoUrl + '/new?name=' + $repoName) -ForegroundColor Yellow
$ans = if ($TokenOnly) { 'A' } else { Ask '选 A 还是 B？(A/B)' 'B' }
if ($ans -match '^[aA]') {
  $sec = Read-Host '粘贴 Token（输入不可见，直接粘贴后回车）' -AsSecureString
  $token = [System.Net.NetworkCredential]::new('', $sec).Password
  Write-Host '正在用 Token 创建仓库 ...'
  $body = @{ name = $repoName; description = $desc; private = $isPrivate; auto_init = $false } | ConvertTo-Json
  try {
    $r = Invoke-RestMethod -Uri 'https://api.github.com/user/repos' -Method Post -ContentType 'application/json' `
      -Headers @{ 'User-Agent' = 'cline-desktop-zh-publish'; 'Authorization' = "Bearer $token" } -Body $body
    Write-Host ('已创建: ' + $r.html_url) -ForegroundColor Green
  } catch {
    if ($_.Exception.Message -match 'already exists|422') {
      Write-Host '该仓库名已存在，直接进入推送步骤。' -ForegroundColor Yellow
    } else {
      Write-Host ('创建失败: ' + $_.Exception.Message) -ForegroundColor Red
      Write-Host '请改用方式 B 手动创建，然后重新运行本向导。'
      exit 1
    }
  }
} else {
  Write-Host ''
  Write-Host '请在浏览器里完成创建，然后回到这里按回车继续 ...' -ForegroundColor Yellow
  Start-Process $repoUrl
  $null = Read-Host '完成后按回车继续'
}

# ============================================================
#  第 5 步: 关联并推送
# ============================================================
Write-Host ''
Write-Host '=== 第 5 步 / 推送 ===' -ForegroundColor Cyan
$existing = Invoke-Git @('remote') -AllowFail
if ($existing -contains 'origin') {
  Invoke-Git @('remote', 'set-url', 'origin', $remote) | Out-Null
  Write-Host '已更新 origin 地址。'
} else {
  Invoke-Git @('remote', 'add', 'origin', $remote) | Out-Null
  Write-Host '已关联远程仓库 origin。'
}

if ($token) {
  # Token 只在内存中使用一次，不写入 .git/config
  $pair = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($ghUser + ':' + $token))
  & $git -C $repo -c "http.extraheader=Authorization: Basic $pair" push -u origin main 2>&1 |
    ForEach-Object { Write-Host ("  " + $_) }
  $code = $LASTEXITCODE
} else {
  Invoke-Git @('push', '-u', 'origin', 'main') -AllowFail | ForEach-Object { Write-Host ("  " + $_) }
  $code = $LASTEXITCODE
}

if ($code -ne 0) {
  Write-Host ''
  Write-Host '推送没有成功。常见原因与办法：' -ForegroundColor Yellow
  Write-Host '  1) 需要登录：重跑本向导并选择方式 A（用 Token），最省事；'
  Write-Host '  2) 远程仓库不是空仓库：把 GitHub 上刚建的仓库删掉重建（不要勾任何初始化选项）；'
  Write-Host '  3) 想用图形界面：安装 GitHub Desktop → File → Open existing repository 选中本目录 → Publish。'
  exit 1
}

Write-Host ''
Write-Host '✔ 发布成功！' -ForegroundColor Green
Write-Host ('  仓库地址: ' + $repoUrl)
Write-Host ''
Write-Host '建议顺手做的三件事：'
Write-Host '  1) 仓库 About 里填简介，勾选 Topics: cline chinese localization i18n zh-cn windows webview2 cdp'
Write-Host '  2) 把 README 里的项目名/描述按你的仓库地址微调一下'
Write-Host '  3) 以后有更新就重复运行 launcher\publish-github.cmd'
Write-Host ''
Write-Host '别人怎么用：'
Write-Host ('  git clone ' + $remote)

