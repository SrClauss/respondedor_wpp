# Regras de Modificação de Código e Diagnóstico de Erros

- **Diagnóstico Prévio**: Nunca modifique o código-fonte sem antes realizar um diagnóstico detalhado do erro.
- **Plano de Implementação**: Sempre crie um plano de implementação detalhado explicando a causa do erro e a solução proposta. Use o modo de planejamento (Planning Mode).
- **Aprovação**: Sempre aguarde a aprovação explícita do usuário no plano de implementação antes de realizar qualquer alteração no código.
# Regras do Projeto 

## 0. Sistema Estrito de Tags
O modo de trabalho da IA é estritamente controlado por **Tags** e só mudará quando uma nova tag for informada. **Se o usuário enviar uma nova solicitação sem nenhuma tag, a IA DEVE considerar automaticamente essa solicitação sob o contexto da última tag utilizada.**

## 1. Protocolo de Resolução de Bugs (Análise & Planejamento):
Sempre que o usuário enviar uma mensagem contendo a tag **`#bug`**, siga estritamente o seguinte fluxo antes de alterar qualquer código:

1. **Proibição de Código Imediato**: NUNCA escreva, edite ou altere código-fonte antes de concluir a análise e registrar o plano no arquivo de documentação. É estritamente PROIBIDO alterar arquivos de código no mesmo turno/resposta em que o plano `.agents/bug_resolution_plan.md` for criado.
2. **Exigência de Dados Reais**: Se a mensagem inicial não contiver logs de erro, tracebacks ou payloads reais (JSON), a IA DEVE pausar e solicitar essas evidências antes de continuar. Nenhuma suposição deve ser feita.
3. **Análise de Causa Raiz e Histórico**: Investigue exaustivamente todas as possíveis causas do erro, baseando-se estritamente nas evidências reais fornecidas. **A IA DEVE obrigatoriamente analisar o arquivo `.agents/bug_resolution_plan.md` pré-existente ou o histórico da conversa para verificar se é um bug reincidente. É estritamente PROIBIDO tentar soluções que já foram testadas anteriormente e falharam.**
4. **Criação Obrigatória do Plano ANTES de Alterar Código (`.agents/bug_resolution_plan.md`)**:
   - **ORDEM DE CRONOGRAMA ESTRITA**: A IA DEVE criar ou sobrescrever o arquivo `.agents/bug_resolution_plan.md` **ANTES e em um turno separado** de aplicar qualquer modificação de código no projeto.
   - O arquivo DEVE conter:
     - **Descrição do Bug**: Sintomas e comportamento esperado vs atual.
     - **Causa Raiz Identificada**: Diagnóstico técnico detalhado.
     - **Abordagens Tentadas/Consideradas**: Lista de hipóteses testadas, descartadas ou já tentadas no passado.
     - **Plano de Ação Passo a Passo**: Instruções diretas, claras e estruturadas para execução da correção.
5. **Pausa Obrigatória para Apresentação do Plano**: Após criar/sobrescrever o `.agents/bug_resolution_plan.md`, a IA DEVE encerrar a resposta apresentando o diagnóstico e o plano ao usuário, sem realizar nenhuma edição de código nesse mesmo turno.
6. **Execução e Validação**: Somente em um turno posterior à criação do `.agents/bug_resolution_plan.md`, a IA poderá editar o código e realizar os testes de validação.


## 2. Protocolo de Implementação de Funcionalidades (Planejamento & Execução):
Sempre que o usuário enviar uma mensagem contendo a tag **`#implementação`**, o processo de "Dividir e Conquistar" DEVE ser seguido rigorosamente.

1. **Proibição Absoluta de Código Imediato**: NUNCA inicie a codificação diretamente. A tag `#implementação` **anula e sobrepõe qualquer heurística interna da IA sobre "tarefas triviais" (trivially simple tasks)**. Não importa se a alteração for de apenas uma linha ou um ajuste de UI simples; se a tag foi usada, o planejamento e a quebra de tarefas devem ser criados e aprovados primeiro. Para pular o plano, o usuário deverá usar a tag `#rapido`.
2. **Criação do Plano (`.agents/implementacao.md`)**:
   - Crie ou sobrescreva exclusivamente o arquivo chamado `.agents/implementacao.md` (sem acentos nem cedilha).
   - Este arquivo servirá como o documento central do projeto para a funcionalidade atual.
