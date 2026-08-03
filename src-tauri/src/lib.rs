mod download;

use download::manager::DownloadManager;
use download::types::DownloadItem;
use tauri::{AppHandle, Manager};

#[tauri::command]
fn get_downloads(manager: tauri::State<'_, DownloadManager>) -> Vec<DownloadItem> {
    manager.get_all()
}

#[tauri::command]
fn add_download(
    url: String,
    dest_dir: String,
    max_chunks: usize,
    custom_connections: Option<usize>,
    custom_filename: Option<String>,
    app: AppHandle,
    manager: tauri::State<'_, DownloadManager>,
) -> Result<String, String> {
    manager.add(url, dest_dir, max_chunks, custom_connections, custom_filename, app)
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
fn select_directory() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let manager = DownloadManager::new(&app.handle());
            app.manage(manager);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_downloads,
            add_download,
            pause_download,
            resume_download,
            cancel_download,
            delete_download,
            select_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

