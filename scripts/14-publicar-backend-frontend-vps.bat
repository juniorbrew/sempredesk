@echo off
title SempreDesk - Publicar Backend e Frontend no VPS
cd /d "%~dp0.."
echo ==========================================
echo SempreDesk - Publicar Backend e Frontend no VPS
echo ==========================================
echo.
powershell -ExecutionPolicy Bypass -File ".\scripts\14-publicar-backend-frontend-vps.ps1"
echo.
pause
