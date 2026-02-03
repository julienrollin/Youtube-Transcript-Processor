use regex::Regex;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::error::Error;
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Create a command that doesn't show a window on Windows
fn hidden_command(cmd: &str) -> Command {
    let mut command = Command::new(cmd);
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranscriptSegment {
    pub text: String,
    pub start: f64,
    pub duration: f64,
}

#[derive(Debug, Serialize, Clone)]
pub struct TranscriptResult {
    pub success: bool,
    pub video_id: String,
    pub video_title: String,
    pub transcript: String,
    pub segment_count: usize,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PythonResult {
    success: bool,
    transcript: Option<String>,
    segments: Option<usize>,
    error: Option<String>,
}

/// Extract video ID from various YouTube URL formats
pub fn extract_video_id(url: &str) -> Option<String> {
    let patterns = [
        r"(?:v=|/)([a-zA-Z0-9_-]{11})(?:&|\?|/|$)",
        r"youtu\.be/([a-zA-Z0-9_-]{11})",
        r"embed/([a-zA-Z0-9_-]{11})",
        r"shorts/([a-zA-Z0-9_-]{11})",
    ];

    for pattern in patterns {
        if let Ok(re) = Regex::new(pattern) {
            if let Some(caps) = re.captures(url) {
                if let Some(id) = caps.get(1) {
                    return Some(id.as_str().to_string());
                }
            }
        }
    }
    None
}

/// Fetch video title from YouTube
async fn fetch_video_title(video_id: &str) -> String {
    let client = match Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(_) => return video_id.to_string(),
    };

    let url = format!("https://www.youtube.com/watch?v={}", video_id);
    
    match client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .header("Cookie", "SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg")
        .send()
        .await
    {
        Ok(response) => {
            if let Ok(html) = response.text().await {
                if let Ok(re) = Regex::new(r"<title>(.+?)</title>") {
                    if let Some(caps) = re.captures(&html) {
                        if let Some(title) = caps.get(1) {
                            let title = title.as_str()
                                .replace(" - YouTube", "")
                                .trim()
                                .to_string();
                            if !title.is_empty() && title != "YouTube" {
                                return title;
                            }
                        }
                    }
                }
            }
        }
        Err(_) => {}
    }
    video_id.to_string()
}

/// Call Python script to fetch transcript
fn fetch_transcript_python(
    video_id: &str,
    language: &str,
    include_timecodes: bool,
) -> Result<PythonResult, Box<dyn Error + Send + Sync>> {
    // Try different Python commands
    let python_commands = ["python", "python3", "py"];
    
    // Get the script path - try multiple locations
    let script_paths = [
        // Development: relative to cwd
        "scripts/fetch_transcript.py".to_string(),
        "../scripts/fetch_transcript.py".to_string(),
        // Installed: next to executable
        {
            if let Ok(exe_path) = std::env::current_exe() {
                if let Some(exe_dir) = exe_path.parent() {
                    exe_dir.join("scripts").join("fetch_transcript.py").to_string_lossy().to_string()
                } else {
                    String::new()
                }
            } else {
                String::new()
            }
        },
        // Tauri resource path: ..\\scripts (relative to exe)
        {
            if let Ok(exe_path) = std::env::current_exe() {
                if let Some(exe_dir) = exe_path.parent() {
                    exe_dir.join("..").join("scripts").join("fetch_transcript.py").to_string_lossy().to_string()
                } else {
                    String::new()
                }
            } else {
                String::new()
            }
        },
        // Tauri bundled resources on Windows: _up_\\scripts (Tauri uses _up_ for parent)
        {
            if let Ok(exe_path) = std::env::current_exe() {
                if let Some(exe_dir) = exe_path.parent() {
                    exe_dir.join("_up_").join("scripts").join("fetch_transcript.py").to_string_lossy().to_string()
                } else {
                    String::new()
                }
            } else {
                String::new()
            }
        },
        // Tauri v2 resources directory (usually next to exe in 'resources' folder)
        {
            if let Ok(exe_path) = std::env::current_exe() {
                if let Some(exe_dir) = exe_path.parent() {
                    exe_dir.join("resources").join("scripts").join("fetch_transcript.py").to_string_lossy().to_string()
                } else {
                    String::new()
                }
            } else {
                String::new()
            }
        },
    ];
    
    let script_path = script_paths.iter()
        .find(|p| !p.is_empty() && std::path::Path::new(p).exists())
        .ok_or("Could not find fetch_transcript.py script")?;
    
    let timecodes_arg = if include_timecodes { "true" } else { "false" };
    
    let mut last_error = String::from("No Python interpreter found");
    
    for python_cmd in python_commands {
        let result = hidden_command(python_cmd)
            .arg(script_path)
            .arg(video_id)
            .arg(language)
            .arg(timecodes_arg)
            .output();
        
        match result {
            Ok(output) => {
                if output.status.success() {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    match serde_json::from_str::<PythonResult>(&stdout) {
                        Ok(result) => return Ok(result),
                        Err(e) => {
                            last_error = format!("Failed to parse Python output: {} - Output: {}", e, stdout);
                        }
                    }
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    
                    // Try to parse error from stdout (script returns JSON even on errors)
                    if let Ok(result) = serde_json::from_str::<PythonResult>(&stdout) {
                        return Ok(result);
                    }
                    
                    last_error = format!("Python script failed: {}", stderr);
                }
            }
            Err(e) => {
                // Command not found, try next
                if e.kind() == std::io::ErrorKind::NotFound {
                    continue;
                }
                last_error = format!("Failed to run Python: {}", e);
            }
        }
    }
    
    Err(last_error.into())
}

/// Format timestamp
fn format_timestamp(seconds: f64) -> String {
    let mins = (seconds / 60.0) as u32;
    let secs = (seconds % 60.0) as u32;
    format!("[{:02}:{:02}]", mins, secs)
}

/// Main public function - uses Python for extraction
pub async fn extract_transcript(url: &str, include_timecodes: bool) -> TranscriptResult {
    let video_id = match extract_video_id(url) {
        Some(id) => id,
        None => {
            return TranscriptResult {
                success: false,
                video_id: String::new(),
                video_title: String::new(),
                transcript: String::new(),
                segment_count: 0,
                error: Some("Invalid YouTube URL".to_string()),
            };
        }
    };

    // Fetch video title asynchronously
    let video_title = fetch_video_title(&video_id).await;

    // Use Python script for transcript extraction (blocking call in async context)
    let python_result = tokio::task::spawn_blocking({
        let vid = video_id.clone();
        move || fetch_transcript_python(&vid, "auto", include_timecodes)
    })
    .await;

    match python_result {
        Ok(Ok(result)) => {
            if result.success {
                TranscriptResult {
                    success: true,
                    video_id,
                    video_title,
                    transcript: result.transcript.unwrap_or_default(),
                    segment_count: result.segments.unwrap_or(0),
                    error: None,
                }
            } else {
                TranscriptResult {
                    success: false,
                    video_id,
                    video_title,
                    transcript: String::new(),
                    segment_count: 0,
                    error: result.error.or(Some("Unknown error from Python".to_string())),
                }
            }
        }
        Ok(Err(e)) => TranscriptResult {
            success: false,
            video_id: video_id.clone(),
            video_title,
            transcript: String::new(),
            segment_count: 0,
            error: Some(e.to_string()),
        },
        Err(e) => TranscriptResult {
            success: false,
            video_id: video_id.clone(),
            video_title,
            transcript: String::new(),
            segment_count: 0,
            error: Some(format!("Task failed: {}", e)),
        },
    }
}

/// Format transcript segments to text (kept for compatibility)
pub fn format_transcript(segments: &[TranscriptSegment], include_timecodes: bool) -> String {
    segments
        .iter()
        .map(|seg| {
            if include_timecodes {
                format!("{} {}", format_timestamp(seg.start), seg.text)
            } else {
                seg.text.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}
