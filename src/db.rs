use rusqlite::{params, Connection, Result};

pub fn init_db() -> Result<Connection> {
    let conn = Connection::open("automacao.db")?;

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
        "CREATE TABLE IF NOT EXISTS tarefas (
            id TEXT PRIMARY KEY,
            fluxo_id TEXT NOT NULL,
            cliente_id TEXT NOT NULL,
            status TEXT NOT NULL,
            data_criacao TEXT NOT NULL
        )",
        [],
    )?;

    Ok(conn)
}
