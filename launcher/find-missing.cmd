@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo ============================================================
echo  查找漏翻文案（需要 Cline 正在以中文模式运行）
echo  执行前请把 Cline 停在没有翻译的页面（下拉菜单可保持展开）
echo ============================================================
echo.
"%~dp0..\node\node.exe" "%~dp0..\tools\find.mjs"
echo.
echo 结果文件: tools\out\todo.txt
echo 把译文填进 dict\zh-cn.json 后，运行 hot-apply-dict.cmd 可立即生效。
pause