3. **Estrutura do `.agents/implementacao.md`**:
   - **Objetivo**: O que a funcionalidade deve fazer.
   - **Checklist de Subproblemas**: Quebre o problema principal em tarefas menores, independentes e testáveis. Formate como uma checklist (`- [ ] Tarefa 1`, `- [ ] Tarefa 2`).
4. **Indicação do Ponto de Partida**: Após apresentar o plano, indique claramente qual é o **melhor subproblema para começar a atacar** primeiro (ex: "Sugiro começarmos pelo subproblema X porque ele estabelece a base para o resto").
5. **Execução Iterativa Estrita**: Após a aprovação do plano, o código será desenvolvido atacando **UM ÚNICO subproblema por turno**. É ESTRITAMENTE PROIBIDO agrupar a execução de múltiplos subproblemas na mesma resposta. A IA deve executar um subproblema, atualizar a checklist no `.agents/implementacao.md` e, se necessário, iterar de forma contínua, mas NUNCA executar o plano inteiro de uma só vez.
6. **Autonomia e Iteração Contínua em Testes**: Em implementação de testes, a IA NUNCA deve finalizar sua resposta/turno deixando testes falhando ou pendentes. A IA deve capturar o erro, analisar a causa raiz, corrigir o código e rodar os testes novamente. Esse ciclo de auto-correção e sub-iterações deve ser executado de forma contínua e autônoma, até que todos os testes passem com 100% de sucesso.

## 4. Protocolo para discussão de Regras de Negócio
Sempre que o usuário enviar uma mensagem contendo a tag **`#regras`**, o modo de discussão teórica será ativado. Siga estritamente este comportamento:

1. **PROIBIÇÃO DE CÓDIGO**: Durante uma discussão iniciada por esta tag, a IA está terminantemente proibida de escrever, analisar ou alterar qualquer código fonte.
2. **Foco em Processos e Fluxos**: O objetivo desta fase é realizar um "brainstorming" para discutir fluxos de usuário, arquitetura de sistemas e tomada de decisões técnicas (ex: "Vale a pena usar banco relacional aqui?", "Como deveria ser o fluxo de devolução do produto?").
3. **Mapeamento de Cenários**: A IA deve ajudar a mapear as regras, fazendo perguntas provocativas, avaliando prós e contras e pensando em casos extremos.
4. **Registro das Decisões (`.agents/regras.md`)**: As regras de negócio e fluxos combinados devem ser documentados exclusivamente no arquivo `.agents/regras.md` (sem caracteres especiais/acentos) antes de qualquer passo de `#implementação` ser acionado.

## 5. Dúvidas pontuais de sintaxe e funcionamento
Sempre que o usuário enviar uma mensagem contendo a tag **`#sintaxe`**, a IA deve atuar exclusivamente como um dicionário/documentação técnica interativa:

1. **Respostas Diretas**: Responda apenas à dúvida de sintaxe ou explique o que determinada função/trecho de código faz.
2. **Sem Refatoração**: Não proponha refatorações, não analise o resto do projeto e não tente resolver problemas arquiteturais.
3. **Exemplos Curtos**: Caso seja necessário demonstrar o uso, forneça um exemplo de código isolado, pequeno e direto ao ponto.

## 6. Controle de Versão e Funcionalidades (Git / GitHub CLI)
- **Repositório Remoto Privado**: Antes de iniciar o fluxo de novas funcionalidades, a IA deve verificar se o repositório possui um remoto configurado no GitHub. Caso não possua, deve criar um repositório privado no GitHub utilizando o GitHub CLI (`gh repo create`) e realizar o push inicial.
- **Criação Obrigatória de Branch ANTES do Plano**: Ao receber a solicitação sob a tag `#implementação`, **a PRIMEIRA ação da IA (antes de criar o arquivo `.agents/implementacao.md` ou escrever qualquer código) DEVE SER criar e alternar para uma nova branch git** dedicada à tarefa (`git checkout -b feature/<nome-da-feature>`).
- **Conclusão (Merge)**: Assim que a funcionalidade for concluída, testada e validada, a IA deve automaticamente realizar o commit e o merge dessa branch de volta para a branch principal (`main`).

