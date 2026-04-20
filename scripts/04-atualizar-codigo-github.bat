@echo off
setlocal
title SempreDesk - Atualizar Codigo GitHub
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0\04-atualizar-codigo-github.ps1"
echo.
pause
