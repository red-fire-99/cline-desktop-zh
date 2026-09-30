@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo ============================================================
echo  通过 GitHub API 发布（适用于 github.com 连不通、API 可通的网络）
echo  会自动: 检查网络 - 创建仓库 - 占位提交 - 设置 Topics - 同步提交历史
echo ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\publish-github-api.ps1" -User your-github-user -Repo cline-desktop-zh -Visibility public
echo.
pause
