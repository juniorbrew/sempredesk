Set shell = CreateObject("WScript.Shell")
scriptPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
repoRoot = CreateObject("Scripting.FileSystemObject").GetParentFolderName(scriptPath)
command = "powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & repoRoot & "\scripts\00-painel-local-winforms.ps1"""
shell.Run command, 0, False
