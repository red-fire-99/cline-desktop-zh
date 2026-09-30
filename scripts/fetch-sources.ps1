# ============================================================
#  下载词典来源（vendor/）—— 仅在需要重建/扩充词典时运行
#  来源均来自开源仓库，许可见 NOTICE.md
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fetch-sources.ps1
# ============================================================
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

$base = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$vendor = Join-Path $base 'vendor'
foreach ($d in @('i18n', 'jack', 'aaxianyu', 'seventy73')) {
  New-Item -ItemType Directory -Force -Path (Join-Path $vendor $d) | Out-Null
}

$files = @(
  @{ url = 'https://raw.githubusercontent.com/HybridTalentComputing/cline-chinese/main/webview-ui/src/locales/en/common.json';                dest = 'i18n\en-common.json' },
  @{ url = 'https://raw.githubusercontent.com/HybridTalentComputing/cline-chinese/main/webview-ui/src/locales/en/common-misc.json';          dest = 'i18n\en-common-misc.json' },
  @{ url = 'https://raw.githubusercontent.com/HybridTalentComputing/cline-chinese/main/webview-ui/src/locales/en/settings.json';             dest = 'i18n\en-settings.json' },
  @{ url = 'https://raw.githubusercontent.com/HybridTalentComputing/cline-chinese/main/webview-ui/src/locales/zh-CN/common.json';            dest = 'i18n\zh-CN-common.json' },
  @{ url = 'https://raw.githubusercontent.com/HybridTalentComputing/cline-chinese/main/webview-ui/src/locales/zh-CN/common-misc.json';       dest = 'i18n\zh-CN-common-misc.json' },
  @{ url = 'https://raw.githubusercontent.com/HybridTalentComputing/cline-chinese/main/webview-ui/src/locales/zh-CN/settings.json';          dest = 'i18n\zh-CN-settings.json' },
  @{ url = 'https://raw.githubusercontent.com/JACK5920/cline-desktop-zh/main/dictionary.json';                                               dest = 'jack\dictionary.json' },
  @{ url = 'https://raw.githubusercontent.com/aaxianyu/cline-desktop-chinese/master/zh-cn.json';                                             dest = 'aaxianyu\zh-cn.json' },
  @{ url = 'https://raw.githubusercontent.com/Seventy73-oss/cline-desktop-cn/main/extension/dict.json';                                      dest = 'seventy73\dict.json' },
  @{ url = 'https://raw.githubusercontent.com/Seventy73-oss/cline-desktop-cn/main/extension/rules.json';                                     dest = 'seventy73\rules.json' }
)

$failed = @()
foreach ($f in $files) {
  $out = Join-Path $vendor $f.dest
  try {
    Invoke-WebRequest -Uri $f.url -OutFile $out -Headers @{ 'User-Agent' = 'cline-desktop-zh' } -TimeoutSec 60
    Write-Host ("OK   {0}  [{1} bytes]" -f $f.dest, (Get-Item $out).Length)
  } catch {
    $failed += $f.url
    Write-Host ("FAIL {0}  ({1})" -f $f.dest, $_.Exception.Message)
  }
}

Write-Host ''
if ($failed.Count) {
  Write-Host ("有 {0} 个来源下载失败（网络原因），其余已就绪。可稍后重试。" -f $failed.Count)
  exit 1
}
Write-Host '全部来源已下载到 vendor\ ，现在可以运行:'
Write-Host '  launcher\rebuild-dict.cmd    （重新合并词典）'
Write-Host '  launcher\hot-apply-dict.cmd  （热更新到正在运行的中文界面）'
