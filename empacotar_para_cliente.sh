#!/bin/bash
set -e

DIR_ENTREGA="pacote_cliente"
ARQUIVO_TAR="pacote_cliente.tar.gz"
ARQUIVO_ZIP="pacote_cliente.zip"

echo "========================================================"
echo "📦 INICIANDO EMPACOTAMENTO DO PROJETO PARA O CLIENTE"
echo "========================================================"

# 1. Limpa versões anteriores
rm -rf "$DIR_ENTREGA" "$ARQUIVO_TAR" "$ARQUIVO_ZIP"
mkdir -p "$DIR_ENTREGA"

# 2. Garante imagem Docker respondedor_wpp:latest
if docker image inspect respondedor_wpp:latest >/dev/null 2>&1; then
    echo "✅ Imagem respondedor_wpp:latest encontrada."
else
    echo "🔨 Imagem não encontrada. Compilando respondedor_wpp:latest..."
    docker build -t respondedor_wpp:latest .
fi

# 3. Exporta imagem Docker
echo "💾 Exportando imagem Docker para respondedor_wpp_imagem.tar.gz (aguarde alguns instantes)..."
docker save respondedor_wpp:latest | gzip > "$DIR_ENTREGA/respondedor_wpp_imagem.tar.gz"

# 4. Copia e ajusta docker-compose.yml (removendo build: . para execução limpa no cliente)
echo "📂 Copiando configurações e arquivos essenciais..."
grep -v "build: \." docker-compose.yml > "$DIR_ENTREGA/docker-compose.yml"
cp fluxo_unimed_bh_2via_boleto.json "$DIR_ENTREGA/"

# 5. Banco de dados inicial
mkdir -p "$DIR_ENTREGA/data"
cp -r data/automacao.db "$DIR_ENTREGA/data/"

# 6. Pastas de downloads e sessão do WhatsApp
mkdir -p "$DIR_ENTREGA/downloads"
touch "$DIR_ENTREGA/downloads/.gitkeep"

mkdir -p "$DIR_ENTREGA/wpp_session"
touch "$DIR_ENTREGA/wpp_session/.gitkeep"

# 7. Gera planilhas de exemplo (CSV e XLSX) para o fluxo da Unimed
python3 - << 'PYEOF'
import csv
import openpyxl

headers = [
    "telefone",
    "mensagem_inicial",
    "passo_1_ficar_neste",
    "passo_2_cpf",
    "passo_3_financeiro",
    "passo_4_sobre_financ",
    "passo_5_sobre_faturas",
    "passo_6_em_que_posso",
    "passo_7_voce_tem_1"
]

rows = [
    [
        "5531999998888",
        "ola",
        "Ficar neste canal",
        "123.456.789-00",
        "Financeiro",
        "1",
        "1",
        "1",
        "1"
    ],
    [
        "5531988887777",
        "ola",
        "Ficar neste canal",
        "987.654.321-11",
        "Financeiro",
        "1",
        "1",
        "1",
        "1"
    ]
]

# Gerar CSV
with open("pacote_cliente/modelo_exemplo_unimed_bh.csv", "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow(headers)
    writer.writerows(rows)

# Gerar XLSX
wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Lote Clientes"
ws.append(headers)
for r in rows:
    ws.append(r)
wb.save("pacote_cliente/modelo_exemplo_unimed_bh.xlsx")
print("✅ Planilhas de exemplo (CSV e XLSX) geradas com sucesso.")
PYEOF

# 8. Script de Inicialização Linux / macOS (subir.sh)
cat << 'EOF' > "$DIR_ENTREGA/subir.sh"
#!/bin/bash
set -e

echo "========================================================"
echo "🚀 INICIANDO ORQUESTRADOR WPP"
echo "========================================================"

if ! command -v docker &> /dev/null; then
    echo "❌ Erro: Docker não encontrado. Por favor, instale o Docker para continuar."
    exit 1
fi

if [ -f "respondedor_wpp_imagem.tar.gz" ]; then
    echo "📦 Carregando imagem Docker..."
    docker load < respondedor_wpp_imagem.tar.gz
fi

mkdir -p data downloads wpp_session
chmod -R 777 data downloads wpp_session 2>/dev/null || true

echo "🐳 Subindo container em segundo plano..."
if command -v docker-compose &> /dev/null; then
    docker-compose up -d
else
    docker compose up -d
fi

echo ""
echo "========================================================"
echo "✅ APLICAÇÃO INICIADA COM SUCESSO!"
echo "👉 Acesse no navegador: http://localhost:8080"
echo "📱 Na aba 'Conexão WhatsApp', escaneie o QR Code."
echo "📄 Arquivos e boletos baixados ficarão em: ./downloads"
echo "========================================================"
EOF
chmod +x "$DIR_ENTREGA/subir.sh"

# 9. Script de Parada Linux / macOS (parar.sh)
cat << 'EOF' > "$DIR_ENTREGA/parar.sh"
#!/bin/bash
echo "🛑 Parando Orquestrador WPP..."
if command -v docker-compose &> /dev/null; then
    docker-compose down
else
    docker compose down
fi
echo "✅ Aplicação parada com sucesso."
EOF
chmod +x "$DIR_ENTREGA/parar.sh"

# 10. Script de Inicialização Windows (subir.bat)
cat << 'EOF' > "$DIR_ENTREGA/subir.bat"
@echo off
echo ========================================================
echo INICIANDO ORQUESTRADOR WPP
echo ========================================================

where docker >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERRO] Docker nao encontrado. Por favor, instale o Docker Desktop:
    echo https://www.docker.com/products/docker-desktop/
    pause
    exit /b 1
)

