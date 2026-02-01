use std::process::Command;
use tauri::AppHandle;

/// Check if Python is installed and accessible
pub fn check_python_installation() -> bool {
    // Try different Python commands
    let commands = ["python", "python3", "py"];
    
    for cmd in commands {
        if Command::new(cmd).arg("--version").output().is_ok() {
            return true;
        }
    }
    false
}

/// Check if `youtube-transcript-api` is installed, and install if missing
pub fn check_and_install_dependencies(app: &AppHandle) {
    if !check_python_installation() {
        super::send_log(app, "Startup", "warning", Some("Python not found. Transcript features will be disabled."));
        return;
    }

    super::send_log(app, "Startup", "info", Some("Checking Python dependencies..."));

    // Check if package exists
    let commands = ["python", "python3", "py"];
    let mut python_cmd = "python"; // Default

    // Find working python command
    for cmd in commands {
        if Command::new(cmd).arg("--version").output().is_ok() {
            python_cmd = cmd;
            break;
        }
    }

    // Check if module is installed
    let check_status = Command::new(python_cmd)
        .args(["-c", "import youtube_transcript_api"])
        .output();

    if let Ok(output) = check_status {
        if output.status.success() {
            super::send_log(app, "Startup", "success", Some("Python dependencies ready."));
            return;
        }
    }

    // Install if missing
    super::send_log(app, "Startup", "info", Some("Installing youtube-transcript-api..."));
    
    let install_status = Command::new(python_cmd)
        .args(["-m", "pip", "install", "youtube-transcript-api"])
        .output();

    match install_status {
        Ok(output) => {
            if output.status.success() {
                super::send_log(app, "Startup", "success", Some("Parameters installed successfully."));
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                super::send_log(app, "Startup", "error", Some(&format!("Failed to install dependencies: {}", stderr)));
            }
        }
        Err(e) => {
            super::send_log(app, "Startup", "error", Some(&format!("Failed to run pip: {}", e)));
        }
    }
}
