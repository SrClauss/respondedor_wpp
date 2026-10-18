@echo off
chcp 65001 >nul
title Orquestrador WPP - Parar

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0parar.ps1"

timeout /t 2 >nul
