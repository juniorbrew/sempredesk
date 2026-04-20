@echo off
title SempreDesk - Publicar Frontend no VPS
cd /d "%~dp0.."
echo ==========================================
echo SempreDesk - Publicar Frontend no VPS
echo ==========================================
echo.
powershell -ExecutionPolicy Bypass -File ".\scripts\13-publicar-frontend-vps.ps1"
echo.
pause
