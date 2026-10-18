# ========================================================
# 🚀 INICIAR APLICAÇÃO - ORQUESTRADOR WPP
# ========================================================
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# 1. Atualizar repositório se houver git
if ((Test-Path ".git") -and (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "🔄 Verificando atualizações..." -ForegroundColor Cyan
    git pull origin main
}

# 2. Criar diretórios necessários
New-Item -ItemType Directory -Path "data", "downloads", "wpp_session" -Force | Out-Null

# 3. Iniciar o WhatsApp Server (Node.js porta 3001) em background invisível
Write-Host "📱 Iniciando WhatsApp Server (porta 3001)..." -ForegroundColor Yellow
Start-Process powershell -WindowStyle Hidden -ArgumentList "-Command", "cd `"$scriptDir\wpp_server`"; node index.js"

# 4. Aguardar 3 segundos para o wpp_server inicializar
Start-Sleep -Seconds 3

# 5. Abrir o navegador automaticamente
Write-Host "🌐 Abrindo interface no navegador..." -ForegroundColor Cyan
Start-Process "http://localhost:8080"

# 6. Iniciar o Backend Rust (porta 8080)
Write-Host "🦀 Iniciando Backend Rust na porta 8080..." -ForegroundColor Green
cargo run
