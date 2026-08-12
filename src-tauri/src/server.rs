use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    response::Html,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Manager, Emitter};
use tower_http::cors::{Any, CorsLayer};
use base64::{prelude::BASE64_URL_SAFE_NO_PAD, Engine};

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
    pub download_dir: Option<String>,
}

#[derive(Deserialize)]
pub struct AuthTokenRequest {
    pub access_token: String,
    pub refresh_token: Option<String>,
}

type AppState = (Arc<AppHandle>, String); // (app_handle, initial_dest_dir)

fn decode_jwt_payload(token: &str) -> Option<serde_json::Value> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    
    let payload_encoded = parts[1];
    let payload_bytes = BASE64_URL_SAFE_NO_PAD.decode(payload_encoded).ok()?;
    let payload_str = String::from_utf8(payload_bytes).ok()?;
    serde_json::from_str(&payload_str).ok()
}

async fn handle_add(
    State((app_handle, _)): State<AppState>,
    Json(body): Json<AddDownloadRequest>,
) -> (StatusCode, Json<ApiResponse>) {
    let manager = app_handle.state::<DownloadManager>();

    // Retrieve dynamic destination directory set by user
    let dest_dir = {
        let dir_guard = manager.download_dir.lock().unwrap();
        dir_guard.clone()
    };

    // Retrieve active user email
    let user_email = {
        let user_guard = manager.active_user_email.lock().unwrap();
        user_guard.clone()
    };

    // Unminimize, show, and focus main window so the user sees the active download panel (IDM style)
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }

    match manager.add(
        body.url.clone(),
        dest_dir,
        8,
        None,
        body.filename,
        body.referrer,
        user_email,
        (*app_handle).clone(),
    ).await {
        Ok(id) => (
            StatusCode::OK,
            Json(ApiResponse {
                success: true,
                message: format!("Download started: {}", id),
                download_dir: None,
            }),
        ),
        Err(e) => {
            if e.starts_with("COLLISION:") {
                (
                    StatusCode::OK,
                    Json(ApiResponse {
                        success: true,
                        message: e,
                        download_dir: None,
                    }),
                )
            } else {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ApiResponse {
                        success: false,
                        message: e,
                        download_dir: None,
                    }),
                )
            }
        }
    }
}

async fn handle_ping(
    State((app_handle, _)): State<AppState>,
) -> Json<ApiResponse> {
    let manager = app_handle.state::<DownloadManager>();
    let dir = {
        let dir_guard = manager.download_dir.lock().unwrap();
        dir_guard.clone()
    };
    Json(ApiResponse {
        success: true,
        message: "MSM Downloader is running".to_string(),
        download_dir: Some(dir),
    })
}

const AUTH_CALLBACK_HTML: &str = r##"
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>MSM Downloader Authentication</title>
  <style>
    body {
      background-color: #0f0f13;
      color: #ffffff;
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .card {
      background-color: #14141a;
      border: 1px solid #222;
      padding: 30px;
      border-radius: 12px;
      text-align: center;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      max-width: 400px;
    }
    .spinner {
      border: 4px solid rgba(255,255,255,0.1);
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border-left-color: #6366f1;
      animation: spin 1s linear infinite;
      margin: 20px auto;
    }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <h2>Connecting...</h2>
    <div class="spinner"></div>
    <p>Please wait while we complete the sign-in. You can close this tab afterwards.</p>
  </div>
  <script>
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.replace("#", "?"));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    
    const queryParams = new URLSearchParams(window.location.search);
    const error = queryParams.get("error") || queryParams.get("error_description");

    if (error) {
      document.querySelector("h2").textContent = "Authentication Failed";
      document.querySelector("p").textContent = error;
      document.querySelector(".spinner").style.display = "none";
    } else if (accessToken) {
      fetch("/auth-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken })
      })
      .then(res => {
        if (res.ok) {
          document.querySelector("h2").textContent = "Success!";
          document.querySelector("p").textContent = "You have authenticated successfully. You can close this tab.";
          document.querySelector(".spinner").style.display = "none";
        } else {
          throw new Error("Failed to send session token to the app.");
        }
      })
      .catch(err => {
        document.querySelector("h2").textContent = "Error";
        document.querySelector("p").textContent = err.message;
        document.querySelector(".spinner").style.display = "none";
      });
    } else {
      document.querySelector("h2").textContent = "Link Expired";
      document.querySelector("p").textContent = "No valid authentication session found.";
      document.querySelector(".spinner").style.display = "none";
    }
  </script>
</body>
</html>
"##;

async fn handle_auth_callback() -> Html<&'static str> {
    Html(AUTH_CALLBACK_HTML)
}

async fn handle_auth_token(
    State((app_handle, _)): State<AppState>,
    Json(body): Json<AuthTokenRequest>,
) -> (StatusCode, Json<ApiResponse>) {
    if let Some(payload) = decode_jwt_payload(&body.access_token) {
        if let Some(email) = payload["email"].as_str() {
            let email_str = email.to_string();
            let name = payload["user_metadata"]["full_name"]
                .as_str()
                .or_else(|| payload["user_metadata"]["name"].as_str())
                .unwrap_or_else(|| email_str.split('@').next().unwrap_or("User"))
                .to_string();
            
            let profile_pic = payload["user_metadata"]["avatar_url"]
                .as_str()
                .or_else(|| payload["user_metadata"]["picture"].as_str())
                .unwrap_or("")
                .to_string();

            // Set active user in DownloadManager
            let manager = app_handle.state::<DownloadManager>();
            manager.set_active_user(Some(email_str.clone())).await;

            // Emit session to frontend React app
            #[derive(serde::Serialize, Clone)]
            struct AuthSessionPayload {
                email: String,
                name: String,
                profile_pic: String,
                access_token: String,
            }
            let session_payload = AuthSessionPayload {
                email: email_str.clone(),
                name,
                profile_pic,
                access_token: body.access_token,
            };
            let _ = app_handle.emit("auth-session-received", session_payload);

            // Focus Tauri Window so it brings the app to foreground
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }

            return (
                StatusCode::OK,
                Json(ApiResponse {
                    success: true,
                    message: "Session authenticated successfully".to_string(),
                    download_dir: None,
                })
            );
        }
    }

    (
        StatusCode::BAD_REQUEST,
        Json(ApiResponse {
            success: false,
            message: "Invalid token payload".to_string(),
            download_dir: None,
        })
    )
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
        .route("/auth-callback", get(handle_auth_callback))
        .route("/auth-token", post(handle_auth_token))
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
