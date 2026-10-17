# ========================================================
# 🛑 PARAR APLICAÇÃO - ORQUESTRADOR WPP (PowerShell)
# ========================================================

Write-Host "🛑 Parando Orquestrador WPP..." -ForegroundColor Yellow
docker compose down

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Aplicação parada com sucesso." -ForegroundColor Green
} else {
    Write-Host "❌ Falha ao parar os containers." -ForegroundColor Red
}
