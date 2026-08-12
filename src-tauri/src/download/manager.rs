use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, Emitter};
use tokio_util::sync::CancellationToken;

use super::types::{DownloadItem, DownloadStatus};
use super::download_engine::DownloadEngineTask;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UserProfile {
    pub email: String,
    pub name: String,
    pub mobile: String,
    pub profile_pic: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PendingCollision {
    pub url: String,
    pub dest_dir: String,
    pub max_chunks: usize,
    pub custom_connections: Option<usize>,
    pub custom_filename: Option<String>,
    pub referrer: Option<String>,
    pub user_email: Option<String>,
}

pub struct DownloadManager {
    pub downloads: Arc<Mutex<HashMap<String, DownloadItem>>>,
    pub cancel_tokens: Mutex<HashMap<String, CancellationToken>>,
    pub db_path: PathBuf,
    pub profile_path: PathBuf,
    pub db_client: Arc<tokio::sync::Mutex<Option<tokio_postgres::Client>>>,
    pub pending_collisions: Mutex<HashMap<String, PendingCollision>>,
    pub download_dir: Arc<Mutex<String>>,
    pub active_user_email: Arc<Mutex<Option<String>>>,
}

async fn connect_db() -> Result<tokio_postgres::Client, String> {
    let connection_string = "postgresql://postgres:SyyiNmqfAdT2A4Ev@db.iqwrdwnyxfrdpzxjjhda.supabase.co:5432/postgres?sslmode=require";
    
    let native_tls_connector = native_tls::TlsConnector::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("Failed to build TlsConnector: {}", e))?;
    
    let connector = postgres_native_tls::MakeTlsConnector::new(native_tls_connector);
    
    let (client, connection) = tokio_postgres::connect(connection_string, connector)
        .await
        .map_err(|e| format!("Failed to connect to postgres: {}", e))?;
        
    tauri::async_runtime::spawn(async move {
        if let Err(e) = connection.await {
            // Silence pool errors to prevent terminal noise when offline
        }
    });
    
    Ok(client)
}

