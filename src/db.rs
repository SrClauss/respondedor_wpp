use rusqlite::{params, Connection, Result};

pub fn init_db() -> Result<Connection> {
    // Create data dir if it doesn't exist
    std::fs::create_dir_all("data").unwrap_or_default();
    let conn = Connection::open("data/automacao.db")?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS fluxos (
            id TEXT PRIMARY KEY,
            nome TEXT NOT NULL,
            json_conteudo TEXT NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS clientes (
            id TEXT PRIMARY KEY,
            nome TEXT NOT NULL,
            telefone_receptor TEXT NOT NULL,
            json_parametros TEXT NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS sessoes_ativas (
            telefone TEXT PRIMARY KEY,
            fluxo_id TEXT NOT NULL,
            passo_atual INTEGER NOT NULL,
            parametros_json TEXT NOT NULL,
            mensagens_acumuladas INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )?;

    // Migration for existing tables
    let _ = conn.execute(
        "ALTER TABLE sessoes_ativas ADD COLUMN mensagens_acumuladas INTEGER NOT NULL DEFAULT 0",
        [],
    );

    conn.execute(
        "CREATE TABLE IF NOT EXISTS fila_lote (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telefone TEXT NOT NULL,
            fluxo_id TEXT NOT NULL,
            parametros_json TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pendente'
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS logs_sistema (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            nivel TEXT NOT NULL,
            mensagem TEXT NOT NULL,
            detalhes_json TEXT NOT NULL DEFAULT '{}'
        )",
        [],
    )?;

    Ok(conn)
}

pub fn registrar_log(nivel: &str, mensagem: &str, detalhes: &serde_json::Value) {
    if let Ok(conn) = init_db() {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs().to_string())
            .unwrap_or_default();
        let det_str = serde_json::to_string(detalhes).unwrap_or_default();
        let _ = conn.execute(
            "INSERT INTO logs_sistema (timestamp, nivel, mensagem, detalhes_json) VALUES (?1, ?2, ?3, ?4)",
            params![ts, nivel, mensagem, det_str],
        );
    }
}
