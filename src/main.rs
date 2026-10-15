mod db;
mod excel;
mod models;
mod runner;

use axum::{
    extract::{Json, Path},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post, delete},
    Router,
};
use std::net::SocketAddr;
use tower_http::services::{ServeDir, ServeFile};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use rusqlite::params;

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Inicializar banco de dados SQLite local
    let conn = db::init_db().expect("Falha ao inicializar o banco de dados SQLite local");
    tracing::info!("Banco de dados SQLite inicializado com sucesso.");

    // Semear fluxo padrão caso a base esteja vazia
    let total_fluxos: i64 = conn.query_row("SELECT count(*) FROM fluxos", [], |r| r.get(0)).unwrap_or(0);
    if total_fluxos == 0 {
        if let Ok(conteudo) = std::fs::read_to_string("fluxo_unimed_bh_2via_boleto.json") {
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&conteudo) {
                let id = json_val.get("id").and_then(|v| v.as_str()).unwrap_or("fluxo_unimed_bh_segunda_via_boleto");
                let nome = json_val.get("nome").and_then(|v| v.as_str()).unwrap_or("Unimed-BH - 2ª Via de Boleto");
                let _ = conn.execute(
                    "INSERT INTO fluxos (id, nome, json_conteudo) VALUES (?1, ?2, ?3)",
                    params![id, nome, conteudo],
                );
                tracing::info!("Fluxo inicial semeado com sucesso: {}", nome);
            }
        }
    }

    // Serviço para entregar os arquivos estáticos compilados do React (SPA Fallback)
    let serve_dir = ServeDir::new("frontend/dist")
        .not_found_service(ServeFile::new("frontend/dist/index.html"));

    std::fs::create_dir_all("downloads").unwrap_or_default();

    let app = Router::new()
        .route("/api/health", get(health_check))
        .route("/webhook/wpp", post(receber_webhook_wpp))
        .route("/api/fluxos", get(listar_fluxos).post(criar_fluxo))
        .route("/api/fluxos/:id", delete(deletar_fluxo))
        .route("/api/executar", post(executar_fluxo))
        .route("/api/executar_lote", post(executar_lote))
        .route("/api/fila/cancelar", post(cancelar_fila_lote))
        .route("/api/fila/exportar_resumo", get(exportar_resumo_lote))
        .route("/api/logs", get(obter_logs))
        .route("/api/logs/limpar", post(limpar_logs))
        .route("/api/wpp/status", get(proxy_wpp_status))
        .route("/api/wpp/connect", post(proxy_wpp_connect))
        .route("/api/wpp/disconnect", post(proxy_wpp_disconnect))
        .nest_service("/downloads", ServeDir::new("downloads"))
        .fallback_service(serve_dir);

    let addr = SocketAddr::from(([0, 0, 0, 0], 8080));
    tracing::info!("Servidor rodando em http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn health_check() -> &'static str {
    "OK"
}

async fn proxy_wpp_status() -> Result<impl IntoResponse, (StatusCode, String)> {
    let client = reqwest::Client::new();
    match client.get("http://127.0.0.1:3001/api/wpp/status").send().await {
        Ok(resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::OK);
            let json = resp.text().await.unwrap_or_else(|_| "{}".to_string());
            Ok((status, [(axum::http::header::CONTENT_TYPE, "application/json")], json))
        }
        Err(e) => Err((StatusCode::BAD_GATEWAY, format!("Erro ao contatar wpp_server: {}", e))),
    }
}

async fn proxy_wpp_connect() -> Result<impl IntoResponse, (StatusCode, String)> {
    let client = reqwest::Client::new();
    match client.post("http://127.0.0.1:3001/api/wpp/connect").send().await {
        Ok(resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::OK);
            let json = resp.text().await.unwrap_or_else(|_| "{}".to_string());
            Ok((status, [(axum::http::header::CONTENT_TYPE, "application/json")], json))
        }
        Err(e) => Err((StatusCode::BAD_GATEWAY, format!("Erro ao contatar wpp_server: {}", e))),
    }
}

async fn proxy_wpp_disconnect() -> Result<impl IntoResponse, (StatusCode, String)> {
    let client = reqwest::Client::new();
    match client.post("http://127.0.0.1:3001/api/wpp/disconnect").send().await {
        Ok(resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::OK);
            let json = resp.text().await.unwrap_or_else(|_| "{}".to_string());
            Ok((status, [(axum::http::header::CONTENT_TYPE, "application/json")], json))
        }
        Err(e) => Err((StatusCode::BAD_GATEWAY, format!("Erro ao contatar wpp_server: {}", e))),
    }
}

