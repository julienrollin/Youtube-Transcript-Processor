use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const LMSTUDIO_ENDPOINT: &str = "http://localhost:1234/v1";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConnectionStatus {
    pub connected: bool,
    pub model: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LLMResult {
    pub success: bool,
    pub result: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ModelsResponse {
    data: Vec<ModelInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ModelInfo {
    id: String,
}

#[derive(Debug, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    stream: bool,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessageResponse,
}

#[derive(Debug, Deserialize)]
struct ChatMessageResponse {
    content: String,
}

/// Check if LM Studio is running and get the loaded model
pub async fn check_connection() -> ConnectionStatus {
    let client = match Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(_) => {
            return ConnectionStatus {
                connected: false,
                model: None,
            }
        }
    };

    let url = format!("{}/models", LMSTUDIO_ENDPOINT);

    match client.get(&url).send().await {
        Ok(response) => {
            if response.status().is_success() {
                match response.json::<ModelsResponse>().await {
                    Ok(data) => {
                        let model = data.data.first().map(|m| m.id.clone());
                        ConnectionStatus {
                            connected: true,
                            model,
                        }
                    }
                    Err(_) => ConnectionStatus {
                        connected: true,
                        model: None,
                    },
                }
            } else {
                ConnectionStatus {
                    connected: false,
                    model: None,
                }
            }
        }
        Err(_) => ConnectionStatus {
            connected: false,
            model: None,
        },
    }
}

/// Load prompt template from file
fn load_prompt(mode: &str, resource_path: &PathBuf) -> Option<String> {
    let filename = format!("{}.txt", mode);

    // Build list of paths to try
    let mut paths_to_try: Vec<PathBuf> = vec![
        // 1. Resource path from Tauri (resource_dir/prompts/)
        resource_path.join("prompts").join(&filename),
        // 2. Development: relative to cwd
        PathBuf::from("../prompts").join(&filename),
        PathBuf::from("prompts").join(&filename),
    ];

    // 3. Paths relative to the executable (for bundled builds)
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            // Tauri bundles resources to _up_/ directory
            paths_to_try.push(exe_dir.join("_up_").join("prompts").join(&filename));
            // Or directly next to exe
            paths_to_try.push(exe_dir.join("prompts").join(&filename));
            // Or in resources folder
            paths_to_try.push(exe_dir.join("resources").join("prompts").join(&filename));
            // Or parent directory
            paths_to_try.push(exe_dir.join("..").join("prompts").join(&filename));
        }
    }

    // Try each path
    for path in &paths_to_try {
        if let Ok(content) = std::fs::read_to_string(path) {
            return Some(content);
        }
    }

    // Log debug info if not found
    eprintln!(
        "[LLM] Warning: Prompt '{}' not found in any location:",
        mode
    );
    for path in &paths_to_try {
        eprintln!("  - {} (exists: {})", path.display(), path.exists());
    }

    None
}

/// Process transcript with LLM
pub async fn process_transcript(
    transcript: &str,
    mode: &str,
    youtube_url: &str,
    resource_path: &PathBuf,
) -> LLMResult {
    // Safety check
    if transcript.trim().len() < 10 {
        return LLMResult {
            success: false,
            result: None,
            error: Some("Input transcript is too short or empty.".to_string()),
        };
    }

    let client = match Client::builder()
        .timeout(std::time::Duration::from_secs(300)) // 5 minute timeout for long transcripts
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return LLMResult {
                success: false,
                result: None,
                error: Some(format!("Failed to create HTTP client: {}", e)),
            };
        }
    };

    // Load and prepare prompt
    // Truncate transcript if too long to fit in context window
    // Assuming ~4 chars per token, 16k context, leaving 2k for prompt and response
    const MAX_TRANSCRIPT_CHARS: usize = 50000; // ~12.5k tokens

    let truncated_transcript = if transcript.len() > MAX_TRANSCRIPT_CHARS {
        // Try to truncate at a sentence boundary
        let truncated = &transcript[..MAX_TRANSCRIPT_CHARS];
        if let Some(last_period) = truncated.rfind(". ") {
            format!(
                "{}. [TRANSCRIPT TRUNCATED DUE TO LENGTH]",
                &truncated[..last_period]
            )
        } else {
            format!("{} [TRANSCRIPT TRUNCATED]", truncated)
        }
    } else {
        transcript.to_string()
    };

    let prompt = match load_prompt(mode, resource_path) {
        Some(template) => template
            .replace("{{TRANSCRIPT}}", &truncated_transcript)
            .replace("{{YOUTUBE_URL}}", youtube_url),
        None => format!(
            "Process this transcript in {} format:\n\n{}",
            mode, truncated_transcript
        ),
    };

    let request = ChatRequest {
        model: "local-model".to_string(),
        messages: vec![
            ChatMessage {
                role: "system".to_string(),
                content: "You are a direct text processing engine. You rewrite text exactly as requested. Do not chat. ALWAYS output in the same language as the input text unless explicitly told otherwise.".to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: prompt,
            },
        ],
        temperature: 0.1,
        stream: false,
    };

    let url = format!("{}/chat/completions", LMSTUDIO_ENDPOINT);

    match client.post(&url).json(&request).send().await {
        Ok(response) => {
            if !response.status().is_success() {
                let status = response.status();
                let error_text = response.text().await.unwrap_or_default();
                return LLMResult {
                    success: false,
                    result: None,
                    error: Some(format!("LLM request failed ({}): {}", status, error_text)),
                };
            }

            match response.json::<ChatResponse>().await {
                Ok(data) => {
                    if let Some(choice) = data.choices.first() {
                        let content = choice.message.content.clone();
                        if content.trim().is_empty() {
                            LLMResult {
                                success: false,
                                result: None,
                                error: Some("LLM returned empty response.".to_string()),
                            }
                        } else {
                            LLMResult {
                                success: true,
                                result: Some(content),
                                error: None,
                            }
                        }
                    } else {
                        LLMResult {
                            success: false,
                            result: None,
                            error: Some("LLM returned no choices.".to_string()),
                        }
                    }
                }
                Err(e) => LLMResult {
                    success: false,
                    result: None,
                    error: Some(format!("Failed to parse LLM response: {}", e)),
                },
            }
        }
        Err(e) => LLMResult {
            success: false,
            result: None,
            error: Some(format!("LLM request error: {}", e)),
        },
    }
}
