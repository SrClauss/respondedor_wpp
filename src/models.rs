use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Condição de Espera do Receptor em uma Interação
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "tipo", content = "valor")]
pub enum CondicaoEspera {
    /// Aguarda uma quantidade N fixa de mensagens enviadas pelo Receptor
    QuantidadeMensagens(usize),
    /// Aguarda uma mensagem contendo um texto/frase exata do Receptor
    TextoFixo(String),
    /// Aguarda um padrão via Expressão Regular (Regex) no texto do Receptor
    Regex(String),
    /// Aguarda o envio de uma mídia/documento pelo Receptor
    ReceberArquivo,
}

/// Ação que o Cliente realiza ao satisfazer a condição de espera
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "tipo", content = "valor")]
pub enum AcaoCliente {
    /// Envia uma mensagem estática ao Receptor
    EnviarTexto(String),
    /// Envia um valor dinâmico baseado no parâmetro do Cliente (ex: {{cliente.cpf}})
    EnviarParametro(String),
    /// Conclui o fluxo atual e dispara as ações de pós-processamento
    FinalizarFluxo,
}

/// Ação executada após o encerramento com sucesso do fluxo
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AcaoConclusao {
    /// Faz download automático do boleto/arquivo para uma pasta local
    DownloadArquivo { pasta_destino: String },
    /// Grava uma informação extraída no registro de histórico da tarefa
    GravarInformacao { chave: String, padrao_regex: String },
    /// Marca o fluxo como concluído e avança para a próxima tarefa da fila
    ProximoFluxoDaFila,
}

/// Ação final ao concluir um Fluxo Lateral
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AcaoConclusaoFluxoLateral {
    /// Reinicia o fluxo principal a partir do passo 0 para o mesmo cliente
    ReiniciarFluxoPrincipal,
    /// Repete a tentativa no mesmo passo do fluxo principal
    RepetirPassoAtual,
    /// Encerra a sessão atual da linha e avança para a próxima linha da fila em lote
    AvancarParaProximaLinha,
}

/// Fluxo Lateral (subfluxo de desvio completo com N interações)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FluxoLateral {
    pub ativo: bool,
    pub nome: Option<String>,
    pub interacoes: Vec<Interacao>,
    pub acao_conclusao: Option<AcaoConclusaoFluxoLateral>,
}

/// Representa uma Interação individual no fluxo de diálogo
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Interacao {
    pub ordem: usize,
    pub condicao_espera: CondicaoEspera,
    pub acao_cliente: AcaoCliente,
    pub fluxo_lateral: Option<FluxoLateral>,
}

/// Modelo de Fluxo de Automação (conjunto ordenado de Interações)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FluxoDeAutomacao {
    pub id: String,
    pub nome: String,
    pub telefone_receptor_padrao: Option<String>,
    pub interacoes: Vec<Interacao>,
    pub acoes_conclusao: Vec<AcaoConclusao>,
}

/// Cadastro de Cliente solicitante e seus parâmetros para execução do Fluxo
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cliente {
    pub id: String,
    pub nome: String,
    pub telefone_cliente: String,
    pub telefone_receptor: String,
    pub parametros: HashMap<String, String>,
}

/// Status de execução de um Fluxo de Automação para um Cliente
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum StatusExecucao {
    Pendente,
    EmAndamento { interacao_atual: usize, mensagens_acumuladas: usize },
    Concluido,
    Falhou { erro: String },
}

/// Registro de Tarefa na Fila de Execuções
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TarefaExecucao {
    pub id: String,
    pub fluxo_id: String,
    pub cliente_id: String,
    pub status: StatusExecucao,
    pub data_criacao: String,
}