fn compilar_regex(pattern: &str) -> Result<regex::Regex, regex::Error> {
    let pat = pattern.trim();
    if pat.is_empty() {
        return regex::Regex::new(".*");
    }

    // Suporte a delimitadores JS /padrao/flags (ex: /invalido/i, /^erro$/m)
    if pat.starts_with('/') && pat.rfind('/').map_or(false, |idx| idx > 0) {
        let last_slash = pat.rfind('/').unwrap();
        let inner = &pat[1..last_slash];
        let flags = &pat[last_slash + 1..];
        
        let mut prefix = String::new();
        if flags.contains('i') {
            prefix.push_str("(?i)");
        }
        if flags.contains('m') {
            prefix.push_str("(?m)");
        }
        if flags.contains('s') {
            prefix.push_str("(?s)");
        }
        
        let final_pat = format!("{}{}", prefix, inner);
        regex::Regex::new(&final_pat)
    } else {
        // Tenta compilar o padrão diretamente. Se falhar, tenta versão case-insensitive ou escape simples
        regex::Regex::new(pat)
            .or_else(|_| regex::Regex::new(&format!("(?i){}", pat)))
            .or_else(|_| regex::Regex::new(&regex::escape(pat)))
    }
}

async fn avancar_proxima_linha_fila(tel_atual: &str) {
    tracing::info!("Encerrando sessão para {} e buscando próximo item da fila...", tel_atual);
    let tel_c = tel_atual.to_string();
    let _ = tokio::task::spawn_blocking(move || {
        if let Ok(conn) = db::init_db() {
            let _ = conn.execute("DELETE FROM sessoes_ativas WHERE telefone = ?1", params![tel_c]);
        }
    }).await;

    let proximo_item = tokio::task::spawn_blocking(move || -> Option<(i64, String, String, String)> {
        let conn = db::init_db().ok()?;
        let mut stmt = conn.prepare("SELECT id, telefone, fluxo_id, parametros_json FROM fila_lote WHERE status = 'pendente' ORDER BY id ASC LIMIT 1").ok()?;
        let row = stmt.query_row([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        }).ok()?;
        Some(row)
    }).await.ok().flatten();

    if let Some((row_id, tel_prox, fluxo_id_prox, params_json_prox)) = proximo_item {
        tracing::info!("Iniciando próximo item da fila (ID {}): telefone={}", row_id, tel_prox);
        let tel_c = tel_prox.clone();
        let fluxo_c = fluxo_id_prox.clone();
        let params_c = params_json_prox.clone();

        let _ = tokio::task::spawn_blocking(move || {
            if let Ok(conn) = db::init_db() {
                let _ = conn.execute("UPDATE fila_lote SET status = 'em_andamento' WHERE id = ?1", params![row_id]);
                let _ = conn.execute(
                    "INSERT OR REPLACE INTO sessoes_ativas (telefone, fluxo_id, passo_atual, parametros_json, mensagens_acumuladas) VALUES (?1, ?2, 0, ?3, 0)",
                    params![tel_c, fluxo_c, params_c],
                );
            }
        }).await;

        let params: serde_json::Value = serde_json::from_str(&params_json_prox).unwrap_or_default();
        let msg_inicial_raw = params.get("mensagem_inicial").and_then(|v| v.as_str()).unwrap_or("");
        let msg_inicial = msg_inicial_raw.replace("\\n", "\n");

        if !msg_inicial.trim().is_empty() {
            let client = reqwest::Client::new();
            let body = serde_json::json!({
                "to": tel_prox,
                "message": msg_inicial
            });
            let _ = client.post("http://localhost:3001/api/wpp/send").json(&body).send().await;
        }
    }
}

