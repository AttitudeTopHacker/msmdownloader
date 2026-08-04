use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc::unbounded_channel;
use tokio_util::sync::CancellationToken;
use tauri::{AppHandle, Emitter, Manager};
use futures_util::StreamExt;

use super::manager::DownloadManager;
use super::types::{DownloadStatus, ProgressPayload, ChunkInfo};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentProgress {
    pub id: usize,
    pub start: u64,
    pub end: u64,
    pub current: u64, // absolute current offset
    pub speed: f64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineState {
    pub id: String,
    pub url: String,
    pub file_path: String,
    pub total_size: u64,
    pub segments: Vec<SegmentProgress>,
}

pub struct DownloadEngineTask {
    pub id: String,
    pub url: String,
    pub file_path: PathBuf,
    pub client: reqwest::Client,
    pub app_handle: AppHandle,
    pub max_connections: usize,
    pub custom_connection_count: Option<usize>,
    pub custom_filename: Option<String>,
    pub cancel_token: CancellationToken,
}

enum SegmentEvent {
    Progress { id: usize, current: u64, delta: u64 },
    Completed { id: usize },
    Failed { id: usize, error: String },
}

struct SpeedTracker {
    history: Vec<(Instant, u64)>,
}

impl SpeedTracker {
    fn new() -> Self {
        Self { history: Vec::new() }
    }

    fn update(&mut self, total_bytes: u64) -> f64 {
        let now = Instant::now();
        self.history.push((now, total_bytes));
        
        let window = Duration::from_secs(3);
        while self.history.len() > 1 && now.duration_since(self.history[0].0) > window {
            self.history.remove(0);
        }
        
        if self.history.len() >= 2 {
            let first = &self.history[0];
            let last = &self.history[self.history.len() - 1];
            let duration = last.0.duration_since(first.0).as_secs_f64();
            if duration > 0.0 {
                return (last.1 - first.1) as f64 / duration;
            }
        }
        0.0
    }
}

impl DownloadEngineTask {
    pub fn new(
        id: String,
        url: String,
        file_path: PathBuf,
        client: reqwest::Client,
        app_handle: AppHandle,
        max_connections: usize,
        custom_connection_count: Option<usize>,
        custom_filename: Option<String>,
    ) -> Self {
        Self {
            id,
            url,
            file_path,
            client,
            app_handle,
            max_connections,
            custom_connection_count,
            custom_filename,
            cancel_token: CancellationToken::new(),
        }
    }

    fn get_state_path(&self) -> PathBuf {
        let mut path = self.app_handle
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."));
        path.push(format!("{}.state.json", self.id));
        path
    }

    fn save_state(&self, segments: &[SegmentProgress], total_size: u64, file_path: &Path) {
        let state = EngineState {
            id: self.id.clone(),
            url: self.url.clone(),
            file_path: file_path.to_string_lossy().to_string(),
            total_size,
            segments: segments.to_vec(),
        };
        let path = self.get_state_path();
        if let Ok(content) = serde_json::to_string_pretty(&state) {
            if let Ok(mut file) = File::create(&path) {
                let _ = file.write_all(content.as_bytes());
            }
        }
    }

    fn load_state(&self) -> Option<EngineState> {
        let path = self.get_state_path();
        if !path.exists() {
            return None;
        }
        let mut file = File::open(&path).ok()?;
        let mut content = String::new();
        file.read_to_string(&mut content).ok()?;
        serde_json::from_str(&content).ok()
    }

    fn delete_state(&self) {
        let path = self.get_state_path();
        if path.exists() {
            let _ = std::fs::remove_file(path);
        }
    }

    pub async fn execute(self) -> Result<(), String> {
        self.emit_state(DownloadStatus::Downloading).await;

        let client = self.client.clone();
        let state_path = self.get_state_path();
        let mut file_path = self.file_path.clone();
        
        let mut total_size = 0;
        let mut supports_ranges = false;
        let mut final_url = self.url.clone();
        let mut segments = Vec::new();

        // Check if state file and local file both exist to resume
        let is_resuming = file_path.exists() && state_path.exists();
        let loaded_state = if is_resuming { self.load_state() } else { None };

        if let Some(state) = loaded_state {
            total_size = state.total_size;
            supports_ranges = state.segments.len() > 1 || (state.total_size > 0);
            segments = state.segments;
            file_path = PathBuf::from(state.file_path);
            
            // Resolve final URL (just in case CDN redirects expired)
            match client.get(&self.url).send().await {
                Ok(res) => {
                    if res.status().is_success() {
                        final_url = res.url().to_string();
                    }
                }
                _ => {}
            }
            println!("Resuming download task {} from state file.", self.id);
        } else {
            // Fresh download redirect & size probing
            let mut server_filename = None;
            match client.get(&self.url).send().await {
                Ok(res) => {
                    if res.status().is_success() {
                        final_url = res.url().to_string();
                        
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
                                    if !segment.is_empty() && segment != file_path.file_name().unwrap_or_default().to_string_lossy() {
                                        server_filename = Some(percent_encoding::percent_decode_str(segment).decode_utf8_lossy().to_string());
                                    }
                                }
                            }
                        }
                        
                        if let Some(accept) = res.headers().get(reqwest::header::ACCEPT_RANGES) {
                            if let Ok(accept_str) = accept.to_str() {
                                if accept_str == "bytes" {
                                    supports_ranges = true;
                                }
                            }
                        }
                        
                        if let Some(len) = res.headers().get(reqwest::header::CONTENT_LENGTH) {
                            if let Ok(len_str) = len.to_str() {
                                if let Ok(parsed_len) = len_str.parse::<u64>() {
                                    total_size = parsed_len;
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    self.emit_error(format!("Connection failed: {}", e)).await;
                    return Err(e.to_string());
                }
            }

            let is_temp_name = self.custom_filename.as_ref()
                .map(|name| !name.contains('.') || name.chars().all(|c| c.is_ascii_hexdigit()))
                .unwrap_or(true);

            if is_temp_name {
                if let Some(filename) = server_filename {
                    if let Some(parent) = file_path.parent() {
                        let mut final_filename = filename.clone();
                        let mut new_file_path = parent.join(&final_filename);

                        let manager = self.app_handle.state::<DownloadManager>();
                        let path_collides = |path: &Path| -> bool {
                            if path.exists() {
                                return true;
                            }
                            let downloads = manager.downloads.lock().unwrap();
                            downloads.values().any(|item| {
                                item.id != self.id && Path::new(&item.file_path) == path
                            })
                        };

                        if path_collides(&new_file_path) {
                            let stem = Path::new(&filename).file_stem()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .to_string();
                            let ext = Path::new(&filename).extension()
                                .map(|e| format!(".{}", e.to_string_lossy()))
                                .unwrap_or_default();
                            
                            let mut counter = 1;
                            loop {
                                let candidate_name = format!("{} ({}){}", stem, counter, ext);
                                let candidate_path = parent.join(&candidate_name);
                                if !path_collides(&candidate_path) {
                                    new_file_path = candidate_path;
                                    final_filename = candidate_name;
                                    break;
                                }
                                counter += 1;
                            }
                        }

                        if new_file_path != file_path {
                            file_path = new_file_path;
                            
                            // Update manager state so that UI displays the correct filename
                            {
                                let mut downloads = manager.downloads.lock().unwrap();
                                if let Some(item) = downloads.get_mut(&self.id) {
                                    item.file_name = final_filename;
                                    item.file_path = file_path.to_string_lossy().to_string();
                                }
                            }
                            manager.save_downloads();
                            manager.sync_item_to_db(self.id.clone());
                        }
                    }
                }
            }

            // Probe range request support explicitly if Accept-Ranges header was omitted
            if !supports_ranges && total_size > 0 {
                match client.get(&final_url).header(reqwest::header::RANGE, "bytes=0-0").send().await {
                    Ok(res) => {
                        if res.status() == reqwest::StatusCode::PARTIAL_CONTENT {
                            supports_ranges = true;
                        }
                    }
                    _ => {}
                }
            }
        }

        // Prepare destination folder
        if let Some(parent) = file_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        // Fallback for single stream
        if total_size == 0 || !supports_ranges {
            return self.execute_fallback(file_path).await;
        }

        // Pre-allocate target space
        let file = match std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .open(&file_path)
        {
            Ok(f) => f,
            Err(e) => {
                let err = format!("Failed to create download file: {}", e);
                self.emit_error(err.clone()).await;
                return Err(err);
            }
        };

        if let Err(e) = file.set_len(total_size) {
            let err = format!("Pre-allocation failed: {}", e);
            self.emit_error(err.clone()).await;
            return Err(err);
        }
        drop(file); // Close template descriptor; tasks open their own handles

        // 3. Segment division if not resuming
        if segments.is_empty() {
            let num_segments = if let Some(custom_count) = self.custom_connection_count {
                custom_count
            } else {
                let min_chunk = 1024 * 1024; // 1 MB
                self.max_connections.min((total_size as usize / min_chunk).max(1))
            };
            let chunk_size = total_size / num_segments as u64;
            for i in 0..num_segments {
                let start = i as u64 * chunk_size;
                let end = if i == num_segments - 1 {
                    total_size - 1
                } else {
                    (i + 1) as u64 * chunk_size - 1
                };
                segments.push(SegmentProgress {
                    id: i,
                    start,
                    end,
                    current: start,
                    speed: 0.0,
                    status: "Queued".to_string(),
                });
            }
        }

        let (progress_tx, mut progress_rx) = unbounded_channel();

        // 4. Spawn segment tasks with cancel handles
        let mut active_tokens = Vec::new();
        for segment in &segments {
            if segment.current > segment.end {
                active_tokens.push(None);
                continue;
            }

            let token = self.cancel_token.child_token();
            let segment_id = segment.id;
            let start = segment.start;
            let current = segment.current;
            let end = segment.end;
            let url = final_url.clone();
            let f_path = file_path.clone();
            let client = client.clone();
            let tx = progress_tx.clone();

            let token_clone = token.clone();
            tokio::spawn(async move {
                Self::run_segment(segment_id, url, f_path, client, start, current, end, tx, token_clone).await;
            });

            active_tokens.push(Some(token));
        }

        let mut speed_tracker = SpeedTracker::new();
        let mut last_emit = Instant::now();
        let mut completed_segments = 0;

        for segment in &segments {
            if segment.current > segment.end {
                completed_segments += 1;
            }
        }

        while completed_segments < segments.len() {
            tokio::select! {
                _ = self.cancel_token.cancelled() => {
                    self.save_state(&segments, total_size, &file_path);
                    self.emit_state(DownloadStatus::Paused).await;
                    return Ok(());
                }
                event_opt = progress_rx.recv() => {
                    let event = match event_opt {
                        Some(e) => e,
                        None => break,
                    };
                    
                    match event {
                        SegmentEvent::Progress { id, current, delta: _ } => {
                            if let Some(s) = segments.iter_mut().find(|s| s.id == id) {
                                s.current = s.start + current;
                                s.status = "Receiving data...".to_string();
                            }

                            let total_downloaded: u64 = segments.iter().map(|s| s.current - s.start).sum();
                            let speed = speed_tracker.update(total_downloaded);
                            let eta = if speed > 0.0 {
                                (total_size - total_downloaded) as f64 / speed
                            } else {
                                -1.0
                            };

                            // Update manager state directly
                            let manager = self.app_handle.state::<DownloadManager>();
                            {
                                let mut downloads = manager.downloads.lock().unwrap();
                                if let Some(item) = downloads.get_mut(&self.id) {
                                    item.downloaded = total_downloaded;
                                    item.total_size = total_size;
                                    item.speed = speed;
                                    item.eta = eta;
                                    item.chunks = segments.iter().map(|s| ChunkInfo {
                                        id: s.id,
                                        start: s.start,
                                        end: s.end,
                                        current: s.current,
                                        speed: speed / segments.len() as f64,
                                    }).collect();
                                    item.status = DownloadStatus::Downloading;
                                }
                            }

                            if last_emit.elapsed().as_millis() >= 250 {
                                last_emit = Instant::now();
                                
                                // Save state periodically for crash resilience
                                self.save_state(&segments, total_size, &file_path);

                                self.emit_progress(ProgressPayload {
                                    id: self.id.clone(),
                                    file_name: file_path.file_name().unwrap().to_string_lossy().to_string(),
                                    file_path: file_path.to_string_lossy().to_string(),
                                    downloaded: total_downloaded,
                                    total_size,
                                    status: DownloadStatus::Downloading,
                                    speed,
                                    eta,
                                    chunks: segments.iter().map(|s| ChunkInfo {
                                        id: s.id,
                                        start: s.start,
                                        end: s.end,
                                        current: s.current,
                                        speed: speed / segments.len() as f64,
                                    }).collect(),
                                }).await;
                            }
                        }
                        SegmentEvent::Completed { id } => {
                            completed_segments += 1;
                            if let Some(s) = segments.iter_mut().find(|s| s.id == id) {
                                s.current = s.end + 1;
                                s.status = "Completed".to_string();
                            }
                            self.save_state(&segments, total_size, &file_path);
                        }
                        SegmentEvent::Failed { id: _, error } => {
                            self.cancel_token.cancel();
                            self.save_state(&segments, total_size, &file_path);
                            self.emit_state(DownloadStatus::Failed(error.clone())).await;
                            return Err(error);
                        }
                    }
                }
            }
        }

        // Clean up state file on successful download completion
        self.delete_state();

        let total_downloaded: u64 = segments.iter().map(|s| s.current - s.start).sum();
        let manager = self.app_handle.state::<DownloadManager>();
        {
            let mut downloads = manager.downloads.lock().unwrap();
            if let Some(item) = downloads.get_mut(&self.id) {
                item.downloaded = total_downloaded;
                item.chunks = segments.iter().map(|s| ChunkInfo {
                    id: s.id,
                    start: s.start,
                    end: s.end,
                    current: s.current,
                    speed: 0.0,
                }).collect();
            }
        }

        self.emit_progress(ProgressPayload {
            id: self.id.clone(),
            file_name: file_path.file_name().unwrap().to_string_lossy().to_string(),
            file_path: file_path.to_string_lossy().to_string(),
            downloaded: total_downloaded,
            total_size,
            status: DownloadStatus::Completed,
            speed: 0.0,
            eta: 0.0,
            chunks: segments.iter().map(|s| ChunkInfo {
                id: s.id,
                start: s.start,
                end: s.end,
                current: s.current,
                speed: 0.0,
            }).collect(),
        }).await;
        
        self.emit_state(DownloadStatus::Completed).await;
        Ok(())
    }

    async fn run_segment(
        id: usize,
        url: String,
        file_path: PathBuf,
        client: reqwest::Client,
        start: u64,
        current: u64,
        end: u64,
        progress_tx: tokio::sync::mpsc::UnboundedSender<SegmentEvent>,
        cancel_token: CancellationToken,
    ) {
        let resume_start = current; // absolute start position
        if resume_start > end {
            let _ = progress_tx.send(SegmentEvent::Completed { id });
            return;
        }

        // Exponential backoff retry loop
        let mut delay = Duration::from_secs(1);
        let max_attempts = 4;
        
        for attempt in 1..=max_attempts {
            if cancel_token.is_cancelled() {
                return;
            }

            match Self::download_segment_stream(
                id,
                &url,
                &file_path,
                &client,
                start,
                resume_start,
                end,
                &progress_tx,
                &cancel_token,
            ).await {
                Ok(_) => {
                    let _ = progress_tx.send(SegmentEvent::Completed { id });
                    return;
                }
                Err(e) => {
                    eprintln!("Segment {} download failed (attempt {}/{}): {}", id, attempt, max_attempts, e);
                    if e.contains("deleted") || attempt == max_attempts {
                        let _ = progress_tx.send(SegmentEvent::Failed { id, error: e });
                        return;
                    }
                    // Sleep with backoff
                    tokio::select! {
                        _ = cancel_token.cancelled() => return,
                        _ = tokio::time::sleep(delay) => {
                            delay *= 2;
                        }
                    }
                }
            }
        }
    }

    async fn download_segment_stream(
        id: usize,
        url: &str,
        file_path: &Path,
        client: &reqwest::Client,
        start: u64,
        resume_start: u64,
        end: u64,
        progress_tx: &tokio::sync::mpsc::UnboundedSender<SegmentEvent>,
        cancel_token: &CancellationToken,
    ) -> Result<(), String> {
        let range_header = format!("bytes={}-{}", resume_start, end);
        let res = client
            .get(url)
            .header(reqwest::header::RANGE, range_header)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !res.status().is_success() {
            return Err(format!("Server returned error code: {}", res.status()));
        }

        // Open direct separate file handle per task to allow concurrent positional seeking & writes
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .open(file_path)
            .map_err(|e| format!("Failed to open write file handle: {}", e))?;

        let mut stream = res.bytes_stream();
        let mut write_pos = resume_start;
        let mut buffer = Vec::with_capacity(128 * 1024); // 128 KB write buffer
        let mut last_existence_check = Instant::now();

        while let Some(chunk_result) = stream.next().await {
            if cancel_token.is_cancelled() {
                return Ok(());
            }

            if last_existence_check.elapsed().as_secs() >= 1 {
                last_existence_check = Instant::now();
                if !file_path.exists() {
                    return Err("File manually deleted from disk".to_string());
                }
            }

            let bytes = chunk_result.map_err(|e| e.to_string())?;
            if bytes.is_empty() {
                continue;
            }

            buffer.extend_from_slice(&bytes);

            // Flush buffer if it exceeds 128 KB
            if buffer.len() >= 128 * 1024 {
                let len = buffer.len();
                file.seek(SeekFrom::Start(write_pos))
                    .map_err(|e| format!("Seek failed: {}", e))?;
                file.write_all(&buffer)
                    .map_err(|e| format!("Write failed: {}", e))?;

                write_pos += len as u64;
                buffer.clear();

                let current_downloaded = write_pos - start;
                let _ = progress_tx.send(SegmentEvent::Progress {
                    id,
                    current: current_downloaded,
                    delta: len as u64,
                });
            }
        }

        // Flush remaining buffer content
        if !buffer.is_empty() && !cancel_token.is_cancelled() {
            let len = buffer.len();
            file.seek(SeekFrom::Start(write_pos))
                .map_err(|e| format!("Seek failed: {}", e))?;
            file.write_all(&buffer)
                .map_err(|e| format!("Write failed: {}", e))?;

            write_pos += len as u64;
            let current_downloaded = write_pos - start;
            let _ = progress_tx.send(SegmentEvent::Progress {
                id,
                current: current_downloaded,
                delta: len as u64,
            });
        }

        Ok(())
    }

    async fn execute_fallback(self, file_path: PathBuf) -> Result<(), String> {
        let client = self.client.clone();

        // Mark this download as non-resumable immediately so UI can show correct state
        {
            let manager = self.app_handle.state::<DownloadManager>();
            let mut downloads = manager.downloads.lock().unwrap();
            if let Some(item) = downloads.get_mut(&self.id) {
                item.resumable = false;
            }
        }
        
        let response = match client.get(&self.url).send().await {
            Ok(res) => {
                if !res.status().is_success() {
                    let err = format!("Server returned status: {}", res.status());
                    self.emit_error(err.clone()).await;
                    return Err(err);
                }
                res
            }
            Err(e) => {
                self.emit_error(e.to_string()).await;
                return Err(e.to_string());
            }
        };

        let total_size = response.content_length().unwrap_or(0);

        // Always create fresh — non-resumable files must restart from byte 0
        let mut file = match std::fs::File::create(&file_path) {
            Ok(f) => f,
            Err(e) => {
                let err = format!("Failed to create file: {}", e);
                self.emit_error(err.clone()).await;
                return Err(err);
            }
        };

        let mut stream = response.bytes_stream();
        let mut downloaded: u64 = 0;
        let mut speed_tracker = SpeedTracker::new();
        let mut last_emit = Instant::now();
        // 128 KB write buffer for efficiency
        let mut write_buf: Vec<u8> = Vec::with_capacity(128 * 1024);

        let mut last_existence_check = Instant::now();

        while let Some(chunk_result) = stream.next().await {
            if self.cancel_token.is_cancelled() {
                // Non-resumable: drop partial file from disk — it's useless
                drop(file);
                let _ = std::fs::remove_file(&file_path);
                self.emit_state(DownloadStatus::Paused).await;
                return Ok(());
            }

            if last_existence_check.elapsed().as_secs() >= 1 {
                last_existence_check = Instant::now();
                if !file_path.exists() {
                    let err = "File manually deleted from disk".to_string();
                    self.emit_error(err.clone()).await;
                    return Err(err);
                }
            }

            match chunk_result {
                Ok(bytes) => {
                    write_buf.extend_from_slice(&bytes);
                    downloaded += bytes.len() as u64;

                    // Flush buffer when it reaches 128 KB
                    if write_buf.len() >= 128 * 1024 {
                        if let Err(e) = file.write_all(&write_buf) {
                            let err = format!("Write error: {}", e);
                            self.emit_error(err.clone()).await;
                            return Err(err);
                        }
                        write_buf.clear();
                    }

                    let speed = speed_tracker.update(downloaded);
                    let eta = if speed > 0.0 && total_size > 0 {
                        (total_size - downloaded) as f64 / speed
                    } else {
                        -1.0
                    };

                    let manager = self.app_handle.state::<DownloadManager>();
                    {
                        let mut downloads = manager.downloads.lock().unwrap();
                        if let Some(item) = downloads.get_mut(&self.id) {
                            item.downloaded = downloaded;
                            item.total_size = total_size;
                            item.speed = speed;
                            item.eta = eta;
                            item.status = DownloadStatus::Downloading;
                            item.chunks = vec![ChunkInfo {
                                id: 0,
                                start: 0,
                                end: total_size,
                                current: downloaded,
                                speed,
                            }];
                        }
                    }

                    if last_emit.elapsed().as_millis() >= 250 {
                        last_emit = Instant::now();
                        self.emit_progress(ProgressPayload {
                            id: self.id.clone(),
                            file_name: file_path.file_name().unwrap().to_string_lossy().to_string(),
                            file_path: file_path.to_string_lossy().to_string(),
                            downloaded,
                            total_size,
                            status: DownloadStatus::Downloading,
                            speed,
                            eta,
                            chunks: vec![ChunkInfo {
                                id: 0,
                                start: 0,
                                end: total_size,
                                current: downloaded,
                                speed,
                            }],
                        }).await;
                    }
                }
                Err(e) => {
                    // On network error: drop partial file
                    drop(file);
                    let _ = std::fs::remove_file(&file_path);
                    self.emit_error(e.to_string()).await;
                    return Err(e.to_string());
                }
            }
        }

        // Flush remaining buffer
        if !write_buf.is_empty() {
            if let Err(e) = file.write_all(&write_buf) {
                let err = format!("Final write error: {}", e);
                self.emit_error(err.clone()).await;
                return Err(err);
            }
        }

        let manager = self.app_handle.state::<DownloadManager>();
        {
            let mut downloads = manager.downloads.lock().unwrap();
            if let Some(item) = downloads.get_mut(&self.id) {
                item.downloaded = downloaded;
                item.chunks = vec![ChunkInfo {
                    id: 0,
                    start: 0,
                    end: total_size,
                    current: downloaded,
                    speed: 0.0,
                }];
            }
        }

        self.emit_progress(ProgressPayload {
            id: self.id.clone(),
            file_name: file_path.file_name().unwrap().to_string_lossy().to_string(),
            file_path: file_path.to_string_lossy().to_string(),
            downloaded,
            total_size,
            status: DownloadStatus::Completed,
            speed: 0.0,
            eta: 0.0,
            chunks: vec![ChunkInfo {
                id: 0,
                start: 0,
                end: total_size,
                current: downloaded,
                speed: 0.0,
            }],
        }).await;
        self.emit_state(DownloadStatus::Completed).await;
        Ok(())
    }

    async fn emit_state(&self, status: DownloadStatus) {
        let manager = self.app_handle.state::<DownloadManager>();
        {
            let mut downloads = manager.downloads.lock().unwrap();
            if let Some(item) = downloads.get_mut(&self.id) {
                item.status = status.clone();
                if matches!(status, DownloadStatus::Completed | DownloadStatus::Failed(_) | DownloadStatus::Paused) {
                    item.speed = 0.0;
                    item.eta = -1.0;
                }
            }
        }
        manager.save_downloads();
        manager.sync_item_to_db(self.id.clone());

        let _ = self.app_handle.emit(&format!("download-state:{}", self.id), status);
        let _ = self.app_handle.emit("download-state-global", (self.id.clone(),));
    }

    async fn emit_error(&self, error: String) {
        self.emit_state(DownloadStatus::Failed(error)).await;
    }

    async fn emit_progress(&self, progress: ProgressPayload) {
        let _ = self.app_handle.emit(&format!("download-progress:{}", self.id), progress);
        let _ = self.app_handle.emit("download-progress-global", (self.id.clone(),));
    }
}

fn parse_content_disposition(header_val: &str) -> Option<String> {
    if let Some(idx) = header_val.find("filename*=") {
        let remainder = &header_val[idx + 10..];
        let parts: Vec<&str> = remainder.split(';').collect();
        let val = parts[0].trim();
        let val_parts: Vec<&str> = val.split("''").collect();
        if val_parts.len() == 2 {
            if let Ok(decoded) = percent_encoding::percent_decode_str(val_parts[1]).decode_utf8() {
                return Some(decoded.to_string());
            }
        }
    }
    if let Some(idx) = header_val.find("filename=") {
        let remainder = &header_val[idx + 9..];
        let parts: Vec<&str> = remainder.split(';').collect();
        let val = parts[0].trim().trim_matches('"').trim_matches('\'');
        if !val.is_empty() {
            return Some(val.to_string());
        }
    }
    None
}
