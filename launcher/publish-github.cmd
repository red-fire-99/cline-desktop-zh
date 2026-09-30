@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo ============================================================
echo  一键发布到 GitHub（向导模式，全程中文提问，直接回车用默认值）
echo  建议先跑一次本地自检: powershell -File scripts\publish-github.ps1 -SelfTest
echo ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\publish-github.ps1"
echo.
pause
