@echo off
cd /d "%~dp0.."
powershell -ExecutionPolicy Bypass -File ".\scripts\cleanup-onedrive-local.ps1"
pause
