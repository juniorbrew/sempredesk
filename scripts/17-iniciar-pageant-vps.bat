@echo off
title SempreDesk - Iniciar Pageant VPS
cd /d "%~dp0.."
echo ==========================================
echo SempreDesk - Iniciar Pageant VPS
echo ==========================================
echo.
powershell -ExecutionPolicy Bypass -File ".\scripts\17-iniciar-pageant-vps.ps1"
echo.
pause
