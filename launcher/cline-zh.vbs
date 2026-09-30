' ============================================================
'  Cline Desktop ZH launcher (windowless shim)
'  Starts scripts\launch.ps1 hidden, so no console window shows.
'  All real logic lives in PowerShell (see scripts\launch.ps1).
' ============================================================
Option Explicit
Dim sh, fso, base, ps1
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' repo root = parent folder of this script's folder (launcher\)
base = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
ps1 = base & "\scripts\launch.ps1"

If Not fso.FileExists(ps1) Then
  MsgBox "launch.ps1 not found:" & vbCrLf & ps1, 16, "Cline Desktop ZH"
  WScript.Quit 1
End If

sh.CurrentDirectory = base
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """", 0, False