if exist respondedor_wpp_imagem.tar.gz (
    echo Carregando imagem Docker...
    docker load < respondedor_wpp_imagem.tar.gz
)

if not exist data mkdir data
if not exist downloads mkdir downloads
if not exist wpp_session mkdir wpp_session

docker compose up -d

echo.
echo ========================================================
echo APLICACAO INICIADA COM SUCESSO!
echo Acesse no navegador: http://localhost:8080
echo Na aba 'Conexao WhatsApp', escaneie o QR Code.
echo Arquivos baixados ficarao em: .\downloads
echo ========================================================
pause
EOF

# 11. Script de Parada Windows (parar.bat)
cat << 'EOF' > "$DIR_ENTREGA/parar.bat"
@echo off
echo Parando Orquestrador WPP...
docker compose down
echo Aplicacao parada com sucesso.
pause
EOF

# 12. Manual de Instruções (README.md)
cat << 'EOF' > "$DIR_ENTREGA/README.md"
# 🤖 Orquestrador WPP - Guia de Instalação e Uso

Este pacote contém o sistema completo do **Orquestrador WPP**, incluindo a interface gráfica, motor de automação, servidor WhatsApp integrado e o banco de dados pré-configurado com o fluxo da **Unimed-BH (2ª Via de Boleto)**.

---

## 📋 Pré-requisitos
- **Docker** e **Docker Compose** instalados (Linux, Windows com Docker Desktop ou macOS).

---

## 🚀 Como Iniciar

### No Linux ou macOS:
```bash
./subir.sh
```

### No Windows:
Dê um duplo clique no arquivo **`subir.bat`**.

---

## 🌐 Acesso ao Painel
Após subir, abra o navegador e acesse:
👉 **http://localhost:8080**

---

## 📱 Conectar o WhatsApp
1. No painel web ([http://localhost:8080](http://localhost:8080)), clique na aba **📱 Conexão WhatsApp**.
2. Abra o WhatsApp no aparelho que será o robô (menu *Aparelhos Conectados* > *Conectar Aparelho*).
3. Aponte a câmera para o QR Code na tela.
4. Ao conectar, o status mudará para verde (*WhatsApp Conectado e Operacional!*).

---

## 📊 Planilhas de Disparo em Lote
O pacote já inclui dois arquivos de exemplo com a estrutura esperada para o fluxo da Unimed-BH:
- **`modelo_exemplo_unimed_bh.xlsx`** (Excel)
- **`modelo_exemplo_unimed_bh.csv`** (CSV)

Você também pode clicar no botão **📥 Modelo (.xlsx)** diretamente no card do fluxo dentro do painel para gerar a planilha específica de qualquer outro fluxo.

---

## 📥 Onde Ficam os Dados e Arquivos Baixados?
- **Downloads / Boletos**: Todos os PDFs e comprovantes baixados pelo robô ficam na pasta `./downloads`.
- **Banco de Dados**: Fica persistido em `./data/automacao.db`. Seus cadastros e histórico nunca são perdidos.
- **Sessão WhatsApp**: Fica salva em `./wpp_session`. Só precisa escanear uma única vez.

---

## 🛑 Como Parar o Sistema
- **Linux / macOS**: `./parar.sh`
- **Windows**: Duplo clique em `parar.bat`
EOF

# 13. Gera arquivos compactados (.tar.gz e .zip)
echo "📦 Gerando $ARQUIVO_TAR..."
tar -czf "$ARQUIVO_TAR" "$DIR_ENTREGA"

echo "📦 Gerando $ARQUIVO_ZIP..."
zip -r -q "$ARQUIVO_ZIP" "$DIR_ENTREGA"

echo "========================================================"
echo "🎉 EMPACOTAMENTO CONCLUÍDO COM SUCESSO!"
echo "📁 Pasta descompactada: $DIR_ENTREGA/"
echo "🎁 Arquivo Linux/macOS: $ARQUIVO_TAR"
echo "🎁 Arquivo Windows:     $ARQUIVO_ZIP"
echo "========================================================"