## 7. Tratamento de Erros da Própria IA
Se a IA identificar que cometeu um erro em qualquer etapa (ex: plano incorreto, código com bug), ela deve imediatamente:
1. Admitir o erro de forma explícita.
2. Explicar o que estava errado.
3. Atualizar a documentação relevante (`.agents/bug_resolution_plan.md` ou `.agents/implementacao.md`).
4. Propor a correção.

## 8. Modificação do Próprio Agente (#metaprompt)
Sempre que o usuário enviar uma mensagem contendo a tag **`#metaprompt`**, a IA deve focar exclusivamente em adicionar, editar ou refinar as regras presentes no arquivo `AGENTS.md` (ou outros arquivos de instrução de agentes). 

## 9. Padrão Estrito de Arquivos Markdown na Pasta `.agents/`
Para evitar a poluição e duplicação de arquivos com acentos ou nomes aleatórios, a pasta `.agents/` utilizará EXCLUSIVAMENTE nomes padronizados e sem caracteres especiais/acentos/cedilha:
- `.agents/implementacao.md` (Plano de Funcionalidades)
- `.agents/regras.md` (Discussões Teóricas e Regras de Negócio)
- `.agents/bug_resolution_plan.md` (Planos de Resolução de Bugs)
- `.agents/testes.md` (Resultados de Testes e Checklist de Debugging)
É estritamente proibido criar arquivos `.md` avulsos ou com caracteres como `ç` e `ã` dentro de `.agents/`.

## 10. Protocolo de Suíte de Testes (#teste / #test) e Proibição do Playwright
- **PROIBIÇÃO ESTRITA DO PLAYWRIGHT E SUBAGENTE DE BROWSER**: É **estritamente proibido** utilizar Playwright, subagentes de navegação/browser ou executar testes E2E via browser que utilizem Playwright, pois causam travamentos na aplicação/Antigravity.
- Sempre que o usuário enviar uma mensagem contendo a tag **`#teste`** (ou **`#test`**), a IA deve:
  1. Executar a suíte de testes relevante (ex: Cargo tests, unitários/integrados backend), **sem utilizar Playwright**.
  2. Salvar/atualizar o resultado dos testes em `.agents/testes.md` estruturado como uma **Checklist de Debugging** (itens passados `- [x]` e itens falhando `- [ ]`).
  3. Iterar continuamente analisando os tracebacks e logs dos itens com falha no `.agents/testes.md`, aplicando as correções necessárias e re-executando os testes até que 100% dos itens estejam marcados como concluídos (`- [x]`).

## 11. Protocolo de Alteração Rápida (#rapido)
Sempre que o usuário enviar uma mensagem contendo a tag **`#rapido`** (ou **`#quick`**), a IA deve ignorar etapas longas de planejamento e criação de arquivos `.md`. Ela deve aplicar diretamente as alterações de código solicitadas de forma ágil, direta e precisa, realizando apenas as validações mínimas necessárias.

## 12. Proibição Estrita de Compilação Remota (Builds 100% Locais)
- **PROIBIÇÃO ABSOLUTA DO GCLOUD BUILDS SUBMIT / COMPILAÇÃO REMOTA**: É **estritamente proibido** utilizar `gcloud builds submit` ou qualquer serviço de build/compilação remota em nuvem para gerar imagens Docker do projeto.
- **OBRIGATORIEDADE DE BUILD LOCAL**: Todos os containers e binários de aplicação DEVEM ser compiliados **estritamente de forma local** na máquina do usuário (`docker build -t ... .`).
- **PUBLICAÇÃO**: Após o build local concluído com sucesso, a imagem compilada localmente deve ser enviada via `docker push`.


