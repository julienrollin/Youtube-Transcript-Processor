import { create } from 'zustand';

export interface BatchItem {
    id: string;
    url: string;
    videoTitle?: string;
    status: 'pending' | 'processing' | 'completed' | 'error';
    currentStep?: string;
    outputFile?: string;
    error?: string;
}

export interface LogEntry {
    id: string;
    step: string;
    status: 'start' | 'done' | 'error' | 'info';
    message?: string;
    timestamp: number;
}

interface AppState {
    // Inputs
    urlsInput: string;
    setUrlsInput: (val: string) => void;
    outputFolder: string | null;
    setOutputFolder: (path: string) => void;
    language: string;
    setLanguage: (lang: string) => void;
    processingModes: string[];
    toggleProcessingMode: (mode: string) => void;

    // Processing State
    isProcessing: boolean;
    batchQueue: BatchItem[];
    addToQueue: (url: string) => void;
    updateBatchItem: (id: string, updates: Partial<BatchItem>) => void;
    setProcessing: (status: boolean) => void;

    // System State
    llmConnected: boolean;
    llmModel: string | null;
    setLlmConnection: (connected: boolean, model?: string) => void;

    // Logging
    logs: LogEntry[];
    addLog: (entry: Omit<LogEntry, 'id'>) => void;
    clearLogs: () => void;

    resetQueue: () => void;
}

export const useAppStore = create<AppState>((set) => ({
    urlsInput: '',
    setUrlsInput: (urlsInput) => set({ urlsInput }),

    outputFolder: null,
    setOutputFolder: (outputFolder) => set({ outputFolder }),

    language: 'Auto',
    setLanguage: (language) => set({ language }),

    processingModes: ['Markdown'],
    toggleProcessingMode: (mode) => set((state) => {
        if (state.processingModes.includes(mode)) {
            // Don't allow empty, keep at least one if user tries to uncheck last
            if (state.processingModes.length === 1) return {};
            return { processingModes: state.processingModes.filter(m => m !== mode) };
        } else {
            return { processingModes: [...state.processingModes, mode] };
        }
    }),

    isProcessing: false,
    setProcessing: (isProcessing) => set({ isProcessing }),

    batchQueue: [],
    addToQueue: (url) => set((state) => ({
        batchQueue: [...state.batchQueue, {
            id: Math.random().toString(36).substr(2, 9),
            url,
            status: 'pending'
        }]
    })),

    updateBatchItem: (id, updates) => set((state) => ({
        batchQueue: state.batchQueue.map(item =>
            item.id === id ? { ...item, ...updates } : item
        )
    })),

    llmConnected: false,
    llmModel: null,
    setLlmConnection: (connected, model) => set({
        llmConnected: connected,
        llmModel: model || null
    }),

    // Logging
    logs: [],
    addLog: (entry) => set((state) => ({
        logs: [...state.logs.slice(-50), { ...entry, id: Math.random().toString(36).substr(2, 9) }]
    })),
    clearLogs: () => set({ logs: [] }),

    resetQueue: () => set({ batchQueue: [], isProcessing: false, logs: [] })
}));
