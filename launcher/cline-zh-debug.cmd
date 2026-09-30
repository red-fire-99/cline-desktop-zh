@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo ============================================================
echo  以中文模式启动 Cline（调试窗口：可看到注入日志）
echo  - 请先完全退出正在运行的 Cline，否则无法连接调试端口
echo  - 关闭本窗口不影响 Cline 与汉化效果
echo ============================================================
echo.
"%~dp0..\node\node.exe" "%~dp0..\tools\cline-zh.mjs" run --exe "%LOCALAPPDATA%\Cline\cline-app.exe" --dict "..\dict\zh-cn.json" %*
echo.
echo 注入器已退出。
pause
