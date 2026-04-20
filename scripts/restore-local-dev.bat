@echo off
cd /d "%~dp0.."
powershell -ExecutionPolicy Bypass -File ".\scripts\restore-local-dev.ps1"
pause
