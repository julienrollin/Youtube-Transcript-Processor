// Type definitions for Electron API exposed via preload

export interface LLMConnectionStatus {
    connected: boolean;
    model?: string;
}

export interface LogEvent {
    step: string;
    status: 'start' | 'done' | 'error' | 'info';
    message?: string;
    timestamp: number;
}

export interface TranscriptExtractionResult {
    success: boolean;
    videoId?: string;
    videoTitle?: string;
    transcript?: string;
    segmentCount?: number;
    error?: string;
}

export interface LLMProcessResult {
    success: boolean;
    result?: string;
    error?: string;
}

export interface ElectronAPI {
    extractTranscript: (url: string) => Promise<TranscriptExtractionResult>;
    processWithLLM: (transcript: string, mode: string, prompt?: string) => Promise<LLMProcessResult>;
    selectOutputFolder: () => Promise<string | null>;
    saveTranscript: (content: string, filename: string, folder: string) => Promise<boolean>;
    openPath: (path: string) => Promise<void>;
    checkLLMConnection: () => Promise<LLMConnectionStatus>;
    onLogEvent: (callback: (event: LogEvent) => void) => void;
    removeLogListener: () => void;
}

declare global {
    interface Window {
        electron: ElectronAPI;
    }
}

export { };
