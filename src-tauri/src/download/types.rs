use serde::{Deserialize, Serialize};


#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum DownloadStatus {
    Queued,
    Downloading,
    Paused,
    Completed,
    Failed(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadItem {
    pub id: String,
    pub url: String,
    pub file_name: String,
    pub file_path: String,
    pub total_size: u64,
    pub downloaded: u64,
    pub status: DownloadStatus,
    pub speed: f64, // in bytes per second
    pub eta: f64,   // in seconds
    pub chunks: Vec<ChunkInfo>,
    #[serde(default = "default_true")]
    pub resumable: bool,
}

fn default_true() -> bool { true }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkInfo {
    pub id: usize,
    pub start: u64,
    pub end: u64,
    pub current: u64, // absolute current offset
    pub speed: f64,   // in bytes per second
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressPayload {
    pub id: String,
    pub file_name: String,
    pub file_path: String,
    pub downloaded: u64,
    pub total_size: u64,
    pub status: DownloadStatus,
    pub speed: f64,
    pub eta: f64,
    pub chunks: Vec<ChunkInfo>,
}
