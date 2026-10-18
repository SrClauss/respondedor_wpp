@echo off
chcp 65001 >nul
title Orquestrador WPP - Iniciar

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar.ps1"

pause
