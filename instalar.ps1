# ========================================================
# 🚀 INSTALADOR AUTOMÁTICO - ORQUESTRADOR WPP (Windows)
# ========================================================
Set-ExecutionPolicy Bypass -Scope Process -Force
$ErrorActionPreference = "Continue"

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "📦 INSTALANDO PRÉ-REQUISITOS (CHROME, GIT, NODE, RUST)..." -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

# 1. Google Chrome
if (-not (Test-Path "C:\Program Files\Google\Chrome\Application\chrome.exe") -and -not (Test-Path "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe")) {
    Write-Host ">>> Instalando Google Chrome..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://dl.google.com/chrome/install/latest/chrome_installer.exe" -OutFile "$env:TEMP\chrome_installer.exe"
    Start-Process "$env:TEMP\chrome_installer.exe" -Wait -ArgumentList "/silent /install"
} else {
    Write-Host "✔ Google Chrome já instalado." -ForegroundColor Green
}

# 2. Git
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host ">>> Instalando Git for Windows..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/Git-2.47.1-64-bit.exe" -OutFile "$env:TEMP\git-setup.exe"
    Start-Process "$env:TEMP\git-setup.exe" -Wait -ArgumentList "/VERYSILENT /NORESTART"
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
} else {
    Write-Host "✔ Git já instalado." -ForegroundColor Green
}

# 3. Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host ">>> Instalando Node.js (LTS)..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi" -OutFile "$env:TEMP\node.msi"
    Start-Process msiexec.exe -Wait -ArgumentList "/i `"$env:TEMP\node.msi`" /quiet /norestart"
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
} else {
    Write-Host "✔ Node.js já instalado." -ForegroundColor Green
}

# 4. Rust / Cargo
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Host ">>> Instalando Rust / Cargo..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe" -OutFile "$env:TEMP\rustup-init.exe"
    Start-Process "$env:TEMP\rustup-init.exe" -Wait -ArgumentList "-y"
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User") + ";$env:USERPROFILE\.cargo\bin"
} else {
    Write-Host "✔ Rust/Cargo já instalado." -ForegroundColor Green
}

# 5. Criar pastas do NPM e do Projeto
New-Item -ItemType Directory -Path "$env:APPDATA\npm" -Force | Out-Null
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# 6. Compilar Frontend
Write-Host ">>> Instalando dependências e compilando Frontend..." -ForegroundColor Cyan
Set-Location "$scriptDir\frontend"
npm install
npm run build

# 7. Instalar dependências do WPP Server
Write-Host ">>> Instalando dependências do WhatsApp Server..." -ForegroundColor Cyan
Set-Location "$scriptDir\wpp_server"
npm install

Set-Location $scriptDir
New-Item -ItemType Directory -Path "data", "downloads", "wpp_session" -Force | Out-Null

Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
Write-Host "🎉 INSTALAÇÃO FINALIZADA COM SUCESSO!" -ForegroundColor Green
Write-Host "👉 Para iniciar o robô a qualquer momento, execute: .\iniciar.ps1 (ou dois cliques em iniciar.bat)" -ForegroundColor Yellow
Write-Host "========================================================" -ForegroundColor Green
