@echo off
title SempreDesk - 02 Aplicar Migracoes Locais
cd /d "%~dp0.."
echo ==========================================
echo SempreDesk - Etapa 2 de 4
echo Aplicar Migracoes Locais
echo ==========================================
echo.
echo Esta etapa aplica as migrations SQL no Postgres local do Docker.
echo.
powershell -ExecutionPolicy Bypass -File ".\scripts\apply-postgres-migrations-local.ps1"
echo.
pause
