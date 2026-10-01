@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo ============================================================
echo  扫描 Cline 前端资源，列出「词典还没覆盖」的英文文案
echo  只读操作：不会重启 Cline，也不会打断当前会话
echo  需要 Cline 正以中文模式运行（调试端口已开启）
echo ============================================================
echo.
"%~dp0..\node\node.exe" "%~dp0..\tools\scan-ui-strings.mjs" --limit 200
echo.
echo 清单文件: tools\out\ui-strings-missing.txt
echo 选其中的界面文案，加进 dict\overrides.json（整条）或 dict\fragments.json（短语），
echo 然后运行 hot-apply-dict.cmd 即可立即生效。
pause