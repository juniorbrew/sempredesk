@echo off
title SempreDesk - 06 Backup Banco Local
cd /d "%~dp0.."
echo ==========================================
echo SempreDesk - Backup Banco Local
echo ==========================================
echo.
powershell -ExecutionPolicy Bypass -File ".\scripts\06-backup-banco-local.ps1"
echo.
pause
