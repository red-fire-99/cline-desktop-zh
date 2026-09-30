@echo off
chcp 65001 >nul
echo ============================================================
echo  Cline 中文版 —— 安装便携 Node.js 运行环境（无需管理员权限）
echo ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\setup.ps1"
echo.
pause
