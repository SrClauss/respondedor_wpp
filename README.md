# 🤖 Orquestrador WPP

Sistema completo de orquestração e automação de atendimento via WhatsApp, com interface visual para modelagem de fluxos, disparo em lote via planilhas (Excel / CSV), download automático de documentos/boletos e servidor WhatsApp integrado.

---

## 🚀 Instalação Rápida em Servidor / VPS (1 Comando)

Se estiver em um servidor Linux (Ubuntu/Debian) com Docker instalado, basta executar:

```bash
curl -sSL https://raw.githubusercontent.com/SrClauss/respondedor_wpp/main/instalar.sh | bash
```

Este comando clona o repositório, monta o container com o Google Chrome estável, o motor de automação em Rust e o painel React, subindo tudo automaticamente em segundo plano.

---

## 🛠️ Instalação Manual

### 1. Clonar o repositório:
```bash
git clone https://github.com/SrClauss/respondedor_wpp.git
cd respondedor_wpp
```

### 2. Iniciar a aplicação:
```bash
./subir.sh
```
*(ou `docker compose up -d --build`)*

### 3. Parar a aplicação:
```bash
./parar.sh
```
*(ou `docker compose down`)*

---

## 🌐 Acesso ao Painel

Após subir, acesse pelo navegador:
👉 **http://localhost:8080** *(ou `http://<IP-DO-SERVIDOR>:8080`)*

---

## 📱 Conexão com o WhatsApp

1. Acesse a aba **📱 Conexão WhatsApp** no menu superior.
2. O sistema abrirá o Chrome interno e gerará o QR Code de autenticação.
3. No WhatsApp do seu celular, vá em **Aparelhos Conectados > Conectar Aparelho** e aponte a câmera para o QR Code da tela.
4. Quando autenticar, o status mudará para **WhatsApp Conectado e Operacional!**.

---

## 📊 Disparo em Lote (Excel / CSV)

1. No card do fluxo na tela inicial, clique no botão **📥 Modelo (.xlsx)** para baixar a planilha formatada com as colunas esperadas para aquele fluxo.
2. Preencha as linhas com os números de telefone e parâmetros necessários (ex: CPF).
3. Faça o upload da planilha e clique em **🚀 Disparar Lote**.
4. Acompanhe a execução em tempo real na aba **⚡ Fila & Logs**.

---

## 📁 Estrutura de Pastas Persistidas

- `./data/automacao.db`: Banco SQLite persistido com todos os fluxos cadastrados e histórico.
- `./downloads/`: Diretório onde o robô salva todos os boletos e arquivos baixados.
- `./wpp_session/`: Sessão do WhatsApp persistida (não é necessário escanear o QR Code a cada reinício).
