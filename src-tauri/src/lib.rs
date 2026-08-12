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
    let user_email = {
        let guard = manager.active_user_email.lock().unwrap();
        guard.clone()
    };
    manager.add(url, dest_dir, max_chunks, custom_connections, custom_filename, None, user_email, app).await
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

#[tauri::command]
fn select_image_file() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("Images", &["png", "jpg", "jpeg", "webp", "gif"])
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[derive(serde::Serialize)]
struct DiskInfo {
    name: String,
    mount_point: String,
    total_space: u64,
    available_space: u64,
}

#[tauri::command]
fn get_disk_info(dir: String) -> Result<DiskInfo, String> {
    use sysinfo::Disks;
    let disks = Disks::new_with_refreshed_list();

    let target_path = std::path::Path::new(&dir);
    
    let mut best_match: Option<&sysinfo::Disk> = None;
    let mut best_match_len = 0;

    for disk in &disks {
        let mount_path = disk.mount_point();
        if target_path.starts_with(mount_path) {
            let len = mount_path.as_os_str().len();
            if len > best_match_len {
                best_match_len = len;
                best_match = Some(disk);
            }
        }
    }

    if let Some(disk) = best_match {
        let name = if disk.name().is_empty() {
            disk.mount_point().to_string_lossy().to_string()
        } else {
            disk.name().to_string_lossy().to_string()
        };

        Ok(DiskInfo {
            name,
            mount_point: disk.mount_point().to_string_lossy().to_string(),
            total_space: disk.total_space(),
            available_space: disk.available_space(),
        })
    } else {
        Err("No matching disk found".to_string())
    }
}

/// Called by frontend to tell the backend which folder to use for extension-triggered downloads
#[tauri::command]
fn set_extension_download_dir(
    dir: String,
    app: AppHandle,
    manager: tauri::State<'_, DownloadManager>,
) {
    {
        let mut guard = manager.download_dir.lock().unwrap();
        *guard = dir.clone();
    }
    app.emit("extension-dir-changed", dir).ok();
}

#[tauri::command]
async fn set_active_user_session(
    email: Option<String>,
    manager: tauri::State<'_, DownloadManager>,
) -> Result<(), String> {
    manager.set_active_user(email).await;
    Ok(())
}

#[tauri::command]
async fn save_user_profile(
    email: String,
    name: String,
    mobile: String,
    profile_pic: String,
    manager: tauri::State<'_, DownloadManager>,
) -> Result<(), String> {
    manager.save_profile(email, name, mobile, profile_pic).await
}

#[tauri::command]
async fn get_user_profile(
    email: String,
    manager: tauri::State<'_, DownloadManager>,
) -> Result<Option<download::manager::UserProfile>, String> {
    manager.get_profile(email).await
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
            get_disk_info,
            set_active_user_session,
            save_user_profile,
            get_user_profile,
            select_image_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
