#!/bin/bash
set -e

echo "========================================================"
echo "🚀 INSTALADOR AUTOMÁTICO - ORQUESTRADOR WPP"
echo "========================================================"

# 1. Verifica pré-requisitos
if ! command -v git &> /dev/null; then
    echo "📦 Instalando git..."
    sudo apt-get update && sudo apt-get install -y git || true
fi

if ! command -v docker &> /dev/null; then
    echo "❌ Docker não encontrado. Por favor, instale o Docker antes de continuar."
    exit 1
fi

# 2. Clona ou atualiza o repositório
REPO_URL="https://github.com/SrClauss/respondedor_wpp.git"
TARGET_DIR="respondedor_wpp"

if [ -d "$TARGET_DIR/.git" ]; then
    echo "🔄 Repositório já existe. Atualizando com a versão mais recente..."
    cd "$TARGET_DIR"
    git pull origin main
elif [ -f "docker-compose.yml" ]; then
    echo "📁 Já dentro da pasta do projeto."
else
    echo "📥 Clonando repositório $REPO_URL..."
    git clone "$REPO_URL" "$TARGET_DIR"
    cd "$TARGET_DIR"
fi

# 3. Cria diretórios persistidos
mkdir -p data downloads wpp_session
chmod -R 777 data downloads wpp_session 2>/dev/null || true

# 4. Sobe aplicação
echo "🐳 Montando e iniciando container..."
if command -v docker-compose &> /dev/null; then
    docker-compose up -d --build
else
    docker compose up -d --build
fi

# 5. Obtém IP local/público da máquina
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo ""
echo "========================================================"
echo "🎉 INSTALAÇÃO E SUBIDA CONCLUÍDAS COM SUCESSO!"
echo "👉 Painel Web: http://${SERVER_IP}:8080 (ou http://localhost:8080)"
echo "📱 Acesse a aba 'Conexão WhatsApp' para conectar seu robô."
echo "========================================================"
