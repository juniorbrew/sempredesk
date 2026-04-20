@echo off
title SempreDesk - Menu de Sequencia
cd /d "%~dp0.."
powershell -ExecutionPolicy Bypass -File ".\scripts\sempredesk-local-menu.ps1"
echo.
pause