async fn receber_webhook_wpp(
    Json(payload): Json<runner::WppWebhookPayload>,
) -> Json<serde_json::Value> {
    tracing::info!("Webhook wpp_server recebido: de={}, body={:?}, media={:?}", payload.from, payload.body, payload.media_url);
    
    let payload_val = serde_json::json!({
        "from": payload.from,
        "body": payload.body,
        "media_url": payload.media_url
    });
    db::registrar_log("INFO", "Webhook WhatsApp Recebido", &payload_val);

    // 1. Obter a sessão ativa
    let sessao = tokio::task::spawn_blocking(move || -> Option<(String, String, i32, String, i32)> {
        let conn = db::init_db().ok()?;
        let mut stmt = conn.prepare("SELECT telefone, fluxo_id, passo_atual, parametros_json, mensagens_acumuladas FROM sessoes_ativas LIMIT 1").ok()?;
        let row = stmt.query_row([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i32>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i32>(4)?,
            ))
        }).ok()?;
        Some(row)
    }).await.ok().flatten();

    let (tel_db, fluxo_id, passo_atual, params_json, msgs_acumuladas) = match sessao {
        Some(s) => s,
        None => {
            tracing::info!("Webhook recebido sem nenhuma sessão ativa.");
            return Json(serde_json::json!({ "status": "sem_sessao_ativa" }));
        }
    };

    tracing::info!("Sessão ativa: tel={}, fluxo_id={}, passo_atual={}, msgs_acumuladas={}", tel_db, fluxo_id, passo_atual, msgs_acumuladas);

    // 2. Carregar o fluxo do banco de dados
    let fluxo_id_c = fluxo_id.clone();
    let fluxo_json_str = tokio::task::spawn_blocking(move || -> Option<String> {
        let conn = db::init_db().ok()?;
        let mut stmt = conn.prepare("SELECT json_conteudo FROM fluxos WHERE id = ?1").ok()?;
        let row = stmt.query_row(params![fluxo_id_c], |r| r.get(0)).ok()?;
        Some(row)
    }).await.ok().flatten();

    let fluxo_val: serde_json::Value = match fluxo_json_str {
        Some(s) => serde_json::from_str(&s).unwrap_or_default(),
        None => {
            tracing::error!("Fluxo {} não encontrado no banco de dados!", fluxo_id);
            return Json(serde_json::json!({ "error": "fluxo_nao_encontrado" }));
        }
    };

    let interacoes = fluxo_val.get("interacoes").and_then(|v| v.as_array());
    let idx_interacao = passo_atual as usize; // passo_atual=0 é a 1ª interação após a mensagem_inicial

    let interacao = interacoes.and_then(|arr| arr.get(idx_interacao));

    let mut condicao_atendida = false;
    let novam_acumuladas = msgs_acumuladas + 1;

    if let Some(inter) = interacao {
        let tipo_espera = inter.get("tipo_espera").and_then(|v| v.as_str()).unwrap_or("");
        let valor_espera = inter.get("valor_espera").and_then(|v| v.as_str()).unwrap_or("");

        tracing::info!("Avaliando regra da interação {}: tipo_espera='{}', valor_espera='{}'", idx_interacao + 1, tipo_espera, valor_espera);

        match tipo_espera {
            "multiplas_mensagens" => {
                let qtd_alvo: i32 = valor_espera.parse().unwrap_or(1);
                tracing::info!("Mensagens acumuladas agora: {} de {}", novam_acumuladas, qtd_alvo);
                if novam_acumuladas >= qtd_alvo {
                    condicao_atendida = true;
                }
            }
            "texto_fixo" => {
                let body_lower = payload.body.as_deref().unwrap_or("").to_lowercase();
                let alvo_lower = valor_espera.to_lowercase();
                if body_lower.contains(&alvo_lower) {
                    condicao_atendida = true;
                } else {
                    tracing::info!("Texto fixo não conferiu. Recebido: '{}', Esperado: '{}'", body_lower, alvo_lower);
                }
            }
            "regex" => {
                let body_text = payload.body.as_deref().unwrap_or("");
                if let Ok(re) = compilar_regex(valor_espera) {
                    if re.is_match(body_text) {
                        condicao_atendida = true;
                    } else {
                        tracing::info!("Regex não conferiu. Texto: '{}', Regex: '{}'", body_text, valor_espera);
                    }
                } else {
                    tracing::warn!("Expressão Regex inválida configurada: '{}'", valor_espera);
                }
            }
            "receber_arquivo" => {
                let body_str = payload.body.as_deref().unwrap_or("");
                let contem_link = body_str.contains("http://") || body_str.contains("https://") || body_str.contains("drive.google") || body_str.contains("dropbox");
                if payload.media_url.is_some() || contem_link {
                    condicao_atendida = true;
                    tracing::info!("Regra receber_arquivo/link atendida! (Mídia: {}, Link Detectado: {})", payload.media_url.is_some(), contem_link);
                } else {
                    tracing::info!("Aguardando arquivo/mídia/link, mas a mensagem recebida não possui anexo nem link HTTP.");
                }
            }
            _ => {
                // Se não houver tipo_espera definido ou for desconhecido, aceita por padrão na 1ª mensagem
                condicao_atendida = true;
            }
        }
    } else {
        tracing::warn!("Nenhuma interação encontrada para o passo {}. Finalizando fluxo.", passo_atual);
    }

    // Se a condição de espera NÃO foi atendida: verifica se a interação tem Fluxo Lateral de saída/fallback
    if !condicao_atendida {
        let fluxo_lateral_opt = interacao.and_then(|i| i.get("fluxo_lateral"));
        let tem_fluxo_lateral = fluxo_lateral_opt.map_or(false, |fl| {
            fl.get("ativo").and_then(|v| v.as_bool()).unwrap_or(false)
                || fl.get("mensagem_saida").and_then(|v| v.as_str()).map_or(false, |s| !s.trim().is_empty())
        });

        if tem_fluxo_lateral {
            let acao_conclusao = fluxo_lateral_opt
                .and_then(|fl| fl.get("acao_conclusao"))
                .and_then(|v| v.as_str())
                .unwrap_or("AvancarParaProximaLinha");

            let lat_interacoes = fluxo_lateral_opt.and_then(|fl| fl.get("interacoes")).and_then(|v| v.as_array());
            let msg_saida = fluxo_lateral_opt
                .and_then(|fl| fl.get("mensagem_saida"))
                .and_then(|v| v.as_str())
                .unwrap_or("");

            // Se o subfluxo tem interações laterais especificas (ex: valor a enviar ao receptor ao falhar)
            let mut resposta_enviada = false;
            if let Some(arr) = lat_interacoes {
                for lat_inter in arr {
                    let tipo_esp = lat_inter.get("tipo_espera").and_then(|v| v.as_str()).unwrap_or("texto_exato");
                    let val_esp = lat_inter.get("valor_espera").and_then(|v| v.as_str()).unwrap_or("");
                    let val_resp = lat_inter.get("valor_resposta").and_then(|v| v.as_str()).unwrap_or("");

                    let mut bateu = false;
                    let body_text = payload.body.as_deref().unwrap_or("");
                    if tipo_esp == "qualquer_mensagem" {
                        bateu = true;
                    } else if tipo_esp == "texto_exato" {
                        if val_esp.is_empty() || body_text.to_lowercase().contains(&val_esp.to_lowercase()) {
                            bateu = true;
                        }
                    } else if tipo_esp == "regex" {
                        if let Ok(re) = compilar_regex(val_esp) {
                            if re.is_match(body_text) { bateu = true; }
                        }
                    }

                    if bateu && !val_resp.trim().is_empty() {
                        let params_val: serde_json::Value = serde_json::from_str(&params_json).unwrap_or_default();
                        let clean_val = val_resp.trim().replace('{', "").replace('}', "");
                        let msg_final = params_val.get(&clean_val).and_then(|v| v.as_str()).unwrap_or(val_resp);

                        tracing::info!("Passo Lateral ativado. Enviando texto direto de resposta: '{}'", msg_final);
                        db::registrar_log("INFO", "Resposta do Passo Lateral Enviada", &serde_json::json!({
                            "para": tel_db,
                            "texto": msg_final
                        }));

                        let client = reqwest::Client::new();
                        let msg_final_fmt = msg_final.replace("\\n", "\n");
                        let body = serde_json::json!({ "to": tel_db, "message": msg_final_fmt });
                        let _ = client.post("http://localhost:3001/api/wpp/send").json(&body).send().await;
                        resposta_enviada = true;
                        break;
                    }
                }
            }

            if !resposta_enviada && !msg_saida.trim().is_empty() {
                let client = reqwest::Client::new();
                let msg_saida_fmt = msg_saida.replace("\\n", "\n");
                let body = serde_json::json!({ "to": tel_db, "message": msg_saida_fmt });
                let _ = client.post("http://localhost:3001/api/wpp/send").json(&body).send().await;
            }

            tracing::info!("Fluxo Lateral acionado no passo {}. Ação de conclusão: {}", passo_atual, acao_conclusao);
            db::registrar_log("WARN", "Fluxo Lateral (Fallback) Acionado", &serde_json::json!({
                "telefone": tel_db,
                "passo": passo_atual,
                "acao_conclusao": acao_conclusao
            }));

            if acao_conclusao == "ReiniciarFluxoPrincipal" {
                tracing::info!("Reiniciando Fluxo Principal no Passo 0 para {}", tel_db);
                let tel_c = tel_db.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    if let Ok(conn) = db::init_db() {
                        let _ = conn.execute(
                            "UPDATE sessoes_ativas SET passo_atual = 0, mensagens_acumuladas = 0 WHERE telefone = ?1",
                            params![tel_c],
                        );
                    }
                }).await;

                // Re-envia a mensagem inicial do fluxo
                let params_val: serde_json::Value = serde_json::from_str(&params_json).unwrap_or_default();
                let msg_inicial = params_val.get("mensagem_inicial").and_then(|v| v.as_str()).unwrap_or("");
                if !msg_inicial.trim().is_empty() {
                    let client = reqwest::Client::new();
                    let body = serde_json::json!({ "to": tel_db, "message": msg_inicial });
                    let _ = client.post("http://localhost:3001/api/wpp/send").json(&body).send().await;
                }

                return Json(serde_json::json!({ "status": "fluxo_principal_reiniciado" }));
            } else if acao_conclusao == "RepetirPassoAtual" {
                let tel_c = tel_db.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    if let Ok(conn) = db::init_db() {
                        let _ = conn.execute(
                            "UPDATE sessoes_ativas SET mensagens_acumuladas = 0 WHERE telefone = ?1",
                            params![tel_c],
                        );
                    }
                }).await;
                return Json(serde_json::json!({ "status": "passo_atual_repetido" }));
            } else {
                // AvancarParaProximaLinha
                avancar_proxima_linha_fila(&tel_db).await;
                return Json(serde_json::json!({ "status": "avancado_proxima_linha" }));
            }
        }

        let tel_db_c = tel_db.clone();
        let _ = tokio::task::spawn_blocking(move || {
            if let Ok(conn) = db::init_db() {
                let _ = conn.execute(
                    "UPDATE sessoes_ativas SET mensagens_acumuladas = ?1 WHERE telefone = ?2",
                    params![novam_acumuladas, tel_db_c],
                );
            }
        }).await;
        return Json(serde_json::json!({
            "status": "aguardando_mais_mensagens",
            "mensagens_acumuladas": novam_acumuladas
        }));
    }

    // Condição atendida! Vamos responder ou finalizar de acordo com o tipo_resposta
    let tipo_resposta = interacao
        .and_then(|i| i.get("tipo_resposta"))
        .and_then(|v| v.as_str())
        .unwrap_or("enviar_texto");

    tracing::info!("Condição atendida! Executando ação de tipo_resposta='{}'", tipo_resposta);

    let params_val: serde_json::Value = serde_json::from_str(&params_json).unwrap_or_default();
    let proximo_passo = passo_atual + 1;
    let chave_param = format!("resposta_passo_{}", proximo_passo);

    // Procura o valor no JSON da planilha:
    // 1. Chaves que iniciem com passo_{proximo_passo}_ ou sejam exatamente passo_{proximo_passo}
    // 2. Chave resposta_passo_{proximo_passo}
    // 3. Pelo nome da resposta configurada (ex: cpf, financeiro, sair)
    let mut msg_proxima_opt: Option<&str> = None;

    if let Some(obj) = params_val.as_object() {
        let prefixo_passo = format!("passo_{}", proximo_passo);
        let prefixo_passo_under = format!("passo_{}_", proximo_passo);
        for (k, v) in obj {
            let k_low = k.to_lowercase().trim().to_string();
            if k_low == prefixo_passo || k_low.starts_with(&prefixo_passo_under) || k_low == chave_param {
                if let Some(s) = v.as_str() {
                    if !s.trim().is_empty() {
                        msg_proxima_opt = Some(s);
                        break;
                    }
                }
            }
        }
    }

    if msg_proxima_opt.is_none() {
        if let Some(inter) = interacao {
            if let Some(val_resp) = inter.get("valor_resposta").and_then(|v| v.as_str()) {
                let clean_val = val_resp.trim().replace('{', "").replace('}', "");
                let clean_lower = clean_val.to_lowercase();
                let clean_upper = clean_val.to_uppercase();
                msg_proxima_opt = params_val.get(&clean_val)
                    .or_else(|| params_val.get(&clean_lower))
                    .or_else(|| params_val.get(&clean_upper))
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.trim().is_empty());
            }
        }
    }

    let is_download = tipo_resposta == "finalizar_baixar" || tipo_resposta == "baixar_e_continuar";
    if is_download {
        tracing::info!("Iniciando download em lote de todas as mídias do chat para {}...", tel_db);
        let tel_db_download = tel_db.clone();
        tokio::spawn(async move {
            let client = reqwest::Client::new();
            let body = serde_json::json!({ "to": tel_db_download });
            if let Ok(resp) = client.post("http://localhost:3001/api/wpp/download_chat_media").json(&body).send().await {
                if let Ok(json_res) = resp.json::<serde_json::Value>().await {
                    tracing::info!("Resultado do download em lote de mídias: {:?}", json_res);
                    db::registrar_log("INFO", "Mídias do Chat Baixadas", &json_res);
                }
            }
        });
    }

    // Obtém texto da resposta se houver
    let val_fallback = interacao.and_then(|i| i.get("valor_resposta")).and_then(|v| v.as_str()).unwrap_or("");
    // Se a planilha tem valor para este passo, SEMPRE usa o valor da planilha!
    let msg_candidata = msg_proxima_opt.unwrap_or(val_fallback);
    let msg_final = msg_candidata.replace("\\n", "\n");

    // Verifica se existem mais interações após esta
    let tem_mais_passos = interacoes
        .map(|arr| (proximo_passo as usize) < arr.len())
        .unwrap_or(false);

    // Envia mensagem se for enviar_texto, enviar_texto_fixo, enviar_coluna, baixar_e_continuar, OU se tiver mensagem explícita configurada (ex: SAIR)
    let pode_enviar_msg = tipo_resposta == "enviar_texto"
        || tipo_resposta == "enviar_texto_fixo"
        || tipo_resposta == "enviar_coluna"
        || tipo_resposta == "baixar_e_continuar"
        || (!msg_final.trim().is_empty() && (tipo_resposta == "finalizar_baixar" || tipo_resposta == "finalizar_sucesso"));

    if pode_enviar_msg && !msg_final.trim().is_empty() {
        tracing::info!("Enviando próxima mensagem (Passo {}): {}", proximo_passo, msg_final);
        db::registrar_log("INFO", "Mensagem de Resposta Enviada", &serde_json::json!({
            "para": tel_db,
            "passo": proximo_passo,
            "mensagem": msg_final
        }));

        let client = reqwest::Client::new();
        let body = serde_json::json!({
            "to": tel_db,
            "message": msg_final
        });
        let _ = client.post("http://localhost:3001/api/wpp/send").json(&body).send().await;
    }

    // Determina se deve avançar para o próximo passo:
    // Avança se houver mais passos E não for encerramento forçado imediato
    let encerramento_imediato = (tipo_resposta == "finalizar" || tipo_resposta == "finalizar_sucesso") && msg_final.trim().is_empty();
    let deve_continuar = tem_mais_passos && !encerramento_imediato && (
        tipo_resposta == "enviar_texto"
        || tipo_resposta == "enviar_texto_fixo"
        || tipo_resposta == "enviar_coluna"
        || tipo_resposta == "baixar_e_continuar"
        || tipo_resposta == "finalizar_baixar"
    );

    if deve_continuar {
        tracing::info!("Avançando para o próximo passo (Passo {}). Resetando mensagens_acumuladas.", proximo_passo);
        let tel_db_c = tel_db.clone();
        let _ = tokio::task::spawn_blocking(move || {
            if let Ok(conn) = db::init_db() {
                let _ = conn.execute(
                    "UPDATE sessoes_ativas SET passo_atual = ?1, mensagens_acumuladas = 0 WHERE telefone = ?2",
                    params![proximo_passo, tel_db_c],
                );
            }
        }).await;
        return Json(serde_json::json!({ "status": "sucesso_passo_avancado", "passo": proximo_passo }));
    }

    // Se não há mais passos ou a ação foi de finalizar -> Conclui o fluxo e limpa sessão
    tracing::info!("Fluxo concluído para {}. Removendo sessão ativa.", tel_db);
    db::registrar_log("INFO", "Fluxo Concluído com Sucesso", &serde_json::json!({
        "telefone": tel_db,
        "passo": passo_atual
    }));
    let tel_db_c2 = tel_db.clone();
    let _ = tokio::task::spawn_blocking(move || {
        if let Ok(conn) = db::init_db() {
            let _ = conn.execute("DELETE FROM sessoes_ativas WHERE telefone = ?1", params![tel_db_c2]);
        }
    }).await;

    // Processa o próximo item da fila de lote, se houver
    let proximo_item = tokio::task::spawn_blocking(move || -> Option<(i64, String, String, String)> {
        let conn = db::init_db().ok()?;
        let mut stmt = conn.prepare("SELECT id, telefone, fluxo_id, parametros_json FROM fila_lote WHERE status = 'pendente' ORDER BY id ASC LIMIT 1").ok()?;
        let row = stmt.query_row([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        }).ok()?;
        Some(row)
    }).await.ok().flatten();

    if let Some((row_id, tel_prox, fluxo_id_prox, params_json_prox)) = proximo_item {
        tracing::info!("Iniciando próximo item da fila (ID {}): telefone={}", row_id, tel_prox);
        let tel_c = tel_prox.clone();
        let fluxo_c = fluxo_id_prox.clone();
        let params_c = params_json_prox.clone();

        let _ = tokio::task::spawn_blocking(move || {
            if let Ok(conn) = db::init_db() {
                let _ = conn.execute("UPDATE fila_lote SET status = 'em_andamento' WHERE id = ?1", params![row_id]);
                let _ = conn.execute(
                    "INSERT OR REPLACE INTO sessoes_ativas (telefone, fluxo_id, passo_atual, parametros_json, mensagens_acumuladas) VALUES (?1, ?2, 0, ?3, 0)",
                    params![tel_c, fluxo_c, params_c],
                );
            }
        }).await;

        let params: serde_json::Value = serde_json::from_str(&params_json_prox).unwrap_or_default();
        let msg_inicial = params.get("mensagem_inicial").and_then(|v| v.as_str()).unwrap_or("");

        if !msg_inicial.trim().is_empty() {
            let client = reqwest::Client::new();
            let body = serde_json::json!({
                "to": tel_prox,
                "message": msg_inicial
            });
            let _ = client.post("http://localhost:3001/api/wpp/send").json(&body).send().await;
        }
    }

    Json(serde_json::json!({ "status": "fluxo_concluido" }))
}

