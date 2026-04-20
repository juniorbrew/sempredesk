@echo off
title SempreDesk - Copiar Chave Publica VPS
cd /d "%~dp0.."
echo ==========================================
echo SempreDesk - Copiar Chave Publica VPS
echo ==========================================
echo.
powershell -ExecutionPolicy Bypass -File ".\scripts\16-copiar-chave-publica-vps.ps1"
echo.
pause
