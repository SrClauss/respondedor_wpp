mod db;
mod excel;
mod models;
mod runner;

use axum::{
    extract::Json,
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
use tower_http::services::{ServeDir, ServeFile};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Inicializar banco de dados SQLite local
    let _conn = db::init_db().expect("Falha ao inicializar o banco de dados SQLite local");
    tracing::info!("Banco de dados SQLite inicializado com sucesso.");

    // Serviço para entregar os arquivos estáticos compilados do React (SPA Fallback)
    let serve_dir = ServeDir::new("frontend/dist")
        .not_found_service(ServeFile::new("frontend/dist/index.html"));

    let app = Router::new()
        .route("/api/health", get(health_check))
        .route("/webhook/wpp", post(receber_webhook_wpp))
        .fallback_service(serve_dir);

    let addr = SocketAddr::from(([0, 0, 0, 0], 8080));
    tracing::info!("Servidor rodando em http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn health_check() -> &'static str {
    "OK"
}

/// Endpoint de Webhook para receber mensagens do wpp_server
async fn receber_webhook_wpp(
    Json(payload): Json<runner::WppWebhookPayload>,
) -> Json<serde_json::Value> {
    tracing::info!("Webhook wpp_server recebido: de={}", payload.from);
    Json(serde_json::json!({ "status": "recebido", "from": payload.from }))
}
