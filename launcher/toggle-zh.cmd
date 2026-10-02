@echo off
chcp 65001 >nul
cd /d "%~dp0.."
rem 一键开/关汉化注入器（不重启 Cline）：开着就关掉，关着就重新接上
echo ============================================================
echo  汉化开关（一键开 / 关）
echo  - 如果当前在跑汉化 -> 直接关闭（界面保留已翻译内容，不再继续翻译）
echo  - 如果没在跑汉化   -> 重新启动（需要 Cline 是用「Cline 中文版」快捷方式启动的）
echo ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\toggle-zh.ps1"
echo.
pause