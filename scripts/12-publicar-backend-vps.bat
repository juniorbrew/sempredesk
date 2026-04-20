@echo off
title SempreDesk - Publicar Backend no VPS
cd /d "%~dp0.."
echo ==========================================
echo SempreDesk - Publicar Backend no VPS
echo ==========================================
echo.
powershell -ExecutionPolicy Bypass -File ".\scripts\12-publicar-backend-vps.ps1"
echo.
pause
