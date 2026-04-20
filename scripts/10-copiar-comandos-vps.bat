@echo off
title SempreDesk - Copiar Comandos do VPS
cd /d "%~dp0.."
echo ==========================================
echo SempreDesk - Copiar Comandos do VPS
echo ==========================================
echo.
powershell -ExecutionPolicy Bypass -File ".\scripts\10-copiar-comandos-vps.ps1"
echo.
pause
