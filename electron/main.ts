import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import OpenAI from 'openai';
import fs from 'fs';
import { spawn, exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

let mainWindow: BrowserWindow | null = null;
const LMSTUDIO_ENDPOINT = 'http://localhost:1234/v1';

// Helper to send log to renderer
function sendLog(step: string, status: 'start' | 'done' | 'error' | 'info', message?: string) {
    if (mainWindow) {
        mainWindow.webContents.send('log-event', { step, status, message, timestamp: Date.now() });
    }
    console.log(`[${status.toUpperCase()}] ${step}${message ? ': ' + message : ''}`);
}

// --- Services ---

// 1. YouTube Service using Python (Most Robust)
async function getTranscript(url: string) {
    sendLog('YouTube Transcript', 'start', 'Initializing Python bridge...');

    // Extract video ID (simple regex)
    const videoIdMatch = url.match(/(?:v=|\/|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:\&|\?|\/|$)/);
    if (!videoIdMatch) {
        sendLog('YouTube Transcript', 'error', 'Invalid URL format');
        throw new Error("Invalid YouTube URL format");
    }
    const videoId = videoIdMatch[1];
    sendLog('YouTube Transcript', 'info', `Video ID: ${videoId}`);

    return new Promise((resolve) => {
        // Path to python script
        // In dev: ROOT/electron/main.ts -> ROOT/scripts/fetch_transcript.py
        // In prod: RESOURCES/app.asar/dist-electron/main.js -> RESOURCES/scripts/fetch_transcript.py

        let scriptPath = path.join(__dirname, '../scripts/fetch_transcript.py');
        if (app.isPackaged) {
            // If packaged, scripts should be in resources
            scriptPath = path.join(process.resourcesPath, 'scripts/fetch_transcript.py');
        }

        sendLog('Transcript Fetch', 'start', 'Spawning Python process...');
        console.log("Script Path:", scriptPath);

        const pythonProcess = spawn('python', [scriptPath, videoId]);

        let dataString = '';
        let errorString = '';

        pythonProcess.stdout.on('data', (data) => {
            dataString += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            errorString += data.toString();
        });

        pythonProcess.on('close', async (code) => {
            if (code !== 0) {
                console.error('Python Error:', errorString);
                // Try to parse error if it's JSON
                try {
                    const errorJson = JSON.parse(dataString);
                    if (errorJson.error) {
                        sendLog('Transcript Fetch', 'error', errorJson.error);
                        resolve({ success: false, error: errorJson.error });
                        return;
                    }
                } catch (e) { }

                sendLog('Transcript Fetch', 'error', `Python exited with code ${code}`);
                resolve({ success: false, error: "Failed to fetch transcript (Python Error). See logs." });
                return;
            }

            try {
                // Parse JSON output from Python
                const result = JSON.parse(dataString);

                if (result.success) {
                    sendLog('Transcript Fetch', 'done', `${result.segments} segments extracted`);

                    // Fetch video title for better filename
                    let videoTitle = videoId;
                    try {
                        sendLog('Video Info', 'start', 'Fetching title...');
                        const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
                        const html = await response.text();
                        const titleMatch = html.match(/<title>(.+?)<\/title>/);
                        if (titleMatch) {
                            videoTitle = titleMatch[1].replace(' - YouTube', '').trim();
                        }
                    } catch (e) {
                        // Ignore error, fallback to ID
                    }

                    resolve({
                        success: true,
                        videoId: videoId,
                        videoTitle: videoTitle,
                        transcript: result.transcript,
                        segmentCount: result.segments
                    });
                } else {
                    sendLog('Transcript Fetch', 'error', result.error);
                    resolve({ success: false, error: result.error });
                }
            } catch (e) {
                console.error('JSON Parse Error:', e);
                console.log('Raw output:', dataString);
                sendLog('Transcript Fetch', 'error', 'Failed to parse Python output');
                resolve({ success: false, error: "Invalid response from Python script." });
            }
        });
    });
}

// 2. LLM Service
async function processLLM(transcript: string, mode: string, customPrompt?: string) {
    sendLog('LLM Processing', 'start', `Mode: ${mode}`);

    // Safety check just in case
    if (!transcript || transcript.trim().length < 10) {
        sendLog('LLM Processing', 'error', 'Input too short');
        return { success: false, error: "Input transcript is too short or empty." };
    }

    sendLog('LLM Processing', 'info', `Input: ${transcript.length} characters`);

    try {
        const client = new OpenAI({
            baseURL: LMSTUDIO_ENDPOINT,
            apiKey: 'lm-studio'
        });

        // Simplified, Direct Instruction Prompts
        const prompts: Record<string, string> = {
            clean: `Task: Clean the following transcript.
Instructions:
- Remove filler words (um, uh, like, you know).
- Fix punctuation and capitalization.
- Merge broken sentences.
- Do NOT output anything else. Just the cleaned text.

Transcript:
${transcript}`,

            structured: `Task: Structure this transcript with Markdown.
Instructions:
- Add ## Headers for main topics.
- Use - Bullet points for lists.
- Fix grammar.

Transcript:
${transcript}`,

            summary: `Task: Summarize this transcript.
Instructions:
- Write a 2-3 sentence overview.
- List 3-5 Key Takeaways.
- Extract 1 meaningful quote.

Transcript:
${transcript}`,

            markdown: `Task: Convert this to a detailed Markdown document.
Instructions:
- Use H1 for Title, H2 for Sections.
- Preserve ALL details, numbers, and technical terms.
- Fix flow and grammar.

Transcript:
${transcript}`,

            json: `Task: Convert to JSON.
Format: { "title": "...", "content": "..." }

Transcript:
${transcript}`
        };

        const prompt = customPrompt || prompts[mode] || prompts['clean'];

        // LM Studio auto-routes "local-model" to whatever is loaded
        const modelId = "local-model";
        sendLog('AI Generation', 'start', 'Processing transcript...');

        const completion = await client.chat.completions.create({
            model: modelId,
            messages: [
                { role: "system", content: "You are a direct text processing engine. You rewrite text exactly as requested. Do not chat." },
                { role: "user", content: prompt }
            ],
            temperature: 0.1,
            stream: false
        });

        const content = completion.choices[0]?.message?.content;

        if (!content) {
            sendLog('AI Generation', 'error', 'Empty response');
            throw new Error("LLM returned empty response. Please check LM Studio logs.");
        }

        sendLog('AI Generation', 'done', `Output: ${content.length} chars`);
        return { success: true, result: content };

    } catch (error: any) {
        console.error("LLM Error:", error);
        sendLog('LLM Processing', 'error', error.message);
        return { success: false, error: error.message || "Unknown error during LLM processing" };
    }
}

// Check LM Studio connection
async function checkLMStudioConnection(): Promise<{ connected: boolean; model?: string }> {
    try {
        const response = await fetch(LMSTUDIO_ENDPOINT + '/models');
        if (response.ok) {
            const data = await response.json();
            const modelName = data.data?.[0]?.id || 'Unknown';
            return { connected: true, model: modelName };
        }
        return { connected: false };
    } catch {
        return { connected: false };
    }
}

// --- Dependency Management ---

async function ensurePythonDependencies() {
    // Wait a brief moment for UI to be ready to receive logs
    await new Promise(resolve => setTimeout(resolve, 1500));

    sendLog('Startup', 'start', 'Checking Python environment...');

    // 1. Check Python
    try {
        await execAsync('python --version');
        sendLog('Startup', 'info', 'Python is installed');
    } catch (e) {
        sendLog('Startup', 'error', 'Python not found');
        dialog.showErrorBox(
            'Python Missing',
            'Python is required to run this application.\nPlease install Python from python.org and try again.'
        );
        app.quit();
        return false;
    }

    // 2. Check youtube_transcript_api
    try {
        await execAsync('pip show youtube-transcript-api');
        sendLog('Startup', 'info', 'Dependencies ready');
        return true;
    } catch (e) {
        sendLog('Startup', 'info', 'Installing youtube-transcript-api...');
        try {
            await execAsync('pip install youtube-transcript-api');
            sendLog('Startup', 'done', 'Dependencies installed');
            return true;
        } catch (installError) {
            console.error(installError);
            sendLog('Startup', 'error', 'Failed to install dependencies');
            dialog.showErrorBox(
                'Installation Failed',
                'Failed to install youtube-transcript-api.\nPlease install it manually: pip install youtube-transcript-api'
            );
            return false;
        }
    }
}

// --- Main Window ---

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 425,
        height: 655,
        minWidth: 410,
        minHeight: 655,
        backgroundColor: '#000000', // Match tech-bg
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#000000',
            symbolColor: '#FFFFFF',
            height: 40
        },
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });



    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }
}

