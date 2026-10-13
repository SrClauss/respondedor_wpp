# Plano de Implementação: Wizard (Modal) para Criação de Interações

## Objetivo
Adicionar um **assistente passo a passo (wizard) em formato de modal** para ajudar na criação das interações de um fluxo, acionado por um **botão adicional** posicionado ao lado do editor de fluxos atual.

**Restrição fundamental (requisito do usuário):** o wizard é **puramente aditivo**. NENHUMA forma atual de configuração deve ser alterada. O editor de fluxos existente permanece 100% intacto e funcional; o wizard é apenas um atalho opcional que, ao ser concluído, **preenche os estados já existentes** do formulário (`novoFluxoNome`, `novoReceptor`, `novaMensagemInicial`, `interacoes`) e delega o salvamento à rotina `criarFluxo` / `POST /api/fluxos` já existente.

- **Escopo:** exclusivamente frontend (`frontend/src/App.jsx` ou novo componente importado por ele).
- **Backend Rust / wpp_server:** NÃO são alterados.
- **Contrato de dados:** o wizard produz exatamente o mesmo formato de objeto de interação já usado (`{ tipo_espera, valor_espera, tipo_resposta, valor_resposta }`).

---

## Checklist de Subproblemas

- [x] **Subproblema 1: Botão "Wizard" + Estrutura do Modal (esqueleto)**
  - Adicionar um botão (ícone/rótulo curto) ao lado do editor de fluxos atual, sem remover nem reposicionar controles existentes.
  - Criar o modal (overlay + container + header + navegação "Voltar/Avançar/Cancelar") controlado por um estado de visibilidade e um índice de passo.
  - Garantir que abrir/fechar o modal NÃO altere nenhum estado do editor atual até o usuário confirmar.

- [x] **Subproblema 2: Passo 1 — Identificação + Mensagem Inicial**
  - Coletar nome do fluxo, receptor fixo e mensagem inicial em um **rascunho isolado** (`wizardDados`).
  - Desvio de design (registrado): em vez de escrever direto nos setters do editor, o wizard mantém rascunho próprio e só aplica ao editor no passo de revisão — preservando a garantia do Subproblema 1 de que abrir/cancelar o modal não altera o editor.

- [x] **Subproblema 3: Passo 2 (repetível) — Construção das Interações**
  - Por interação, guiar: "O que aguardar?" (`tipo_espera` + `valor_espera`) e "O que fazer ao receber?" (`tipo_resposta` + `valor_resposta`).
  - Botões "Adicionar interação" / "Remover" / "Reordenar" (↑/↓), gerando objetos no formato exato usado pelo editor atual.
  - Estado local do wizard espelhando o array `interacoes` (rascunho isolado `wizardDados.interacoes`).

- [x] **Subproblema 4: Passo 3 — Revisão + Aplicação no Editor**
  - Mostrar resumo em linguagem natural (fluxo linear de passos).
  - Ao confirmar: popular `novoFluxoNome`, `novoReceptor`, `novaMensagemInicial` e `interacoes`, fechar o modal e deixar o botão "Salvar" existente (`criarFluxo`) fazer a persistência.
  - Não persistir nada autonomamente (não chamar a API direto), preservando o fluxo atual.

- [x] **Subproblema 5: Validações de UX e Casos Extremos**
  - Bloquear avanço sem dados obrigatórios (nome e mensagem inicial no Passo 1; valor de espera/resposta e regex válida no Passo 2).
  - Tratar: interação "qualquer mensagem" (sem valor), regex inválida, "finalizar" no meio da lista (confirmação), e interação sem nenhuma.
  - Garantir que a saída do wizard gere `parametros_exigidos` consistentes com a rotina `extractParams` já usada pelo editor (o wizard apenas popula `interacoes`; o `criarFluxo` existente deriva os parâmetros).

---

## Ponto de Partida Sugerido
**Sugiro começarmos pelo Subproblema 1.** Ele estabelece a base visual e a estrutura de navegação (botão + modal vazio com os passos), permitindo que todos os demais passos sejam encaixados incrementalmente sem risco de tocar no editor atual.

---

## Controle de Versão (Seção 6 do Agents.md)
- Branch dedicada criada antes do plano: **`feature/wizard-interacoes-modal`**.
- Remoto GitHub: **não existia** — deve ser criado repositório privado via `gh repo create` + push inicial.
- Merge de volta para `main` somente após conclusão, teste e validação.
