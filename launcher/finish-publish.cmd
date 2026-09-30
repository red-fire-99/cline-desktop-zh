@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo ============================================================
echo  最后一步：自动在 GitHub 建仓库并推送
echo  账号/仓库名/提交身份都已预填，你只需要粘贴一个 Token
echo ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\publish-github.ps1" -TokenOnly -User your-github-user -RepoName cline-desktop-zh -DisplayName your-github-user -Email your-github-user@users.noreply.github.com -Visibility public
echo.
pause