async fn listar_fluxos() -> Json<serde_json::Value> {
    let fluxos = tokio::task::spawn_blocking(|| {
        let conn = db::init_db().ok()?;
        let mut stmt = conn.prepare("SELECT json_conteudo FROM fluxos").ok()?;
        let rows = stmt.query_map([], |row| {
            let json_str: String = row.get(0)?;
            Ok(serde_json::from_str::<serde_json::Value>(&json_str).unwrap_or_default())
        }).ok()?;
        let mut res = Vec::new();
        for row in rows {
            if let Ok(f) = row {
                res.push(f);
            }
        }
        Some(res)
    }).await.ok().flatten().unwrap_or_default();

    Json(serde_json::json!(fluxos))
}

async fn criar_fluxo(Json(fluxo): Json<serde_json::Value>) -> Json<serde_json::Value> {
    let id = fluxo["id"].as_str().unwrap_or("").to_string();
    let nome = fluxo["nome"].as_str().unwrap_or("").to_string();
    let json_str = serde_json::to_string(&fluxo).unwrap_or_default();
    
    let _ = tokio::task::spawn_blocking(move || {
        if let Ok(conn) = db::init_db() {
            let _ = conn.execute(
                "INSERT OR REPLACE INTO fluxos (id, nome, json_conteudo) VALUES (?1, ?2, ?3)",
                params![id, nome, json_str],
            );
        }
    }).await;

    Json(serde_json::json!({ "status": "criado" }))
}

