# Container Único de Execução Local do Orquestrador WPP
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Instalar Node.js 20, Chromium e dependências para o wpp_server
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    chromium-browser \
    ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt-get/lists/*

WORKDIR /app

# Copiar os arquivos estáticos do React compilados
COPY frontend/dist ./frontend/dist

# Copiar o binário Rust otimizado compilado
COPY target/release/respondedor_wpp ./respondedor_wpp

# Copiar o servidor WhatsApp Node.js e instalar dependências
COPY wpp_server ./wpp_server
RUN cd /app/wpp_server && npm install --omit=dev

# Copiar script de inicialização
COPY start.sh ./start.sh
RUN chmod +x ./start.sh

# Criar pastas para persistência de dados, downloads e sessão
RUN mkdir -p /app/data /app/downloads /app/wpp_server/wpp_session

# Configurar variáveis de ambiente do Chromium para o wpp_server
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

EXPOSE 8080 3001

CMD ["./start.sh"]
