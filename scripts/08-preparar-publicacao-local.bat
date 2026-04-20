@echo off
title SempreDesk - Preparar Publicacao Local
cd /d "%~dp0.."
echo ==========================================
echo SempreDesk - Preparar Publicacao Local
echo ==========================================
echo.
powershell -ExecutionPolicy Bypass -File ".\scripts\08-preparar-publicacao-local.ps1"
echo.
pause
