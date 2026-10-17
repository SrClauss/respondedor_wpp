#!/bin/bash
set -e

echo "========================================================"
echo "🚀 INSTALADOR AUTOMÁTICO - ORQUESTRADOR WPP"
echo "========================================================"

# 1. Função auxiliar para instalar pacotes com root ou sudo, em apt ou apk
install_pkg() {
    local pkg=$1
    if command -v apk &> /dev/null; then
        echo "📦 Instalando $pkg via apk..."
        apk add --no-cache "$pkg" || apk add "$pkg" || true
    elif command -v apt-get &> /dev/null; then
        echo "📦 Instalando $pkg via apt..."
        if [ "$(id -u)" -eq 0 ]; then
            apt-get update && apt-get install -y "$pkg" || true
        elif command -v sudo &> /dev/null; then
            sudo apt-get update && sudo apt-get install -y "$pkg" || true
        fi
    fi
}

if ! command -v git &> /dev/null; then
    install_pkg "git"
fi

if ! command -v docker &> /dev/null; then
    echo "📦 Docker não encontrado. Tentando instalar..."
    if command -v apk &> /dev/null; then
        apk add --no-cache docker docker-cli-compose || true
        # Inicia dockerd se não estiver rodando
        if ! pgrep -x "dockerd" > /dev/null; then
            dockerd > /dev/null 2>&1 &
            sleep 3
        fi
    else
        install_pkg "docker.io"
        install_pkg "docker-compose-v2"
    fi
fi

if ! command -v docker &> /dev/null; then
    echo "❌ Docker não pôde ser instalado automaticamente. Por favor, instale o Docker para continuar."
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
