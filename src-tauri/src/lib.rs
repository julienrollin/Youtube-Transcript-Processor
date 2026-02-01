mod youtube;
mod llm;

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

// App state for storing resource path
pub struct AppState {
    pub resource_path: Mutex<PathBuf>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LogEvent {
    pub step: String,
    pub status: String,
    pub message: Option<String>,
    pub timestamp: u64,
}

fn send_log(app: &AppHandle, step: &str, status: &str, message: Option<&str>) {
    let event = LogEvent {
        step: step.to_string(),
        status: status.to_string(),
        message: message.map(|s| s.to_string()),
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
    };
    let _ = app.emit("log-event", event);
}

#[derive(Debug, Serialize)]
pub struct TranscriptResponse {
    pub success: bool,
    #[serde(rename = "videoId")]
    pub video_id: String,
    #[serde(rename = "videoTitle")]
    pub video_title: String,
    pub transcript: String,
    pub error: Option<String>,
}

#[tauri::command]
async fn extract_transcript(
    app: AppHandle,
    url: String,
    include_timecodes: bool,
) -> Result<TranscriptResponse, String> {
    send_log(&app, "YouTube Transcript", "start", Some("Initializing..."));
    
    let result = youtube::extract_transcript(&url, include_timecodes).await;
    
    if result.success {
        send_log(
            &app,
            "Transcript Fetch",
            "done",
            Some(&format!("{} segments extracted", result.segment_count)),
        );
    } else {
        send_log(
            &app,
            "Transcript Fetch",
            "error",
            result.error.as_deref(),
        );
    }
    
    Ok(TranscriptResponse {
        success: result.success,
        video_id: result.video_id,
        video_title: result.video_title,
        transcript: result.transcript,
        error: result.error,
    })
}

#[derive(Debug, Serialize)]
pub struct LLMResponse {
    pub success: bool,
    pub result: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
async fn process_llm(
    app: AppHandle,
    state: State<'_, AppState>,
    transcript: String,
    mode: String,
    youtube_url: String,
) -> Result<LLMResponse, String> {
    send_log(&app, "LLM Processing", "start", Some(&format!("Mode: {}", mode)));
    send_log(
        &app,
        "LLM Processing",
        "info",
        Some(&format!("Input: {} characters", transcript.len())),
    );

    // Clone the resource path out of the state before async operations
    let resource_path = state.resource_path.lock().unwrap().clone();
    
    let result = llm::process_transcript(&transcript, &mode, &youtube_url, &resource_path).await;

    if result.success {
        send_log(
            &app,
            "AI Generation",
            "done",
            Some(&format!("Output: {} chars", result.result.as_ref().map(|s| s.len()).unwrap_or(0))),
        );
    } else {
        send_log(&app, "LLM Processing", "error", result.error.as_deref());
    }

    Ok(LLMResponse {
        success: result.success,
        result: result.result,
        error: result.error,
    })
}

#[derive(Debug, Serialize)]
pub struct ConnectionStatus {
    pub connected: bool,
    pub model: Option<String>,
}

#[tauri::command]
async fn check_llm_connection() -> Result<ConnectionStatus, String> {
    let status = llm::check_connection().await;
    Ok(ConnectionStatus {
        connected: status.connected,
        model: status.model,
    })
}

#[tauri::command]
async fn save_transcript(
    app: AppHandle,
    content: String,
    filename: String,
    folder: String,
) -> Result<bool, String> {
    send_log(&app, "File Save", "start", Some(&format!("Saving {}...", filename)));

    // Sanitize filename
    let re = Regex::new(r"[^a-zA-Z0-9]").unwrap();
    let safe_name = re.replace_all(&filename, "_").to_string();
    let safe_name = Regex::new(r"_+").unwrap().replace_all(&safe_name, "_").to_string();
    let safe_name = safe_name.trim_matches('_').to_lowercase();
    let safe_name = format!("{}.md", safe_name);

    let full_path = PathBuf::from(&folder).join(&safe_name);

    match fs::write(&full_path, &content) {
        Ok(_) => {
            send_log(&app, "File Save", "done", Some(&safe_name));
            Ok(true)
        }
        Err(e) => {
            send_log(&app, "File Save", "error", Some(&e.to_string()));
            Ok(false)
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Get resource path for prompts
            let resource_path = app
                .path()
                .resource_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            
            app.manage(AppState {
                resource_path: Mutex::new(resource_path),
            });
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            extract_transcript,
            process_llm,
            check_llm_connection,
            save_transcript,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