async fn deletar_fluxo(Path(id): Path<String>) -> Json<serde_json::Value> {
    let _ = tokio::task::spawn_blocking(move || {
        if let Ok(conn) = db::init_db() {
            let _ = conn.execute("DELETE FROM fluxos WHERE id = ?1", params![id]);
        }
    }).await;

    Json(serde_json::json!({ "status": "deletado" }))
}

async fn executar_fluxo(Json(req): Json<serde_json::Value>) -> Json<serde_json::Value> {
    let fluxo_id = req["fluxo_id"].as_str().unwrap_or("").to_string();
    let telefone = req["telefone"].as_str().unwrap_or("").to_string();
    let parametros = req["parametros"].as_object().cloned().unwrap_or_default();

    let msg_inicial = parametros.get("mensagem_inicial").and_then(|v| v.as_str()).unwrap_or("").to_string();

    if msg_inicial.trim().is_empty() {
        return Json(serde_json::json!({ "error": "Mensagem inicial vazia." }));
    }

    let tel_clone = telefone.clone();
    let fluxo_id_clone = fluxo_id.clone();
    let params_str = serde_json::to_string(&parametros).unwrap_or_default();

    // Salva ou sobrescreve a sessão ativa para este telefone com passo_atual = 0 (mensagem inicial disparada)
    let _ = tokio::task::spawn_blocking(move || {
        if let Ok(conn) = db::init_db() {
            let _ = conn.execute(
                "INSERT OR REPLACE INTO sessoes_ativas (telefone, fluxo_id, passo_atual, parametros_json, mensagens_acumuladas) VALUES (?1, ?2, 0, ?3, 0)",
                params![tel_clone, fluxo_id_clone, params_str],
            );
        }
    }).await;

    // Dispara apenas a primeira mensagem (mensagem_inicial)
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "to": telefone,
        "message": msg_inicial
    });
    
    if let Ok(resp) = client.post("http://localhost:3001/api/wpp/send").json(&body).send().await {
        if resp.status().is_success() {
            return Json(serde_json::json!({ "status": "enviado_aguardando_resposta" }));
        }
    }

    Json(serde_json::json!({ "error": "Falha ao disparar mensagem inicial pelo wpp_server" }))
}

