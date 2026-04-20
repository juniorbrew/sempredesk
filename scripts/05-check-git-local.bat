@echo off
title SempreDesk - 05 Check Git Local
cd /d "%~dp0.."
echo ==========================================
echo SempreDesk - Check Git Local
echo ==========================================
echo.
powershell -ExecutionPolicy Bypass -File ".\scripts\05-check-git-local.ps1"
echo.
pause
