@echo off
chcp 65001 >nul
echo 下载词典来源到 vendor\（可选维护操作）...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\fetch-sources.ps1"
pause
