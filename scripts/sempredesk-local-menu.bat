@echo off
cd /d "%~dp0.."
powershell -ExecutionPolicy Bypass -File ".\scripts\sempredesk-local-menu.ps1"
pause
