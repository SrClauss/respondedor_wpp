use serde::{Deserialize, Serialize};

/// Payload recebido do webhook do wpp_server
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WppWebhookPayload {
    pub event: String,
    pub from: String,
    pub to: String,
    pub body: Option<String>,
    pub media_url: Option<String>,
}

/// Avaliador e executor das regras da máquina de estados do Fluxo de Automação
pub mod engine {
    use super::*;
    use crate::models::{AcaoCliente, CondicaoEspera, FluxoDeAutomacao, Interacao, StatusExecucao};

    pub fn avaliar_proxima_acao(
        fluxo: &FluxoDeAutomacao,
        status_atual: &StatusExecucao,
        payload: &WppWebhookPayload,
    ) -> Option<(AcaoCliente, StatusExecucao)> {
        let (interacao_idx, msgs_acumuladas) = match status_atual {
            StatusExecucao::Pendente => (0, 1),
            StatusExecucao::EmAndamento { interacao_atual, mensagens_acumuladas } => {
                (*interacao_atual, mensagens_acumuladas + 1)
            }
            _ => return None,
        };

        let interacao = fluxo.interacoes.get(interacao_idx)?;

        let satisfeita = match &interacao.condicao_espera {
            CondicaoEspera::QuantidadeMensagens(n) => msgs_acumuladas >= *n,
            CondicaoEspera::TextoFixo(texto) => {
                payload.body.as_ref().map_or(false, |b| b.contains(texto))
            }
            CondicaoEspera::Regex(padrao) => {
                payload.body.as_ref().map_or(false, |b| b.contains(padrao))
            }
            CondicaoEspera::ReceberArquivo => payload.media_url.is_some(),
        };

        if satisfeita {
            let proximo_status = if interacao_idx + 1 >= fluxo.interacoes.len() {
                StatusExecucao::Concluido
            } else {
                StatusExecucao::EmAndamento {
                    interacao_atual: interacao_idx + 1,
                    mensagens_acumuladas: 0,
                }
            };
            Some((interacao.acao_cliente.clone(), proximo_status))
        } else {
            Some((
                AcaoCliente::EnviarTexto("".to_string()),
                StatusExecucao::EmAndamento {
                    interacao_atual: interacao_idx,
                    mensagens_acumuladas: msgs_acumuladas,
                },
            ))
        }
    }
}
