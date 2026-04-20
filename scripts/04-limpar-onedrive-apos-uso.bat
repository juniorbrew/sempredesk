@echo off
title SempreDesk - 04 Limpar OneDrive Apos Uso
cd /d "%~dp0.."
echo ==========================================
echo SempreDesk - Etapa 4 de 4
echo Limpar OneDrive Apos Uso
echo ==========================================
echo.
echo Esta etapa remove node_modules, .next e dist para aliviar a sincronizacao.
echo.
powershell -ExecutionPolicy Bypass -File ".\scripts\cleanup-onedrive-local.ps1"
echo.
pause
