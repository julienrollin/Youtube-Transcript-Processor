// YT Transcript Processor - Frontend Logic
const { invoke } = window.__TAURI__.core;
const { open } = window.__TAURI__.dialog;
const { listen } = window.__TAURI__.event;

// State
const state = {
  urlsInput: '',
  outputFolder: null,
  language: 'Auto',
  processingModes: ['Summary'],
  saveRawTranscript: false,
  includeTimecodes: false,
  isProcessing: false,
  llmConnected: false,
  llmModel: null,
  batchQueue: [],
  logs: []
};

// DOM Elements
let elements = {};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initElements();
  initEventListeners();
  initLucideIcons();
  startConnectionCheck();
  setupLogListener();
});

function initElements() {
  elements = {
    urlsInput: document.getElementById('urlsInput'),
    language: document.getElementById('language'),
    folderPicker: document.getElementById('folderPicker'),
    folderPath: document.getElementById('folderPath'),
    saveRawCheck: document.getElementById('saveRawCheck'),
    timecodesCheck: document.getElementById('timecodesCheck'),
    processBtn: document.getElementById('processBtn'),
    queueCount: document.getElementById('queueCount'),
    queueList: document.getElementById('queueList'),
    logList: document.getElementById('logList'),
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    modelInfo: document.getElementById('modelInfo'),
    modelName: document.getElementById('modelName'),
    modeBtns: document.querySelectorAll('.mode-btn')
  };
}

function initEventListeners() {
  // URLs input
  elements.urlsInput.addEventListener('input', (e) => {
    state.urlsInput = e.target.value;
  });

  // Language
  elements.language.addEventListener('change', (e) => {
    state.language = e.target.value;
  });

  // Folder picker
  elements.folderPicker.addEventListener('click', selectFolder);

  // Mode buttons
  elements.modeBtns.forEach(btn => {
    btn.addEventListener('click', () => toggleMode(btn.dataset.mode));
  });

  // Checkboxes
  elements.saveRawCheck.addEventListener('click', () => {
    state.saveRawTranscript = !state.saveRawTranscript;
    elements.saveRawCheck.classList.toggle('checked', state.saveRawTranscript);
  });

  elements.timecodesCheck.addEventListener('click', () => {
    state.includeTimecodes = !state.includeTimecodes;
    elements.timecodesCheck.classList.toggle('checked', state.includeTimecodes);
  });

  // Process button
  elements.processBtn.addEventListener('click', runBatch);
}

function initLucideIcons() {
  if (window.lucide) {
    lucide.createIcons();
  }
}

// Mode toggle
function toggleMode(mode) {
  const idx = state.processingModes.indexOf(mode);
  if (idx > -1) {
    // Don't allow empty
    if (state.processingModes.length > 1) {
      state.processingModes.splice(idx, 1);
    }
  } else {
    state.processingModes.push(mode);
  }
  updateModeButtons();
}

function updateModeButtons() {
  elements.modeBtns.forEach(btn => {
    btn.classList.toggle('active', state.processingModes.includes(btn.dataset.mode));
  });
}

// Folder selection
async function selectFolder() {
  try {
    const folder = await open({
      directory: true,
      multiple: false,
      title: 'Select Output Folder'
    });

    if (folder) {
      state.outputFolder = folder;
      elements.folderPath.textContent = folder;
      elements.folderPicker.classList.add('selected');
    }
  } catch (e) {
    console.error('Folder selection error:', e);
  }
}

// Connection check
async function checkConnection() {
  try {
    const status = await invoke('check_llm_connection');
    state.llmConnected = status.connected;
    state.llmModel = status.model;
    updateConnectionUI();
  } catch (e) {
    state.llmConnected = false;
    state.llmModel = null;
    updateConnectionUI();
  }
}

function startConnectionCheck() {
  checkConnection();
  setInterval(checkConnection, 5000);
}

function updateConnectionUI() {
  elements.statusDot.classList.toggle('online', state.llmConnected);
  elements.statusDot.classList.toggle('offline', !state.llmConnected);
  elements.statusText.classList.toggle('online', state.llmConnected);
  elements.statusText.classList.toggle('offline', !state.llmConnected);
  elements.statusText.textContent = state.llmConnected ? 'CONNECTED' : 'OFFLINE';

  if (state.llmConnected && state.llmModel) {
    elements.modelInfo.style.display = 'flex';
    elements.modelName.textContent = state.llmModel;
  } else {
    elements.modelInfo.style.display = 'none';
  }

  updateProcessButton();
}

function updateProcessButton() {
  const btn = elements.processBtn;
  const span = btn.querySelector('span');

  if (state.isProcessing) {
    btn.classList.add('processing');
    btn.classList.remove('enabled');
    span.textContent = 'PROCESSING...';
  } else if (state.llmConnected) {
    btn.classList.remove('processing');
    btn.classList.add('enabled');
    btn.disabled = false;
    span.textContent = 'TRANSCRIPT!';
  } else {
    btn.classList.remove('processing', 'enabled');
    btn.disabled = true;
    span.textContent = 'LM STUDIO OFFLINE';
  }
}

// Log listener
async function setupLogListener() {
  await listen('log-event', (event) => {
    addLog(event.payload);
  });
}

function addLog(log) {
  state.logs.push(log);
  if (state.logs.length > 50) {
    state.logs.shift();
  }
  renderLogs();
}

function clearLogs() {
  state.logs = [];
  renderLogs();
}