async fn executar_lote(Json(req): Json<serde_json::Value>) -> Json<serde_json::Value> {
    let fluxo_id = req["fluxo_id"].as_str().unwrap_or("").to_string();
    let telefone = req["telefone"].as_str().unwrap_or("").to_string();
    let itens = req["itens"].as_array().cloned().unwrap_or_default();

    if itens.is_empty() {
        return Json(serde_json::json!({ "error": "Lista de itens do lote está vazia." }));
    }

    let tel_clone = telefone.clone();
    let fluxo_id_clone = fluxo_id.clone();
    let itens_clone = itens.clone();

    // Insere todos na fila de lote
    let _ = tokio::task::spawn_blocking(move || {
        if let Ok(conn) = db::init_db() {
            // Opcional: limpa a fila antiga pendente se quiser recomeçar do zero
            let _ = conn.execute("DELETE FROM fila_lote WHERE status = 'pendente'", []);
            
            for item in itens_clone {
                let params_str = serde_json::to_string(&item).unwrap_or_default();
                let _ = conn.execute(
                    "INSERT INTO fila_lote (telefone, fluxo_id, parametros_json, status) VALUES (?1, ?2, ?3, 'pendente')",
                    params![tel_clone, fluxo_id_clone, params_str],
                );
            }
        }
    }).await;

    // Dispara imediatamente o PRIMEIRO item da fila
    let proximo_item = tokio::task::spawn_blocking(move || -> Option<(i64, String, String, String)> {
        let conn = db::init_db().ok()?;
        // Limpa sessões ativas anteriores para garantir que o novo lote comece do zero
        let _ = conn.execute("DELETE FROM sessoes_ativas", []);

        let mut stmt = conn.prepare("SELECT id, telefone, fluxo_id, parametros_json FROM fila_lote WHERE status = 'pendente' ORDER BY id ASC LIMIT 1").ok()?;
        let row = stmt.query_row([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        }).ok()?;
        Some(row)
    }).await.ok().flatten();

    if let Some((row_id, tel_prox, fluxo_id_prox, params_json_prox)) = proximo_item {
        tracing::info!("Iniciando 1º item do lote (ID {}): telefone={}", row_id, tel_prox);
        
        let tel_c = tel_prox.clone();
        let fluxo_c = fluxo_id_prox.clone();
        let params_c = params_json_prox.clone();

        let _ = tokio::task::spawn_blocking(move || {
            if let Ok(conn) = db::init_db() {
                let _ = conn.execute("UPDATE fila_lote SET status = 'em_andamento' WHERE id = ?1", params![row_id]);
                let _ = conn.execute(
                    "INSERT OR REPLACE INTO sessoes_ativas (telefone, fluxo_id, passo_atual, parametros_json, mensagens_acumuladas) VALUES (?1, ?2, 0, ?3, 0)",
                    params![tel_c, fluxo_c, params_c],
                );
            }
        }).await;

        let params: serde_json::Value = serde_json::from_str(&params_json_prox).unwrap_or_default();
        let msg_inicial = params.get("mensagem_inicial").and_then(|v| v.as_str()).unwrap_or("");
        
        if !msg_inicial.trim().is_empty() {
            let client = reqwest::Client::new();
            let body = serde_json::json!({
                "to": tel_prox,
                "message": msg_inicial
            });
            let _ = client.post("http://localhost:3001/api/wpp/send").json(&body).send().await;
        }
    }

    Json(serde_json::json!({ "status": "lote_enfileirado", "total": itens.len() }))
}

