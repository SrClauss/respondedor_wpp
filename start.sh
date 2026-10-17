#!/bin/bash
set -e

echo "🚀 Iniciando serviços do Orquestrador WPP..."

# Iniciar o wpp_server (Node.js) em background
echo "📱 Iniciando WPP Server (Node.js) na porta 3001..."
cd /app/wpp_server
node index.js &
WPP_PID=$!

# Aguardar breve inicialização do Node
sleep 2

# Iniciar o backend Rust (porta 8080)
echo "🦀 Iniciando Backend Rust na porta 8080..."
cd /app
./respondedor_wpp &
RUST_PID=$!

# Função para finalização graciosa
trap "echo '🛑 Encerrando serviços...'; kill -TERM $WPP_PID $RUST_PID 2>/dev/null" SIGINT SIGTERM

# Aguardar qualquer um dos processos
wait -n $WPP_PID $RUST_PID
