# Plano de Implementação: Orquestrador/Extrator Automático via WhatsApp (`wpp_server`)

## Objetivo
Inicializar a estrutura do projeto contendo o **Backend em Rust** (servidor API + motor de tarefas + servidor de arquivos estáticos), o **Frontend em React** (dashboard de gestão de fluxos e execuções) e a configuração de **empacotamento em Container Docker Único** para execução 100% local.

---

## Checklist de Subproblemas

- [x] **Subproblema 1: Estrutura Base do Backend Rust**
  - Inicializar o projeto Cargo (`Cargo.toml`).
  - Configurar dependências essenciais (`axum`, `tokio`, `serde`, `serde_json`, `tower-http`, `tracing`).
  - Criar o servidor HTTP base escutando na porta configurada.

- [x] **Subproblema 2: Estrutura Base do Frontend React**
  - Criar a aplicação React com Vite em JavaScript/TypeScript no diretório `frontend/`.
  - Configurar build estático para geração da pasta `dist`.

- [x] **Subproblema 3: Integração do Frontend no Backend Rust**
  - Configurar o `tower-http` no Axum para servir os arquivos compilados da pasta `frontend/dist`.
  - Garantir rota de fallback para SPA (Single Page Application).

- [x] **Subproblema 4: Modelagem de Dados, Importador/Gerador Excel e Máquina de Estados (Rust)**
  - Definir as estruturas de dados Rust (`Structs`/`Enums`) para `Cliente`, `Receptor`, `Interacao` (condição de espera: contagem ou texto/regex; resposta ou finalizador) e `FluxoDeAutomacao`.
  - Implementar parser de planilhas Excel (`calamine` / `csv`) para carga em lote de parâmetros de clientes.
  - Implementar gerador dinâmico de modelo de planilha em Excel/CSV baseado nos parâmetros do Fluxo configurado.
  - Criar persistência básica (SQLite / Sled / JSON local).

- [x] **Subproblema 5: Motor de Automação (Task Runner) & Webhook `wpp_server`**
  - Criar endpoint no Axum para receber webhooks de mensagens do `wpp_server`.
  - Implementar o avaliador da máquina de estados: contar mensagens, validar expressões/textos fixos e disparar a resposta correspondente.
  - Implementar pós-processamento de finalização de fluxo (download de mídias/PDFs e gravação local).

- [x] **Subproblema 6: Interface React do Dashboard**
  - Criar telas de Cadastro de Clientes, Exibição de Formato de Colunas e Upload/Download de Modelo Excel (.xlsx/.csv).
  - Criar construtor/editor de Fluxos de Automação Lineares.
  - Criar painel de monitoramento de execuções em tempo real e visualização de logs.

- [x] **Subproblema 7: Container Único (Dockerfile Multi-stage)**
  - Criar `Dockerfile` multi-stage:
    - Stage 1: Build do React (`npm run build`).
    - Stage 2: Build do Rust (`cargo build --release`).
    - Stage Final: Imagem Linux contendo Node.js + Chromium + `wpp_server` + Binário Rust + Script de entrada/supervisor.
  - Testar build e execução local do container Docker.

---

## Indicação do Ponto de Partida
Conforme o protocolo de implementação, iniciaremos pelo **Subproblema 1: Estrutura Base do Backend Rust**, criando o projeto Cargo e estabelecendo a infraestrutura HTTP básica.