async fn obter_logs() -> Json<serde_json::Value> {
    let logs = tokio::task::spawn_blocking(|| {
        let conn = db::init_db().ok()?;
        let mut stmt = conn.prepare("SELECT id, timestamp, nivel, mensagem, detalhes_json FROM logs_sistema ORDER BY id DESC LIMIT 200").ok()?;
        let rows = stmt.query_map([], |row| {
            let id: i64 = row.get(0)?;
            let timestamp: String = row.get(1)?;
            let nivel: String = row.get(2)?;
            let mensagem: String = row.get(3)?;
            let det_str: String = row.get(4)?;
            let detalhes: serde_json::Value = serde_json::from_str(&det_str).unwrap_or_default();
            Ok(serde_json::json!({
                "id": id,
                "timestamp": timestamp,
                "nivel": nivel,
                "mensagem": mensagem,
                "detalhes": detalhes
            }))
        }).ok()?;

        let mut res = Vec::new();
        for row in rows {
            if let Ok(l) = row {
                res.push(l);
            }
        }
        Some(res)
    }).await.ok().flatten().unwrap_or_default();

    Json(serde_json::json!(logs))
}

async fn limpar_logs() -> Json<serde_json::Value> {
    let _ = tokio::task::spawn_blocking(|| {
        if let Ok(conn) = db::init_db() {
            let _ = conn.execute("DELETE FROM logs_sistema", []);
        }
    }).await;
    db::registrar_log("INFO", "Histórico de Logs Limpo pelo Usuário", &serde_json::json!({}));
    Json(serde_json::json!({ "status": "logs_limpos" }))
}

