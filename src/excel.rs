use crate::models::{Cliente, FluxoDeAutomacao};
use std::collections::HashMap;

/// Gerador dinâmico do modelo de planilha CSV/Excel baseado nos parâmetros do Fluxo
pub fn gerar_modelo_csv(fluxo: &FluxoDeAutomacao) -> String {
    let mut cabecalhos = vec!["nome_cliente".to_string(), "telefone_receptor".to_string()];

    // Identificar parâmetros dinâmicos exigidos nas interações do fluxo
    for interacao in &fluxo.interacoes {
        if let crate::models::AcaoCliente::EnviarParametro(param_nome) = &interacao.acao_cliente {
            if !cabecalhos.contains(param_nome) {
                cabecalhos.push(param_nome.clone());
            }
        }
    }

    let mut csv_output = cabecalhos.join(",") + "\n";
    // Linha de exemplo
    let mut linha_exemplo = vec!["Empresa Exemplo LTDA", "5511999999999"];
    for _ in 2..cabecalhos.len() {
        linha_exemplo.push("VALOR_EXEMPLO");
    }
    csv_output.push_str(&linha_exemplo.join(","));
    csv_output.push('\n');

    csv_output
}

/// Helper para extrair parâmetros de clientes a partir de um conteúdo CSV
pub fn parse_csv_clientes(conteudo_csv: &str, fluxo_id: &str) -> Result<Vec<Cliente>, String> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(conteudo_csv.as_bytes());

    let headers = rdr
        .headers()
        .map_err(|e| format!("Erro ao ler cabeçalho do CSV: {}", e))?
        .clone();

    let mut clientes = Vec::new();

    for (idx, result) in rdr.records().enumerate() {
        let record = result.map_err(|e| format!("Erro na linha {}: {}", idx + 1, e))?;

        let mut nome = format!("Cliente {}", idx + 1);
        let mut telefone_receptor = "".to_string();
        let mut parametros = HashMap::new();

        for (i, val) in record.iter().enumerate() {
            if let Some(header_name) = headers.get(i) {
                match header_name.trim() {
                    "nome_cliente" => nome = val.to_string(),
                    "telefone_receptor" => telefone_receptor = val.to_string(),
                    outro_param => {
                        parametros.insert(outro_param.to_string(), val.to_string());
                    }
                }
            }
        }

        clientes.push(Cliente {
            id: format!("{}_{}", fluxo_id, idx + 1),
            nome,
            telefone_cliente: "".to_string(),
            telefone_receptor,
            parametros,
        });
    }

    Ok(clientes)
}
