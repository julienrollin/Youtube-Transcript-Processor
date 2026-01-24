import { contextBridge, ipcRenderer } from 'electron';

// Log event listener type
export type LogEventHandler = (event: {
    step: string;
    status: 'start' | 'done' | 'error' | 'info';
    message?: string;
    timestamp: number;
}) => void;

contextBridge.exposeInMainWorld('electron', {
    extractTranscript: (url: string) => ipcRenderer.invoke('extract-transcript', url),
    processWithLLM: (transcript: string, mode: string, prompt?: string) => ipcRenderer.invoke('process-llm', transcript, mode, prompt),
    selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),
    saveTranscript: (content: string, filename: string, folder: string) => ipcRenderer.invoke('save-transcript', content, filename, folder),
    openPath: (path: string) => ipcRenderer.invoke('open-path', path),
    checkLLMConnection: () => ipcRenderer.invoke('check-llm-connection'),

    // Log event listener
    onLogEvent: (callback: LogEventHandler) => {
        ipcRenderer.on('log-event', (_, data) => callback(data));
    },
    removeLogListener: () => {
        ipcRenderer.removeAllListeners('log-event');
    }
});

// Types for TypeScript
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

export interface ElectronAPI {
    extractTranscript: (url: string) => Promise<any>;
    processWithLLM: (transcript: string, mode: string, prompt?: string) => Promise<any>;
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
