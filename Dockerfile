# ==========================================
# Estágio 1: Build do Frontend (React + Vite)
# ==========================================
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ==========================================
# Estágio 2: Build do Backend Rust
# ==========================================
FROM rust:1.82-bookworm AS rust-builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src/ ./src/
RUN cargo build --release

# ==========================================
# Estágio 3: Runtime Final
# ==========================================
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Instalar Node.js 20, Google Chrome e dependências para o wpp_server
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    ca-certificates \
    && curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/chrome.deb \
    && apt-get install -y /tmp/chrome.deb \
    && rm -rf /tmp/chrome.deb \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt-get/lists/*

WORKDIR /app

# Copiar arquivos estáticos gerados no stage frontend-builder
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Copiar binário Rust gerado no stage rust-builder
COPY --from=rust-builder /app/target/release/respondedor_wpp ./respondedor_wpp

# Copiar servidor Node WhatsApp e instalar dependências
COPY wpp_server/package*.json ./wpp_server/
RUN cd /app/wpp_server && npm install --omit=dev
COPY wpp_server/ ./wpp_server/

# Copiar script de inicialização
COPY start.sh ./start.sh
RUN chmod +x ./start.sh

# Criar pastas para persistência de dados, downloads e sessão
RUN mkdir -p /app/data /app/downloads /app/wpp_server/wpp_session

# Configurar variáveis de ambiente do Chrome para o wpp_server
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

EXPOSE 8080 3001

CMD ["./start.sh"]
