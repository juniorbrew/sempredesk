@echo off
title SempreDesk - Abrir Painel Local
cd /d "%~dp0.."
start "" wscript.exe ".\scripts\00-abrir-painel-local.vbs"
exit
