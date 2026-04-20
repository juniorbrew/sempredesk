@echo off
title SempreDesk - 07 Restaurar Banco Local
cd /d "%~dp0.."
echo ==========================================
echo SempreDesk - Restaurar Banco Local
echo ==========================================
echo.
powershell -ExecutionPolicy Bypass -File ".\scripts\07-restaurar-banco-local.ps1"
echo.
pause
