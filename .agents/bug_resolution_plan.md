# Plano de Resolução de Bug (Bug: Não mandou as mensagens)

## 1. Compreensão do Bug
**O que foi reportado:** O lote rodou e o frontend indicou sucesso, e nos bastidores os logs do sistema chegaram a imprimir "SUCESSO: Enviando mensagem". No entanto, as mensagens de fato nunca chegaram ao celular de destino (Receptor Fixo).

## 2. Hipóteses Diagnósticas
- **Hipótese 1:** O valor lido da coluna `mensagem_inicial` na planilha está chegando como vazio (`""`) ou `null` no backend. O WhatsApp processa a requisição vazia sem erro formal (ou o wpp_server ignora o erro), gerando falso positivo.
- **Hipótese 2:** Como o fluxo inicia o contato pela primeira vez, se a coluna `mensagem_inicial` da planilha não tiver dados, o `fallback` do backend (que antes pegava um texto digitado pelo usuário) puxou vazio, também disparando uma mensagem fantasma.
- **Hipótese 3:** O número "Receptor Fixo" pode estar mal formatado e sendo transformado pela heurística interna do `wpp_server` em um ID inválido que não acusa erro de envio mas falha na entrega real.

## 3. Plano de Diagnóstico Passo a Passo
Nenhum código será alterado nesta fase. Farei apenas a leitura/visualização.
- [ ] 1. Verificarei no arquivo `main.rs` (Backend) a exata linha de `executar_fluxo` onde ele lê os parâmetros e resolve a string final, para certificar que nada está bloqueando o texto.
- [ ] 2. Analisarei o `App.jsx` (Frontend) na rotina de varredura do lote (`iniciarExecucaoFluxoCSV`) para garantir que os cabeçalhos (`mensagem_inicial`, etc) gerados casam cirurgicamente com as colunas lidas pelo PapaParse na subida da planilha.
- [ ] 3. Em seguida solicitarei sua confirmação sobre a estrutura da planilha que foi subida no seu teste (se os campos estavam efetivamente preenchidos abaixo do cabeçalho).