function renderLogs() {
  const list = elements.logList;

  if (state.logs.length === 0) {
    list.innerHTML = '<div class="log-empty">Waiting for activity...</div>';
    return;
  }

  const recent = state.logs.slice(-10);
  list.innerHTML = recent.map(log => {
    const statusIcon = {
      'start': '▶ RUN',
      'done': '✓ OK',
      'error': '✕ ERR',
      'info': '• INFO'
    }[log.status] || '• INFO';

    return `
            <div class="log-item">
                <span class="log-status ${log.status}">${statusIcon}</span>
                <span class="log-step">${log.step}</span>
                ${log.message ? `<span class="log-message">${log.message}</span>` : ''}
            </div>
        `;
  }).join('');

  list.scrollTop = list.scrollHeight;
}

// Queue management
function resetQueue() {
  state.batchQueue = [];
  renderQueue();
}

function addToQueue(url) {
  state.batchQueue.push({
    id: Math.random().toString(36).substr(2, 9),
    url: url,
    videoTitle: null,
    status: 'pending',
    currentStep: null,
    error: null
  });
  renderQueue();
}

function updateQueueItem(id, updates) {
  const item = state.batchQueue.find(i => i.id === id);
  if (item) {
    Object.assign(item, updates);
    renderQueue();
  }
}

function renderQueue() {
  const list = elements.queueList;
  const completed = state.batchQueue.filter(i => i.status === 'completed').length;
  elements.queueCount.textContent = `${completed}/${state.batchQueue.length}`;

  if (state.batchQueue.length === 0) {
    list.innerHTML = `
            <div class="queue-empty">
                <i data-lucide="zap" class="icon-lg"></i>
                <span>QUEUE EMPTY</span>
            </div>
        `;
    initLucideIcons();
    return;
  }

  list.innerHTML = state.batchQueue.map(item => {
    let statusHtml = '';

    switch (item.status) {
      case 'pending':
        statusHtml = '<span>WAITING...</span>';
        break;
      case 'processing':
        statusHtml = `
                    <span class="processing-dot"></span>
                    <span class="animate-dots">${(item.currentStep || 'PROCESSING').replace(/\.+$/, '')}</span>
                `;
        break;
      case 'completed':
        statusHtml = '<span>✓ Saved</span>';
        break;
      case 'error':
        statusHtml = `<span>✕ Error: ${item.error}</span>`;
        break;
    }

    return `
            <div class="queue-item ${item.status}">
                <div class="queue-item-title">${item.videoTitle || item.url}</div>
                <div class="queue-item-status">${statusHtml}</div>
            </div>
        `;
  }).join('');
}

// Main processing
async function runBatch() {
  if (!state.urlsInput.trim() || !state.outputFolder) {
    alert('Please provide URLs and an Output Folder.');
    return;
  }

  const urls = state.urlsInput.split('\n').map(u => u.trim()).filter(u => u.length > 0);
  if (urls.length === 0) return;

  resetQueue();
  clearLogs();
  urls.forEach(url => addToQueue(url));

  state.isProcessing = true;
  updateProcessButton();

  // Process queue sequentially
  for (const item of state.batchQueue) {
    if (!state.isProcessing) break;

    updateQueueItem(item.id, { status: 'processing', currentStep: 'Fetching transcript...' });

    try {
      // 1. Extract
      updateQueueItem(item.id, { currentStep: 'Downloading transcript...' });
      const extraction = await invoke('extract_transcript', {
        url: item.url,
        includeTimecodes: state.includeTimecodes
      });

      if (!extraction.success) {
        throw new Error(extraction.error || 'Failed to extract transcript');
      }

      // Update title
      if (extraction.videoTitle) {
        updateQueueItem(item.id, { videoTitle: extraction.videoTitle });
      }

      // 2. Save raw if enabled
      if (state.saveRawTranscript) {
        updateQueueItem(item.id, { currentStep: 'Saving raw transcript...' });
        let rawFilename = extraction.videoTitle || extraction.videoId || 'transcript';
        rawFilename = `${rawFilename}_raw`;

        const rawSaved = await invoke('save_transcript', {
          content: extraction.transcript,
          filename: rawFilename,
          folder: state.outputFolder
        });

        if (!rawSaved) {
          throw new Error('Failed to save raw transcript.');
        }
      }

      // 3. Process with each mode
      for (const mode of state.processingModes) {
        updateQueueItem(item.id, { currentStep: `Processing (${mode})...` });

        const processRes = await invoke('process_llm', {
          transcript: extraction.transcript,
          mode: mode.toLowerCase(),
          youtubeUrl: item.url
        });

        if (!processRes.success) {
          throw new Error(processRes.error || `Failed to process with ${mode}`);
        }

        // 4. Save
        updateQueueItem(item.id, { currentStep: `Saving (${mode})...` });

        let filename = extraction.videoTitle || extraction.videoId || 'transcript';
        filename = `${filename}_${mode.toLowerCase()}`;

        const saved = await invoke('save_transcript', {
          content: processRes.result,
          filename: filename,
          folder: state.outputFolder
        });

        if (!saved) {
          throw new Error(`Failed to save ${mode} file.`);
        }
      }

      updateQueueItem(item.id, {
        status: 'completed',
        currentStep: null
      });

    } catch (error) {
      updateQueueItem(item.id, {
        status: 'error',
        error: error.message || 'Unknown error',
        currentStep: null
      });
    }
  }

  state.isProcessing = false;
  updateProcessButton();
}
