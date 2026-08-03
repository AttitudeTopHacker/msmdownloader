use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use tokio_util::sync::CancellationToken;

use super::types::{DownloadItem, DownloadStatus};
use super::download_engine::DownloadEngineTask;


pub struct DownloadManager {
    pub downloads: Arc<Mutex<HashMap<String, DownloadItem>>>,
    pub cancel_tokens: Mutex<HashMap<String, CancellationToken>>,
    pub db_path: PathBuf,
    pub db_client: Arc<tokio::sync::Mutex<Option<tokio_postgres::Client>>>,
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
        let mut db_path = app_handle
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."));
            
        if !db_path.exists() {
            let _ = std::fs::create_dir_all(&db_path);
        }
        db_path.push("downloads.json");

        let downloads = Arc::new(Mutex::new(Self::load_downloads(&db_path).unwrap_or_default()));
        let db_client = Arc::new(tokio::sync::Mutex::new(None));

        // Spawn background database worker for connection and sync
        let client_clone = db_client.clone();
        let downloads_clone = downloads.clone();
        let db_path_clone = db_path.clone();

        tauri::async_runtime::spawn(async move {
            loop {
                let need_connect = {
                    let guard = client_clone.lock().await;
                    guard.is_none()
                };

                if need_connect {
                    println!("Connecting to Supabase Database...");
                    match connect_db().await {
                        Ok(client) => {
                            println!("Successfully connected to Supabase Database!");
                            
                            // Initialize table schema
                            let init_query = "
                                CREATE TABLE IF NOT EXISTS downloads (
                                    id TEXT PRIMARY KEY,
                                    url TEXT NOT NULL,
                                    file_name TEXT NOT NULL,
                                    file_path TEXT NOT NULL,
                                    total_size BIGINT NOT NULL,
                                    downloaded BIGINT NOT NULL,
                                    status TEXT NOT NULL
                                );
                            ";
                            if let Err(e) = client.execute(init_query, &[]).await {
                                eprintln!("Failed to initialize Supabase table: {}", e);
                            } else {
                                // Load records from Supabase and merge
                                match client.query("SELECT id, url, file_name, file_path, total_size, downloaded, status FROM downloads", &[]).await {
                                    Ok(rows) => {
                                        let mut downloads_map = downloads_clone.lock().unwrap();
                                        for row in rows {
                                            let id: String = row.get(0);
                                            let url: String = row.get(1);
                                            let file_name: String = row.get(2);
                                            let file_path: String = row.get(3);
                                            let total_size: i64 = row.get(4);
                                            let downloaded: i64 = row.get(5);
                                            let status_str: String = row.get(6);

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
                                            });
                                        }

                                        // Persist merged cache locally
                                        let list: Vec<DownloadItem> = downloads_map.values().cloned().collect();
                                        if let Ok(content) = serde_json::to_string_pretty(&list) {
                                            if let Ok(mut file) = File::create(&db_path_clone) {
                                                let _ = file.write_all(content.as_bytes());
                                            }
                                        }
                                    }
                                    Err(e) => {
                                        eprintln!("Failed to load downloads from Supabase: {}", e);
                                    }
                                }
                            }
                            
                            // Set the client
                            let mut guard = client_clone.lock().await;
                            *guard = Some(client);
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
            db_client,
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

    pub fn add(&self, url: String, dest_dir: String, max_chunks: usize, custom_connections: Option<usize>, custom_filename: Option<String>, app_handle: AppHandle) -> Result<String, String> {
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

        let file_path = PathBuf::from(&dest_dir).join(&file_name);
        let id = uuid::Uuid::new_v4().to_string();

        let item = DownloadItem {
            id: id.clone(),
            url: url.clone(),
            file_name,
            file_path: file_path.to_string_lossy().to_string(),
            total_size: 0,
            downloaded: 0,
            status: DownloadStatus::Queued,
            speed: 0.0,
            eta: -1.0,
            chunks: Vec::new(),
            resumable: true,
        };

        {
            let mut downloads = self.downloads.lock().unwrap();
            downloads.insert(id.clone(), item);
        }
        self.save_downloads();
        self.sync_item_to_db(id.clone());

        self.start_task(id.clone(), max_chunks, custom_connections, custom_filename, app_handle)?;

        Ok(id)
    }

    pub fn start_task(&self, id: String, max_chunks: usize, custom_connections: Option<usize>, custom_filename: Option<String>, app_handle: AppHandle) -> Result<(), String> {
        let (url, file_path) = {
            let downloads = self.downloads.lock().unwrap();
            let item = downloads.get(&id).ok_or_else(|| "Download not found".to_string())?;
            (item.url.clone(), PathBuf::from(&item.file_path))
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
                        INSERT INTO downloads (id, url, file_name, file_path, total_size, downloaded, status)
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                        ON CONFLICT (id) DO UPDATE SET
                            downloaded = EXCLUDED.downloaded,
                            total_size = EXCLUDED.total_size,
                            status = EXCLUDED.status;
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
                        ]
                    ).await;
                }
            });
        }
    }
}
