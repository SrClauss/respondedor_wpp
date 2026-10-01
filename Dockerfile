# Multi-stage Dockerfile para Container Único 100% Local

# Stage 1: Build do Frontend React
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Build do Backend Rust
FROM rust:1.75-slim AS backend-builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

# Stage Final: Container Único de Execução Local
FROM ubuntu:22.04

# Instalar Node.js, Chromium e dependências de sistema para o wpp_server
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    chromium-browser \
    ca-certificates \
    supervisor \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt-get/lists/*

WORKDIR /app

# Copiar os arquivos estáticos do React compilados
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Copiar o binário Rust compilado
COPY --from=backend-builder /app/target/release/respondedor_wpp ./respondedor_wpp

# Criar pasta para downloads de boletos/relatórios
RUN mkdir -p /app/downloads

# Configurar variáveis de ambiente do Chromium para o wpp_server
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

EXPOSE 8080

CMD ["./respondedor_wpp"]
