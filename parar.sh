#!/bin/bash
echo "🛑 Parando Orquestrador WPP..."
if command -v docker-compose &> /dev/null; then
    docker-compose down
else
    docker compose down
fi
echo "✅ Aplicação parada com sucesso."
