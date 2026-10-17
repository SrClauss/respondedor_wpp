# ========================================================
# 🚀 INICIAR APLICAÇÃO - ORQUESTRADOR WPP (PowerShell)
# ========================================================

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "🚀 INICIANDO ORQUESTRADOR WPP (Windows)" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

# 1. Verifica se Docker está instalado e acessível
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Docker não encontrado no PATH do Windows." -ForegroundColor Red
    Write-Host "Certifique-se de que o Docker Desktop está instalado e aberto." -ForegroundColor Yellow
    exit 1
}

# 2. Atualiza repositório local com a última versão se houver git
if (Test-Path ".git") {
    Write-Host "🔄 Atualizando repositório com a versão mais recente..." -ForegroundColor Cyan
    git pull origin main
}

# 3. Cria diretórios locais se não existirem
$folders = @("data", "downloads", "wpp_session")
foreach ($folder in $folders) {
    if (-not (Test-Path $folder)) {
        New-Item -ItemType Directory -Path $folder | Out-Null
    }
}

# 4. Sobe containers com Docker Compose
Write-Host "🐳 Subindo containers via Docker Compose..." -ForegroundColor Green
docker compose up -d --build

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================================" -ForegroundColor Green
    Write-Host "✅ APLICAÇÃO INICIADA COM SUCESSO!" -ForegroundColor Green
    Write-Host "👉 Acesse no navegador: http://localhost:8080" -ForegroundColor Cyan
    Write-Host "📱 Na aba 'Conexão WhatsApp', escaneie o QR Code." -ForegroundColor Yellow
    Write-Host "========================================================" -ForegroundColor Green
    
    # Opcional: abre automaticamente o navegador padrão
    Start-Process "http://localhost:8080"
} else {
    Write-Host "❌ Ocorreu um erro ao subir o container." -ForegroundColor Red
}
