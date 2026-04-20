@echo off
title SempreDesk - Publicar Tudo no GitHub
cd /d "%~dp0.."
powershell -ExecutionPolicy Bypass -File ".\scripts\09-publicar-tudo-github.ps1"
echo.
pause
