@echo off
title SempreDesk - 03 Validar Ambiente Local
cd /d "%~dp0.."
echo ==========================================
echo SempreDesk - Etapa 3 de 4
echo Validar Ambiente Local
echo ==========================================
echo.
echo Esta etapa verifica containers, frontend e backend locais.
echo.
powershell -ExecutionPolicy Bypass -File ".\scripts\03-validar-ambiente-local.ps1"
echo.
pause
