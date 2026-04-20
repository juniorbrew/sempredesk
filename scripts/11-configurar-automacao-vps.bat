@echo off
title SempreDesk - Configurar Automacao VPS
cd /d "%~dp0.."
echo ==========================================
echo SempreDesk - Configurar Automacao VPS
echo ==========================================
echo.
powershell -ExecutionPolicy Bypass -File ".\scripts\11-configurar-automacao-vps.ps1"
echo.
pause
