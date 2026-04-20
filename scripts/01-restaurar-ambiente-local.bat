@echo off
title SempreDesk - 01 Restaurar Ambiente Local
cd /d "%~dp0.."
echo ==========================================
echo SempreDesk - Etapa 1 de 4
echo Restaurar Ambiente Local
echo ==========================================
echo.
echo Esta etapa instala dependencias, gera build e sobe backend/frontend.
echo.
powershell -ExecutionPolicy Bypass -File ".\scripts\restore-local-dev.ps1"
echo.
pause
