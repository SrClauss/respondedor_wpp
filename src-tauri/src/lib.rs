use tauri_plugin_shell::ShellExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                let _ = app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                );
            }

            // Iniciar o backend Axum/Rust existente em background
            tauri::async_runtime::spawn(async move {
                log::info!("Iniciando backend Axum na porta 8080...");
                respondedor_wpp::run_server().await;
            });

            // Iniciar o sidecar do wpp_server se estiver empacotado
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match app_handle.shell().sidecar("wpp_server") {
                    Ok(command) => {
                        log::info!("Iniciando sidecar wpp_server...");
                        match command.spawn() {
                            Ok((mut _rx, mut _child)) => {
                                log::info!("Sidecar wpp_server iniciado com sucesso!");
                            }
                            Err(e) => {
                                log::warn!("Aviso: Não foi possível executar sidecar wpp_server (se estiver em dev ou rodando separado, pode ignorar): {}", e);
                            }
                        }
                    }
                    Err(e) => {
                        log::warn!("Sidecar wpp_server não configurado para o target atual: {}", e);
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
