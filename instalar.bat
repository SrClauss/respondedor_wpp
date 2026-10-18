@echo off
chcp 65001 >nul
title Orquestrador WPP - Instalação de Requisitos

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1"

pause
