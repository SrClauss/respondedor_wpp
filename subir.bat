@echo off
chcp 65001 >nul
title Orquestrador WPP - Iniciar

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0subir.ps1"

pause
