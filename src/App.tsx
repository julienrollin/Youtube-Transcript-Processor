import { useEffect, useRef } from 'react';
import { useAppStore } from './store/appStore';
import { Folder, Settings, Zap, Check, X, Cpu, Terminal } from 'lucide-react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

// Helper for classes
function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

function App() {
    const store = useAppStore();
    const logContainerRef = useRef<HTMLDivElement>(null);

    // Auto-scroll log to bottom when new entries arrive
    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [store.logs]);

    useEffect(() => {
        // Initial connection check
        const checkConnection = async () => {
            const status = await window.electron.checkLLMConnection();
            store.setLlmConnection(status.connected, status.model);
        };
        checkConnection();

        // Recheck every 5 seconds
        const interval = setInterval(checkConnection, 5000);

        // Set up log listener
        window.electron.onLogEvent((event) => {
            store.addLog(event);
        });

        return () => {
            clearInterval(interval);
            window.electron.removeLogListener();
        };
    }, []);

    const handleSelectFolder = async () => {
        const folder = await window.electron.selectOutputFolder();
        if (folder) store.setOutputFolder(folder);
    };

    const runBatch = async () => {
        if (!store.urlsInput.trim() || !store.outputFolder) {
            alert('Please provide URLs and an Output Folder.');
            return;
        }

        const urls = store.urlsInput.split('\n').map(u => u.trim()).filter(u => u.length > 0);
        if (urls.length === 0) return;

        store.resetQueue();
        store.clearLogs();
        urls.forEach(url => store.addToQueue(url));
        store.setProcessing(true);

        // Process queue sequentially
        setTimeout(async () => {
            const queue = useAppStore.getState().batchQueue;

            for (const item of queue) {
                if (!useAppStore.getState().isProcessing) break;

                store.updateBatchItem(item.id, { status: 'processing', currentStep: 'Fetching transcript...' });

                try {
                    // 1. Extract
                    store.updateBatchItem(item.id, { currentStep: 'Downloading transcript...' });
                    const extraction = await window.electron.extractTranscript(item.url);
                    if (!extraction.success) throw new Error(extraction.error);

                    // Update title immediately
                    if (extraction.videoTitle) {
                        store.updateBatchItem(item.id, { videoTitle: extraction.videoTitle });
                    }

                    // 2. Process & Save loop
                    const modes = store.processingModes;
                    for (const mode of modes) {
                        store.updateBatchItem(item.id, { currentStep: `Processing (${mode})...` });

                        const processRes = await window.electron.processWithLLM(
                            extraction.transcript!,
                            mode.toLowerCase()
                        );
                        if (!processRes.success) throw new Error(processRes.error);

                        // 3. Save with suffix
                        store.updateBatchItem(item.id, { currentStep: `Saving (${mode})...` });

                        let filename = extraction.videoTitle || extraction.videoId || 'transcript';
                        // Append mode suffix
                        filename = `${filename}_${mode.toLowerCase()}`;

                        const saved = await window.electron.saveTranscript(
                            processRes.result!,
                            filename,
                            store.outputFolder!
                        );
                        if (!saved) throw new Error(`Failed to save ${mode} file.`);
                    }

                    store.updateBatchItem(item.id, {
                        status: 'completed',
                        outputFile: 'Multiple Files',
                        currentStep: undefined
                    });

                } catch (error: any) {
                    store.updateBatchItem(item.id, {
                        status: 'error',
                        error: error.message,
                        currentStep: undefined
                    });
                }
            }
            store.setProcessing(false);
        }, 100);
    };

    return (
        <div className="h-screen flex flex-col bg-tech-bg text-tech-text font-mono select-none overflow-hidden">

            {/* TITLE BAR / DRAG HANDLE */}
            {/* Height 40px matches Electron main.ts titleBarOverlay height */}
            <div className="h-10 shrink-0 bg-black border-b border-tech-border flex items-center px-4 gap-6 drag select-none">

                {/* Title (Small) */}
                <div className="flex items-center gap-2 text-tech-orange font-bold tracking-[0.1em] uppercase text-xs font-grotesk min-w-fit">
                    <div className="w-2 h-2 bg-tech-orange rounded-full" />
                    Transcript Processor
                </div>


                {/* Window Controls Spacer (draggable space pushing content left) */}
                <div className="flex-grow drag" />
            </div>

            {/* MAIN CONTENT - SCROLLABLE */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
                <div className="w-full max-w-lg mx-auto flex flex-col gap-3 pb-4">

                    {/* INPUTS SECTION */}
                    <div className="flex flex-col gap-3">

                        {/* URLs Input */}
                        <div className="flex flex-col gap-1.5">
                            <label className="flex items-center gap-1.5 text-tech-text-muted text-[10px] uppercase tracking-wider font-bold">
                                <Settings className="w-3 h-3" />
                                Youtube_URLs
                            </label>
                            <textarea
                                className="w-full h-20 bg-tech-surface border border-tech-border p-3 text-xs focus:border-tech-orange focus:ring-1 focus:ring-tech-orange transition-all outline-none resize-none placeholder:text-tech-border no-drag"
                                placeholder="https://youtu.be/..."
                                value={store.urlsInput}
                                onChange={(e) => store.setUrlsInput(e.target.value)}
                                spellCheck={false}
                            />
                        </div>

                        {/* Settings Grid */}
                        <div className="grid grid-cols-2 gap-3">
                            {/* Language */}
                            <div className="flex flex-col gap-1.5">
                                <label className="flex items-center gap-1.5 text-tech-text-muted text-[10px] uppercase tracking-wider font-bold">
                                    <Settings className="w-3 h-3" />
                                    Language
                                </label>
                                <select
                                    className="w-full bg-tech-surface border border-tech-border p-2 text-xs focus:border-tech-orange outline-none appearance-none no-drag"
                                    value={store.language}
                                    onChange={(e) => store.setLanguage(e.target.value)}
                                >
                                    <option>Auto</option>
                                    <option>English</option>
                                    <option>French</option>
                                    <option>Spanish</option>
                                    <option>German</option>
                                </select>
                            </div>

                            {/* Mode (Multi-Select) */}
                            <div className="flex flex-col gap-1.5">
                                <label className="flex items-center gap-1.5 text-tech-text-muted text-[10px] uppercase tracking-wider font-bold">
                                    <Settings className="w-3 h-3" />
                                    Modes
                                </label>
                                <div className="grid grid-cols-2 gap-1">
                                    {['Markdown', 'Clean', 'Structured', 'Summary'].map((mode) => (
                                        <div
                                            key={mode}
                                            onClick={() => store.toggleProcessingMode(mode)}
                                            className={cn(
                                                "cursor-pointer text-[10px] uppercase font-bold text-center py-1 border-2 transition-all select-none no-drag",
                                                store.processingModes.includes(mode)
                                                    ? "bg-transparent text-tech-orange border-tech-orange"
                                                    : "bg-transparent text-tech-text-muted border-tech-border hover:border-tech-text-muted"
                                            )}
                                        >
                                            {mode}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Output Folder - Full Width Below Grid */}
                        <div className="flex flex-col gap-1.5">
                            <label className="flex items-center gap-1.5 text-tech-text-muted text-[10px] uppercase tracking-wider font-bold">
                                <Folder className="w-3 h-3" />
                                Output_Folder
                            </label>
                            <div
                                onClick={handleSelectFolder}
                                className="w-full bg-tech-surface border border-tech-border p-2 px-3 text-xs text-tech-text-secondary cursor-pointer hover:border-tech-text-muted transition-colors flex justify-between items-center group no-drag"
                            >
                                <span className={cn("truncate mr-2", store.outputFolder ? "text-tech-text" : "text-tech-text-muted")}>
                                    {store.outputFolder || "Select Output Destination..."}
                                </span>
                                <span className="opacity-0 group-hover:opacity-100 text-tech-orange text-[10px] uppercase shrink-0">Browse</span>
                            </div>
                        </div>
                    </div>

                    {/* ACTIONS */}
                    <div className="flex justify-center mt-2">
                        <button
                            onClick={runBatch}
                            disabled={store.isProcessing || !store.llmConnected}
                            className={cn(
                                "group border py-3 px-8 w-full flex items-center justify-center gap-2 transition-all uppercase text-xs font-bold tracking-widest no-drag",
                                store.llmConnected
                                    ? "border-tech-orange text-tech-orange hover:bg-tech-orange hover:text-black"
                                    : "border-tech-text-muted text-tech-text-muted cursor-not-allowed"
                            )}
                        >
                            <Zap className={cn("w-3.5 h-3.5", store.isProcessing && "animate-pulse")} />
                            {store.isProcessing ? 'Processing...' : store.llmConnected ? 'START PROCESS' : 'LM STUDIO OFFLINE'}
                        </button>
                    </div>

                    {/* PROGRESS SECTION - MOVED UP */}
                    <div className="border border-tech-border bg-tech-surface p-3 flex flex-col gap-2 min-h-[60px]">
                        <div className="flex justify-between items-center border-b border-tech-border pb-2">
                            <div className="flex items-center gap-2 text-tech-text-muted text-[10px] uppercase tracking-wider font-bold">
                                <Zap className="w-3 h-3" />
                                Queue
                            </div>
                            <span className="text-tech-orange text-[10px] font-bold">
                                {store.batchQueue.filter(i => i.status === 'completed').length}/{store.batchQueue.length}
                            </span>
                        </div>

                        <div className="flex flex-col gap-1.5 overflow-y-auto custom-scrollbar max-h-[100px]">
                            {store.batchQueue.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-10 text-tech-text-muted/30 space-y-1">
                                    <Zap className="w-4 h-4 opacity-20" />
                                    <span className="text-[10px] uppercase tracking-widest">Queue Empty</span>
                                </div>
                            ) : (
                                store.batchQueue.map((item) => (
                                    <div
                                        key={item.id}
                                        className={cn(
                                            "border p-2 text-[10px] font-mono transition-all no-drag",
                                            item.status === 'pending' && "border-tech-border text-tech-text-muted",
                                            item.status === 'processing' && "border-tech-orange text-tech-text animate-pulse",
                                            item.status === 'completed' && "border-tech-green/30 bg-tech-green/5 text-tech-green",
                                            item.status === 'error' && "border-tech-red text-tech-red"
                                        )}
                                    >
                                        <div className="truncate mb-1 opacity-70 font-bold">{item.videoTitle || item.url}</div>
                                        <div className="flex items-center gap-2">
                                            {item.status === 'pending' && <span>WAITING...</span>}
                                            {item.status === 'processing' && (
                                                <span className="flex items-center gap-2">
                                                    <span className="inline-block w-1.5 h-1.5 bg-tech-orange rounded-full animate-pulse"></span>
                                                    <span className="animate-dots">{(item.currentStep || 'PROCESSING').replace(/\.+$/, '')}</span>
                                                </span>
                                            )}
                                            {item.status === 'completed' && (
                                                <>
                                                    <Check className="w-3 h-3" />
                                                    <span>Saved</span>
                                                </>
                                            )}
                                            {item.status === 'error' && (
                                                <>
                                                    <X className="w-3 h-3" />
                                                    <span>Error: {item.error}</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* LIVE LOG SECTION */}
                    <div className="border border-tech-border bg-tech-surface/50 p-2 select-text">
                        <div className="flex items-center gap-2 text-tech-text-muted text-[10px] uppercase tracking-wider font-bold mb-1">
                            <Terminal className="w-3 h-3" />
                            Live_Log
                        </div>
                        <div ref={logContainerRef} className="h-10 overflow-y-auto custom-scrollbar space-y-1">
                            {store.logs.length === 0 ? (
                                <div className="text-[10px] text-tech-text-muted/30 italic py-2 text-center">
                                    Waiting for activity...
                                </div>
                            ) : (
                                store.logs.slice(-10).map((log) => (
                                    <div key={log.id} className="flex items-start gap-2 text-[10px] font-mono leading-tight">
                                        <span className={cn(
                                            "w-10 uppercase font-bold shrink-0",
                                            log.status === 'start' && "text-tech-blue",
                                            log.status === 'done' && "text-tech-green",
                                            log.status === 'error' && "text-tech-red",
                                            log.status === 'info' && "text-tech-text-muted"
                                        )}>
                                            {log.status === 'start' ? '▶ RUN' :
                                                log.status === 'done' ? '✓ OK' :
                                                    log.status === 'error' ? '✕ ERR' : '• INFO'}
                                        </span>
                                        <span className="text-tech-orange shrink-0">{log.step}</span>
                                        {log.message && <span className="text-tech-text-muted truncate">{log.message}</span>}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* LLM STATUS SECTION - BOTTOM */}
                    <div className="border border-tech-border bg-tech-surface/30 p-2">
                        <div className="flex items-center justify-between text-[10px]">
                            <div className="flex items-center gap-2">
                                {store.llmConnected ? (
                                    <>
                                        <div className="w-2 h-2 bg-tech-green rounded-full" />
                                        <span className="text-tech-text-muted uppercase tracking-wider">LLM</span>
                                        <span className="text-tech-green font-bold">CONNECTED</span>
                                    </>
                                ) : (
                                    <>
                                        <div className="w-2 h-2 bg-tech-red rounded-full" />
                                        <span className="text-tech-text-muted uppercase tracking-wider">LLM</span>
                                        <span className="text-tech-red font-bold">OFFLINE</span>
                                    </>
                                )}
                            </div>
                            {store.llmConnected && store.llmModel && (
                                <div className="flex items-center gap-1.5">
                                    <Cpu className="w-3 h-3 text-tech-orange" />
                                    <span className="text-tech-orange font-mono truncate max-w-[200px]">{store.llmModel}</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

}

export default App;
