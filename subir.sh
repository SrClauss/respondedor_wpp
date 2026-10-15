#!/bin/bash
set -e

echo "========================================================"
echo "🚀 INICIANDO ORQUESTRADOR WPP"
echo "========================================================"

if ! command -v docker &> /dev/null; then
    echo "❌ Erro: Docker não encontrado. Por favor, instale o Docker para continuar."
    exit 1
fi

mkdir -p data downloads wpp_session
chmod -R 777 data downloads wpp_session 2>/dev/null || true

echo "🐳 Construindo e iniciando container Docker em segundo plano..."
if command -v docker-compose &> /dev/null; then
    docker-compose up -d --build
else
    docker compose up -d --build
fi

echo ""
echo "========================================================"
echo "✅ APLICAÇÃO INICIADA COM SUCESSO!"
echo "👉 Acesse no navegador: http://localhost:8080"
echo "📱 Na aba 'Conexão WhatsApp', escaneie o QR Code."
echo "📄 Arquivos e boletos baixados ficarão em: ./downloads"
echo "========================================================"
