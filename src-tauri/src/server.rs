use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tower_http::cors::{Any, CorsLayer};

use crate::download::manager::DownloadManager;

#[derive(Deserialize)]
pub struct AddDownloadRequest {
    pub url: String,
    pub filename: Option<String>,
    pub referrer: Option<String>,
}

#[derive(Serialize)]
pub struct ApiResponse {
    pub success: bool,
    pub message: String,
}

type AppState = (Arc<AppHandle>, String); // (app_handle, dest_dir)

async fn handle_add(
    State((app_handle, dest_dir)): State<AppState>,
    Json(body): Json<AddDownloadRequest>,
) -> (StatusCode, Json<ApiResponse>) {
    let manager = app_handle.state::<DownloadManager>();

    // Unminimize, show, and focus main window so the user sees the active download panel (IDM style)
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }

    match manager.add(
        body.url.clone(),
        dest_dir.clone(),
        8,
        None,
        body.filename,
        (*app_handle).clone(),
    ).await {
        Ok(id) => (
            StatusCode::OK,
            Json(ApiResponse {
                success: true,
                message: format!("Download started: {}", id),
            }),
        ),
        Err(e) => {
            if e.starts_with("COLLISION:") {
                (
                    StatusCode::OK,
                    Json(ApiResponse {
                        success: true,
                        message: e,
                    }),
                )
            } else {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ApiResponse {
                        success: false,
                        message: e,
                    }),
                )
            }
        }
    }
}

async fn handle_ping() -> Json<ApiResponse> {
    Json(ApiResponse {
        success: true,
        message: "MSM Downloader is running".to_string(),
    })
}

pub fn start_local_server(app_handle: AppHandle, dest_dir: String) {
    let app_arc = Arc::new(app_handle);

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let state: AppState = (app_arc, dest_dir);

    let router = Router::new()
        .route("/ping", get(handle_ping))
        .route("/add", post(handle_add))
        .with_state(state)
        .layer(cors);

    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::bind("127.0.0.1:9999").await {
            Ok(l) => l,
            Err(e) => {
                eprintln!("MSM Server: Could not bind to port 9999: {}", e);
                return;
            }
        };
        println!("MSM Extension Server running on http://127.0.0.1:9999");
        if let Err(e) = axum::serve(listener, router).await {
            eprintln!("MSM Server error: {}", e);
        }
    });
}
