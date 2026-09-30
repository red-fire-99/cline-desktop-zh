@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo 从 vendor\ 合并各开源词典 -^> dict\zh-cn.json
echo （若提示来源缺失，请先运行 fetch-sources.cmd 下载来源）
echo.
"%~dp0..\node\node.exe" "%~dp0..\tools\build-dict.mjs"
echo.
pause
