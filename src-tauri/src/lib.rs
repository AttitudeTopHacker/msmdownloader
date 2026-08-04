mod download;
mod server;

use download::manager::DownloadManager;
use download::types::DownloadItem;
use tauri::{AppHandle, Manager, Emitter};

#[tauri::command]
fn get_downloads(manager: tauri::State<'_, DownloadManager>) -> Vec<DownloadItem> {
    manager.get_all()
}

#[tauri::command]
async fn add_download(
    url: String,
    dest_dir: String,
    max_chunks: usize,
    custom_connections: Option<usize>,
    custom_filename: Option<String>,
    app: AppHandle,
    manager: tauri::State<'_, DownloadManager>,
) -> Result<String, String> {
    manager.add(url, dest_dir, max_chunks, custom_connections, custom_filename, app).await
}

#[tauri::command]
fn pause_download(
    id: String,
    manager: tauri::State<'_, DownloadManager>,
) -> Result<(), String> {
    manager.pause(id)
}

#[tauri::command]
fn resume_download(
    id: String,
    custom_connections: Option<usize>,
    app: AppHandle,
    manager: tauri::State<'_, DownloadManager>,
) -> Result<(), String> {
    manager.resume(id, custom_connections, app)
}

#[tauri::command]
fn cancel_download(
    id: String,
    manager: tauri::State<'_, DownloadManager>,
) -> Result<(), String> {
    manager.cancel(id)
}

#[tauri::command]
fn delete_download(
    id: String,
    delete_file: bool,
    manager: tauri::State<'_, DownloadManager>,
) -> Result<(), String> {
    manager.delete(id, delete_file)
}

#[tauri::command]
fn resolve_download_collision(
    temp_id: String,
    choice: String,
    new_filename: Option<String>,
    app: AppHandle,
    manager: tauri::State<'_, DownloadManager>,
) -> Result<(), String> {
    manager.resolve_collision(temp_id, choice, new_filename, app)
}

#[tauri::command]
fn select_directory() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string())
}

/// Called by frontend to tell the backend which folder to use for extension-triggered downloads
#[tauri::command]
fn set_extension_download_dir(
    dir: String,
    app: AppHandle,
) {
    // Re-start server with updated dir — for now emit an event the server can consume
    app.emit("extension-dir-changed", dir).ok();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            
            // Set window icon explicitly for taskbar compatibility on Linux/X11
            if let Some(window) = app.get_webview_window("main") {
                let icon_bytes = include_bytes!("../icons/icon.png");
                if let Ok(img) = tauri::image::Image::from_bytes(icon_bytes) {
                    let _ = window.set_icon(img);
                }
            }

            let manager = DownloadManager::new(&handle);
            app.manage(manager);

            // Start local HTTP server for browser extension on port 9999
            // Default download dir: user's Downloads folder
            let dest_dir = dirs::download_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .to_string_lossy()
                .to_string();

            server::start_local_server(handle, dest_dir);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_downloads,
            add_download,
            pause_download,
            resume_download,
            cancel_download,
            delete_download,
            select_directory,
            set_extension_download_dir,
            resolve_download_collision,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
