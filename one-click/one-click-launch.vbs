' ============================================================
'  Cline 中文版 一键启动器（无黑窗）
'  隐藏启动 PowerShell，调用 scripts\\launch.ps1 完成：
'    1) 检查便携 Node.js
'    2) 定位 Cline 主程序
'    3) 带调试端口启动 Cline
'    4) 后台运行中文注入器（翻译 UI）
' ============================================================
Option Explicit
Dim sh, fso, base, ps1

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' one-click/ 的上级目录 = 汉化包根目录
base = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = base & "\scripts\launch.ps1"

If Not fso.FileExists(ps1) Then
  MsgBox "找不到 launch.ps1：" & vbCrLf & ps1, 16, "Cline 中文版"
  WScript.Quit 1
End If

sh.CurrentDirectory = base
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """", 0, False
