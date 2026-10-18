# ========================================================
# 🛑 PARAR APLICAÇÃO - ORQUESTRADOR WPP
# ========================================================

Write-Host "🛑 Encerrando processos do Orquestrador WPP..." -ForegroundColor Yellow

# 1. Encerra processos do Backend Rust
Get-Process -Name "respondedor_wpp" -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process -Name "cargo" -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. Encerra processos do Node (WPP Server)
Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host "✔ Todos os serviços foram parados com sucesso." -ForegroundColor Green
Start-Sleep -Seconds 2