impl DownloadManager {
    pub fn new(app_handle: &AppHandle) -> Self {
        let mut tauri_dir = app_handle
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."));
            
        if !tauri_dir.exists() {
            let _ = std::fs::create_dir_all(&tauri_dir);
        }
        
        let mut db_path = tauri_dir.clone();
        db_path.push("downloads.json");

        let mut profile_path = tauri_dir.clone();
        profile_path.push("profile.json");

        let downloads = Arc::new(Mutex::new(Self::load_downloads(&db_path).unwrap_or_default()));
        let db_client = Arc::new(tokio::sync::Mutex::new(None));
        
        let download_dir = Arc::new(Mutex::new(
            dirs::download_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .to_string_lossy()
                .to_string()
        ));
        
        let active_user_email: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

        // Spawn background database worker for connection and sync
        let client_clone = db_client.clone();
        let downloads_clone = downloads.clone();
        let db_path_clone = db_path.clone();
        let active_user_email_clone = active_user_email.clone();

        tauri::async_runtime::spawn(async move {
            loop {
                // Check if current user is local_user or none
                let is_local = {
                    let email_guard = active_user_email_clone.lock().unwrap();
                    email_guard.as_ref()
                        .map(|e| e == "local_user" || e.starts_with("guest"))
                        .unwrap_or(true)
                };

                if is_local {
                    // Local-only mode: Disconnect if connected
                    let mut guard = client_clone.lock().await;
                    if guard.is_some() {
                        println!("Active user is local. Disconnecting from Supabase...");
                        *guard = None;
                    }
                    tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                    continue;
                }

                let need_connect = {
                    let guard = client_clone.lock().await;
                    guard.is_none()
                };

                if need_connect {
                    println!("Connecting to Supabase Database...");
                    match connect_db().await {
                        Ok(client) => {
                            println!("Successfully connected to Supabase Database!");
                            
                            // Initialize table schema and columns
                            let queries = vec![
                                "CREATE TABLE IF NOT EXISTS downloads (
                                    id TEXT PRIMARY KEY,
                                    url TEXT NOT NULL,
                                    file_name TEXT NOT NULL,
                                    file_path TEXT NOT NULL,
                                    total_size BIGINT NOT NULL,
                                    downloaded BIGINT NOT NULL,
                                    status TEXT NOT NULL,
                                    user_email TEXT,
                                    referrer TEXT
                                );",
                                "ALTER TABLE downloads ADD COLUMN IF NOT EXISTS user_email TEXT;",
                                "ALTER TABLE downloads ADD COLUMN IF NOT EXISTS referrer TEXT;",
                                "CREATE TABLE IF NOT EXISTS profiles (
                                    email TEXT PRIMARY KEY,
                                    name TEXT,
                                    mobile TEXT,
                                    profile_pic TEXT
                                );"
                            ];

                            let mut migration_ok = true;
                            for q in queries {
                                if let Err(e) = client.execute(q, &[]).await {
                                    eprintln!("Failed to execute schema query: {}. Query: {}", e, q);
                                    migration_ok = false;
                                    break;
                                }
                            }

                            if migration_ok {
                                // Set the client
                                {
                                    let mut guard = client_clone.lock().await;
                                    *guard = Some(client);
                                }

                                // Check if there is already an active user logged in, if so fetch their downloads
                                let active_email = {
                                    let guard = active_user_email_clone.lock().unwrap();
                                    guard.clone()
                                };
                                
                                if let Some(email) = active_email {
                                    if email != "local_user" && !email.starts_with("guest") {
                                        println!("Database connected! Fetching downloads for logged-in user: {}", email);
                                        let fetch_query = "SELECT id, url, file_name, file_path, total_size, downloaded, status, referrer FROM downloads WHERE user_email = $1";
                                        let guard = client_clone.lock().await;
                                        if let Some(ref active_client) = *guard {
                                            if let Ok(rows) = active_client.query(fetch_query, &[&email]).await {
                                                let mut downloads_map = downloads_clone.lock().unwrap();
                                                for row in rows {
                                                    let id: String = row.get(0);
                                                    let url: String = row.get(1);
                                                    let file_name: String = row.get(2);
                                                    let file_path: String = row.get(3);
                                                    let total_size: i64 = row.get(4);
                                                    let downloaded: i64 = row.get(5);
                                                    let status_str: String = row.get(6);
                                                    let referrer: Option<String> = row.get(7);

                                                    let status = match status_str.as_str() {
                                                        "Completed" => DownloadStatus::Completed,
                                                        "Paused" => DownloadStatus::Paused,
                                                        s if s.starts_with("Failed:") => {
                                                            DownloadStatus::Failed(s.replace("Failed: ", ""))
                                                        }
                                                        _ => DownloadStatus::Paused,
                                                    };

                                                    downloads_map.entry(id.clone()).or_insert(DownloadItem {
                                                        id,
                                                        url,
                                                        file_name,
                                                        file_path,
                                                        total_size: total_size as u64,
                                                        downloaded: downloaded as u64,
                                                        status,
                                                        speed: 0.0,
                                                        eta: -1.0,
                                                        chunks: Vec::new(),
                                                        resumable: true,
                                                        referrer,
                                                        user_email: Some(email.clone()),
                                                    });
                                                }

                                                // Save merged cache locally
                                                let list: Vec<DownloadItem> = downloads_map.values().cloned().collect();
                                                if let Ok(content) = serde_json::to_string_pretty(&list) {
                                                    if let Ok(mut file) = File::create(&db_path_clone) {
                                                        let _ = file.write_all(content.as_bytes());
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("Supabase connection failed: {}. Retrying in 15 seconds.", e);
                        }
                    }
                }
                
                tokio::time::sleep(tokio::time::Duration::from_secs(15)).await;
            }
        });

        Self {
            downloads,
            cancel_tokens: Mutex::new(HashMap::new()),
            db_path,
            profile_path,
            db_client,
            pending_collisions: Mutex::new(HashMap::new()),
            download_dir,
            active_user_email,
        }
    }

    fn load_downloads(path: &Path) -> Option<HashMap<String, DownloadItem>> {
        if !path.exists() {
            return None;
        }
        let mut file = File::open(path).ok()?;
        let mut content = String::new();
        file.read_to_string(&mut content).ok()?;
        
        let list: Vec<DownloadItem> = serde_json::from_str(&content).ok()?;
        let map: HashMap<String, DownloadItem> = list
            .into_iter()
            .map(|mut item| {
                if item.status == DownloadStatus::Downloading {
                    item.status = DownloadStatus::Paused;
                }
                item.speed = 0.0;
                item.eta = -1.0;
                (item.id.clone(), item)
            })
            .collect();
        Some(map)
    }

    pub fn save_downloads(&self) {
        let downloads = self.downloads.lock().unwrap();
        let list: Vec<DownloadItem> = downloads.values().cloned().collect();
        if let Ok(content) = serde_json::to_string_pretty(&list) {
            if let Ok(mut file) = File::create(&self.db_path) {
                let _ = file.write_all(content.as_bytes());
            }
        }
    }

    pub fn get_all(&self) -> Vec<DownloadItem> {
        let downloads = self.downloads.lock().unwrap();
        downloads.values().cloned().collect()
    }

    pub fn add_direct(
        &self,
        url: String,
        dest_dir: String,
        max_chunks: usize,
        custom_connections: Option<usize>,
        custom_filename: Option<String>,
        auto_rename: bool,
        referrer: Option<String>,
        user_email: Option<String>,
        app_handle: AppHandle,
    ) -> Result<String, String> {
        let file_name = if let Some(custom) = custom_filename.clone() {
            custom
        } else {
            let url_parsed = reqwest::Url::parse(&url).map_err(|_| "Invalid URL")?;
            let name = url_parsed
                .path_segments()
                .and_then(|segments| segments.last())
                .unwrap_or("download")
                .to_string();

            if name.is_empty() {
                "download".to_string()
            } else {
                percent_encoding::percent_decode_str(&name)
                    .decode_utf8_lossy()
                    .to_string()
            }
        };

        let mut file_name = file_name;
        let mut file_path = PathBuf::from(&dest_dir).join(&file_name);

        // Auto-rename if the file already exists on disk to prevent overwriting/deleting it
        if auto_rename && file_path.exists() {
            let stem = file_path.file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let ext = file_path.extension()
                .map(|e| format!(".{}", e.to_string_lossy()))
                .unwrap_or_default();
            
            let mut counter = 1;
            loop {
                let candidate_name = format!("{} ({}){}", stem, counter, ext);
                let candidate_path = PathBuf::from(&dest_dir).join(&candidate_name);
                if !candidate_path.exists() {
                    file_path = candidate_path;
                    file_name = candidate_name;
                    break;
                }
                counter += 1;
            }
        }

        let id = uuid::Uuid::new_v4().to_string();

        let item = DownloadItem {
            id: id.clone(),
            url: url.clone(),
            file_name: file_name.clone(),
            file_path: file_path.to_string_lossy().to_string(),
            total_size: 0,
            downloaded: 0,
            status: DownloadStatus::Queued,
            speed: 0.0,
            eta: -1.0,
            chunks: Vec::new(),
            resumable: true,
            referrer,
            user_email,
        };

        {
            let mut downloads = self.downloads.lock().unwrap();
            downloads.insert(id.clone(), item);
        }
        self.save_downloads();
        self.sync_item_to_db(id.clone());

        self.start_task(id.clone(), max_chunks, custom_connections, Some(file_name), app_handle)?;

        Ok(id)
    }

    pub async fn add(
        &self,
        url: String,
        dest_dir: String,
        max_chunks: usize,
        custom_connections: Option<usize>,
        custom_filename: Option<String>,
        referrer: Option<String>,
        user_email: Option<String>,
        app_handle: AppHandle,
    ) -> Result<String, String> {
        let mut file_name = if let Some(custom) = custom_filename.clone() {
            custom
        } else {
            let url_parsed = reqwest::Url::parse(&url).map_err(|_| "Invalid URL")?;
            let name = url_parsed
                .path_segments()
                .and_then(|segments| segments.last())
                .unwrap_or("download")
                .to_string();

            if name.is_empty() {
                "download".to_string()
            } else {
                percent_encoding::percent_decode_str(&name)
                    .decode_utf8_lossy()
                    .to_string()
            }
        };

        // Probe server for real filename if name is temporary (no extension or hex)
        let is_temp_name = !file_name.contains('.') || file_name.chars().all(|c| c.is_ascii_hexdigit());
        if is_temp_name {
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(4))
                .build()
                .unwrap_or_default();
            if let Ok(res) = client.get(&url).header(reqwest::header::RANGE, "bytes=0-0").send().await {
                if res.status().is_success() {
                    let final_url = res.url().to_string();
                    let mut server_filename = None;
                    
                    if let Some(cd) = res.headers().get(reqwest::header::CONTENT_DISPOSITION) {
                        if let Ok(cd_str) = cd.to_str() {
                            if let Some(parsed) = parse_content_disposition(cd_str) {
                                server_filename = Some(parsed);
                            }
                        }
                    }

                    if server_filename.is_none() {
                        if let Ok(parsed_final_url) = reqwest::Url::parse(&final_url) {
                            if let Some(segment) = parsed_final_url.path_segments().and_then(|s| s.last()) {
                                if !segment.is_empty() {
                                    server_filename = Some(percent_encoding::percent_decode_str(segment).decode_utf8_lossy().to_string());
                                }
                            }
                        }
                    }

                    if let Some(name) = server_filename {
                        if !name.is_empty() {
                            file_name = name;
                        }
                    }
                }
            }
        }

        let file_path = PathBuf::from(&dest_dir).join(&file_name);

        // Check if there is an active/paused download in software queue with same name and directory
        let software_item = {
            let downloads = self.downloads.lock().unwrap();
            downloads.values().find(|item| {
                item.file_name == file_name 
                && PathBuf::from(&item.file_path).parent() == Some(Path::new(&dest_dir))
            }).cloned()
        };

        let has_software_collision = software_item.is_some();
        let has_disk_collision = file_path.exists();

        if has_software_collision || has_disk_collision {
            let temp_id = uuid::Uuid::new_v4().to_string();
            
            // Store pending details
            {
                let mut pending = self.pending_collisions.lock().unwrap();
                pending.insert(temp_id.clone(), PendingCollision {
                    url: url.clone(),
                    dest_dir: dest_dir.clone(),
                    max_chunks,
                    custom_connections,
                    custom_filename: Some(file_name.clone()),
                    referrer: referrer.clone(),
                    user_email: user_email.clone(),
                });
            }

            // Emit event to frontend
            #[derive(serde::Serialize, Clone)]
            struct CollisionPayload {
                temp_id: String,
                url: String,
                dest_dir: String,
                file_name: String,
                disk_exists: bool,
                software_exists: bool,
                existing_id: Option<String>,
            }

            let payload = CollisionPayload {
                temp_id: temp_id.clone(),
                url,
                dest_dir,
                file_name,
                disk_exists: has_disk_collision,
                software_exists: has_software_collision,
                existing_id: software_item.map(|item| item.id),
            };

            // Force window to front so user sees the prompt (IDM style)
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }

            let _ = app_handle.emit("download-collision-request", payload);

            return Err(format!("COLLISION:{}", temp_id));
        }

        // No collision: proceed direct
        self.add_direct(url, dest_dir, max_chunks, custom_connections, Some(file_name), false, referrer, user_email, app_handle)
    }

    pub fn resolve_collision(&self, temp_id: String, choice: String, new_filename: Option<String>, app_handle: AppHandle) -> Result<(), String> {
        let pending = {
            let mut pending_map = self.pending_collisions.lock().unwrap();
            pending_map.remove(&temp_id).ok_or_else(|| "Pending download not found".to_string())?
        };

        match choice.as_str() {
            "numbered" => {
                let filename = new_filename.or(pending.custom_filename);
                self.add_direct(pending.url, pending.dest_dir, pending.max_chunks, pending.custom_connections, filename, true, pending.referrer, pending.user_email, app_handle)?;
            }
            "overwrite" => {
                let filename = new_filename.or(pending.custom_filename);
                self.add_direct(pending.url, pending.dest_dir, pending.max_chunks, pending.custom_connections, filename, false, pending.referrer, pending.user_email, app_handle)?;
            }
            "overwrite_remove_old" => {
                let filename = new_filename.clone().or(pending.custom_filename.clone());
                // Find existing download item ID
                let existing_id = {
                    let downloads = self.downloads.lock().unwrap();
                    let target_name = filename.as_ref().unwrap_or(&"".to_string()).clone();
                    downloads.values().find(|item| {
                        item.file_name == target_name
                        && PathBuf::from(&item.file_path).parent() == Some(Path::new(&pending.dest_dir))
                    }).map(|item| item.id.clone())
                };

                if let Some(id) = existing_id {
                    // Delete the old link
                    let _ = self.delete(id, false);
                }

                self.add_direct(pending.url, pending.dest_dir, pending.max_chunks, pending.custom_connections, filename, false, pending.referrer, pending.user_email, app_handle)?;
            }
            "update_link" => {
                let filename = new_filename.or(pending.custom_filename);
                // Find existing download item
                let existing_id = {
                    let downloads = self.downloads.lock().unwrap();
                    let target_name = filename.as_ref().unwrap_or(&"".to_string()).clone();
                    downloads.values().find(|item| {
                        item.file_name == target_name
                        && PathBuf::from(&item.file_path).parent() == Some(Path::new(&pending.dest_dir))
                    }).map(|item| item.id.clone())
                };

                if let Some(id) = existing_id {
                    // Stop task if running
                    let _ = self.pause(id.clone());
                    
                    // Update url in memory
                    {
                        let mut downloads = self.downloads.lock().unwrap();
                        if let Some(item) = downloads.get_mut(&id) {
                            item.url = pending.url.clone();
                            item.status = DownloadStatus::Paused;
                            item.downloaded = 0;
                            item.speed = 0.0;
                            item.eta = -1.0;
                            item.referrer = pending.referrer.clone();
                            item.user_email = pending.user_email.clone();
                        }
                    }
                    self.save_downloads();
                    self.sync_item_to_db(id.clone());

                    // Delete state file so it starts fresh from 0
                    let mut path = app_handle
                        .path()
                        .app_data_dir()
                        .unwrap_or_else(|_| PathBuf::from("."));
                    path.push(format!("{}.state.json", id));
                    if path.exists() {
                        let _ = std::fs::remove_file(path);
                    }

                    // Resume
                    self.resume(id, pending.custom_connections, app_handle)?;
                } else {
                    return Err("Existing link not found for update".to_string());
                }
            }
            "cancel" => {
                // Do nothing
            }
            _ => return Err("Invalid resolution choice".to_string()),
        }

        Ok(())
    }

    pub fn start_task(&self, id: String, max_chunks: usize, custom_connections: Option<usize>, custom_filename: Option<String>, app_handle: AppHandle) -> Result<(), String> {
        let (url, file_path, referrer) = {
            let downloads = self.downloads.lock().unwrap();
            let item = downloads.get(&id).ok_or_else(|| "Download not found".to_string())?;
            (item.url.clone(), PathBuf::from(&item.file_path), item.referrer.clone())
        };

        let client = reqwest::Client::builder()
            .pool_max_idle_per_host(128)
            .tcp_nodelay(true)
            .connect_timeout(std::time::Duration::from_secs(10))
            .read_timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| e.to_string())?;

        let task = DownloadEngineTask::new(
            id.clone(),
            url,
            file_path,
            client,
            app_handle.clone(),
            max_chunks,
            custom_connections,
            custom_filename,
            referrer,
        );

        let cancel_token = task.cancel_token.clone();
        
        {
            let mut cancel_tokens = self.cancel_tokens.lock().unwrap();
            cancel_tokens.insert(id.clone(), cancel_token);
        }

        tauri::async_runtime::spawn(async move {
            let result = task.execute().await;
            
            let manager = app_handle.state::<DownloadManager>();
            {
                let mut tokens = manager.cancel_tokens.lock().unwrap();
                tokens.remove(&id);
            }
            
            if let Err(e) = result {
                println!("Download task {} failed: {}", id, e);
            }
        });

        Ok(())
    }

    pub fn pause(&self, id: String) -> Result<(), String> {
        let mut tokens = self.cancel_tokens.lock().unwrap();
        if let Some(token) = tokens.remove(&id) {
            token.cancel();
        }
        
        {
            let mut downloads = self.downloads.lock().unwrap();
            if let Some(item) = downloads.get_mut(&id) {
                if item.status == DownloadStatus::Downloading {
                    item.status = DownloadStatus::Paused;
                    item.speed = 0.0;
                    item.eta = -1.0;
                }
            }
        }
        self.save_downloads();
        self.sync_item_to_db(id);
        Ok(())
    }

    pub fn resume(&self, id: String, custom_connections: Option<usize>, app_handle: AppHandle) -> Result<(), String> {
        self.start_task(id, 16, custom_connections, None, app_handle)
    }

    pub fn cancel(&self, id: String) -> Result<(), String> {
        self.pause(id.clone())?;
        
        {
            let mut downloads = self.downloads.lock().unwrap();
            downloads.remove(&id);
        }
        self.save_downloads();
        
        let client_clone = self.db_client.clone();
        let id_clone = id.clone();
        tauri::async_runtime::spawn(async move {
            let guard = client_clone.lock().await;
            if let Some(ref client) = *guard {
                let _ = client.execute("DELETE FROM downloads WHERE id = $1", &[&id_clone]).await;
            }
        });
        
        Ok(())
    }

    pub fn delete(&self, id: String, delete_file: bool) -> Result<(), String> {
        let file_path = {
            let downloads = self.downloads.lock().unwrap();
            downloads.get(&id).map(|item| PathBuf::from(&item.file_path))
        };

        let _ = self.cancel(id);

        if delete_file {
            if let Some(path) = file_path {
                if path.exists() {
                    let _ = std::fs::remove_file(path);
                }
            }
        }
        Ok(())
    }

    pub fn sync_item_to_db(&self, id: String) {
        let item = {
            let downloads = self.downloads.lock().unwrap();
            downloads.get(&id).cloned()
        };

        if let Some(item) = item {
            if let Some(ref email) = item.user_email {
                if email == "local_user" || email.starts_with("guest") {
                    return; // Local-only mode: do not sync to Supabase
                }
            } else {
                return; // No user: do not sync
            }

            let client_clone = self.db_client.clone();
            tauri::async_runtime::spawn(async move {
                let guard = client_clone.lock().await;
                if let Some(ref client) = *guard {
                    let status_str = match &item.status {
                        DownloadStatus::Queued => "Queued".to_string(),
                        DownloadStatus::Downloading => "Downloading".to_string(),
                        DownloadStatus::Paused => "Paused".to_string(),
                        DownloadStatus::Completed => "Completed".to_string(),
                        DownloadStatus::Failed(e) => format!("Failed: {}", e),
                    };

                    let query = "
                        INSERT INTO downloads (id, url, file_name, file_path, total_size, downloaded, status, user_email, referrer)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                        ON CONFLICT (id) DO UPDATE SET
                            downloaded = EXCLUDED.downloaded,
                            total_size = EXCLUDED.total_size,
                            status = EXCLUDED.status,
                            user_email = EXCLUDED.user_email,
                            referrer = EXCLUDED.referrer;
                    ";

                    let _ = client.execute(
                        query,
                        &[
                            &item.id,
                            &item.url,
                            &item.file_name,
                            &item.file_path,
                            &(item.total_size as i64),
                            &(item.downloaded as i64),
                            &status_str,
                            &item.user_email,
                            &item.referrer,
                        ]
                    ).await;
                }
            });
        }
    }

    pub async fn set_active_user(&self, email: Option<String>) {
        {
            let mut active_guard = self.active_user_email.lock().unwrap();
            *active_guard = email.clone();
        }

        if let Some(ref email_str) = email {
            if email_str != "local_user" && !email_str.starts_with("guest") {
                // Logged in: load user's downloads from DB
                self.load_user_downloads_from_db(email_str.clone()).await;
            } else {
                // Local/Guest mode: load downloads from local json file
                let local_map = Self::load_downloads(&self.db_path).unwrap_or_default();
                let mut downloads = self.downloads.lock().unwrap();
                downloads.clear();
                for (id, d) in local_map {
                    downloads.insert(id, d);
                }
            }
        } else {
            // Logged out: clear local cache and db file
            {
                let mut downloads = self.downloads.lock().unwrap();
                downloads.clear();
            }
            if self.db_path.exists() {
                let _ = std::fs::remove_file(&self.db_path);
            }
        }
    }

    pub async fn load_user_downloads_from_db(&self, email: String) {
        let client_guard = self.db_client.lock().await;
        if let Some(ref client) = *client_guard {
            println!("Loading downloads from Supabase for user: {}...", email);
            let query = "SELECT id, url, file_name, file_path, total_size, downloaded, status, referrer FROM downloads WHERE user_email = $1";
            match client.query(query, &[&email]).await {
                Ok(rows) => {
                    let mut downloads_map = self.downloads.lock().unwrap();
                    downloads_map.clear(); // Clear existing local list first
                    for row in rows {
                        let id: String = row.get(0);
                        let url: String = row.get(1);
                        let file_name: String = row.get(2);
                        let file_path: String = row.get(3);
                        let total_size: i64 = row.get(4);
                        let downloaded: i64 = row.get(5);
                        let status_str: String = row.get(6);
                        let referrer: Option<String> = row.get(7);

                        let status = match status_str.as_str() {
                            "Completed" => DownloadStatus::Completed,
                            "Paused" => DownloadStatus::Paused,
                            s if s.starts_with("Failed:") => {
                                DownloadStatus::Failed(s.replace("Failed: ", ""))
                            }
                            _ => DownloadStatus::Paused,
                        };

                        downloads_map.insert(id.clone(), DownloadItem {
                            id,
                            url,
                            file_name,
                            file_path,
                            total_size: total_size as u64,
                            downloaded: downloaded as u64,
                            status,
                            speed: 0.0,
                            eta: -1.0,
                            chunks: Vec::new(),
                            resumable: true,
                            referrer,
                            user_email: Some(email.clone()),
                        });
                    }

                    // Save merged cache locally
                    let list: Vec<DownloadItem> = downloads_map.values().cloned().collect();
                    if let Ok(content) = serde_json::to_string_pretty(&list) {
                        if let Ok(mut file) = File::create(&self.db_path) {
                            let _ = file.write_all(content.as_bytes());
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Failed to load downloads from Supabase for user {}: {}", email, e);
                }
            }
        }
    }

    pub async fn save_profile(&self, email: String, name: String, mobile: String, profile_pic: String) -> Result<(), String> {
        if email == "local_user" || email.starts_with("guest") {
            let profile = UserProfile {
                email,
                name,
                mobile,
                profile_pic,
            };
            if let Ok(content) = serde_json::to_string_pretty(&profile) {
                if let Ok(mut file) = File::create(&self.profile_path) {
                    let _ = file.write_all(content.as_bytes());
                }
            }
            return Ok(());
        }

        let client_guard = self.db_client.lock().await;
        if let Some(ref client) = *client_guard {
            let query = "
                INSERT INTO profiles (email, name, mobile, profile_pic)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (email) DO UPDATE SET
                    name = EXCLUDED.name,
                    mobile = EXCLUDED.mobile,
                    profile_pic = EXCLUDED.profile_pic;
            ";
            client.execute(query, &[&email, &name, &mobile, &profile_pic])
                .await
                .map_err(|e| format!("Failed to save profile in Supabase: {}", e))?;
            Ok(())
        } else {
            Err("Database not connected".to_string())
        }
    }

    pub async fn get_profile(&self, email: String) -> Result<Option<UserProfile>, String> {
        if email == "local_user" || email.starts_with("guest") {
            if self.profile_path.exists() {
                if let Ok(content) = std::fs::read_to_string(&self.profile_path) {
                    if let Ok(profile) = serde_json::from_str::<UserProfile>(&content) {
                        return Ok(Some(profile));
                    }
                }
            }
            return Ok(None);
        }

        let client_guard = self.db_client.lock().await;
        if let Some(ref client) = *client_guard {
            let query = "SELECT email, name, mobile, profile_pic FROM profiles WHERE email = $1";
            let rows = client.query(query, &[&email])
                .await
                .map_err(|e| format!("Failed to query profile: {}", e))?;
            
            if let Some(row) = rows.first() {
                Ok(Some(UserProfile {
                    email: row.get(0),
                    name: row.get(1),
                    mobile: row.get(2),
                    profile_pic: row.get(3),
                }))
            } else {
                Ok(None)
            }
        } else {
            Err("Database not connected".to_string())
        }
    }
}

fn parse_content_disposition(header_val: &str) -> Option<String> {
    let parts: Vec<&str> = header_val.split(';').collect();
    for part in parts {
        let trimmed = part.trim();
        if trimmed.starts_with("filename=") {
            let val = trimmed.replace("filename=", "").trim_matches('"').to_string();
            if !val.is_empty() {
                return Some(val);
            }
        } else if trimmed.starts_with("filename*=") {
            let val = trimmed.replace("filename*=", "");
            let subparts: Vec<&str> = val.split("''").collect();
            if subparts.len() == 2 {
                if let Ok(decoded) = percent_encoding::percent_decode_str(subparts[1]).decode_utf8() {
                    return Some(decoded.to_string());
                }
            }
        }
    }
    None
}
