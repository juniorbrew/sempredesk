@echo off
title SempreDesk - Gerar Chave VPS
cd /d "%~dp0.."
echo ==========================================
echo SempreDesk - Gerar Chave VPS
echo ==========================================
echo.
powershell -ExecutionPolicy Bypass -File ".\scripts\15-gerar-chave-vps.ps1"
echo.
pause