async fn cancelar_fila_lote() -> Json<serde_json::Value> {
    let (cancelados, sessoes_limpas) = tokio::task::spawn_blocking(|| -> (usize, usize) {
        let conn = match db::init_db() {
            Ok(c) => c,
            Err(_) => return (0, 0),
        };
        let c_fila = conn.execute("UPDATE fila_lote SET status = 'cancelado' WHERE status = 'pendente'", []).unwrap_or(0);
        let c_sessao = conn.execute("DELETE FROM sessoes_ativas", []).unwrap_or(0);
        (c_fila, c_sessao)
    }).await.ok().unwrap_or((0, 0));

    db::registrar_log("WARN", "Processo em Lote Interrompido Manualmente", &serde_json::json!({
        "itens_pendentes_cancelados": cancelados,
        "sessoes_ativas_encerradas": sessoes_limpas
    }));

    Json(serde_json::json!({
        "status": "lote_cancelado",
        "itens_cancelados": cancelados,
        "sessoes_encerradas": sessoes_limpas
    }))
}

async fn exportar_resumo_lote() -> Json<serde_json::Value> {
    let resumo = tokio::task::spawn_blocking(|| {
        let conn = db::init_db().ok()?;
        
        let mut stmt_fila = conn.prepare("SELECT id, telefone, fluxo_id, status, parametros_json FROM fila_lote ORDER BY id ASC").ok()?;
        let rows_fila = stmt_fila.query_map([], |row| {
            let id: i64 = row.get(0)?;
            let tel: String = row.get(1)?;
            let fluxo: String = row.get(2)?;
            let status: String = row.get(3)?;
            let params_str: String = row.get(4)?;
            let params: serde_json::Value = serde_json::from_str(&params_str).unwrap_or_default();
            Ok(serde_json::json!({
                "id": id,
                "telefone": tel,
                "fluxo_id": fluxo,
                "status": status,
                "parametros": params
            }))
        }).ok()?;

        let mut itens = Vec::new();
        for r in rows_fila {
            if let Ok(item) = r {
                itens.push(item);
            }
        }

        Some(itens)
    }).await.ok().flatten().unwrap_or_default();

    Json(serde_json::json!(resumo))
}
