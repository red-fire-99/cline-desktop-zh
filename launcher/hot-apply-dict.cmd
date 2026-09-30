@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo 热更新词典与翻译脚本到正在运行的中文界面 ...
"%~dp0..\node\node.exe" "%~dp0..\tools\apply-dict.mjs"
echo.
pause