app.whenReady().then(() => {
    // IPC Handlers
    ipcMain.handle('extract-transcript', async (_, url) => getTranscript(url));

    ipcMain.handle('process-llm', async (_, transcript, mode, prompt) => processLLM(transcript, mode, prompt));

    ipcMain.handle('check-llm-connection', async () => checkLMStudioConnection());

    ipcMain.handle('select-output-folder', async () => {
        const result = await dialog.showOpenDialog(mainWindow!, {
            properties: ['openDirectory']
        });
        return result.filePaths[0] || null;
    });

    ipcMain.handle('save-transcript', async (_, content, filename, folder) => {
        try {
            sendLog('File Save', 'start', `Saving ${filename}...`);
            // Sanitize: replace non-alphanumeric with _, collapse multiple _, remove leading/trailing _
            const safeName = filename
                .replace(/[^a-z0-9]/gi, '_')
                .replace(/_+/g, '_')
                .replace(/^_|_$/g, '')
                .toLowerCase() + '.md';
            const fullPath = path.join(folder, safeName);
            fs.writeFileSync(fullPath, content, 'utf-8');
            sendLog('File Save', 'done', safeName);
            return true;
        } catch (e: any) {
            console.error(e);
            sendLog('File Save', 'error', e.message);
            return false;
        }
    });

    ipcMain.handle('open-path', async (_, p) => {
        shell.openPath(p);
    });

    createWindow();
    ensurePythonDependencies();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
