# YT Transcript Processor

A local desktop application to extracting and processing YouTube transcripts using a local LLM (via LM Studio).

## Features

- **Extract Transcripts**: formatting-free extraction of transcripts from YouTube videos.
- **Local AI Processing**: Use any model via LM Studio to clean, summarize, or structure the text.
- **Multiple Modes**:
    - **Clean**: Remove filler words and fix punctuation.
    - **Structured**: Organize content with headers and bullet points.
    - **Summary**: Generate a concise overview with key takeaways.
    - **Markdown**: Convert to a detailed Markdown document.
    - **JSON**: Export as structured JSON.
- **Privacy Focused**: All processing happens locally on your machine.

## Prerequisites

1.  **Python**: Required for the underlying transcript extraction tool (`youtube-transcript-api`).
    -   [Download Python](https://www.python.org/downloads/)
    -   Ensure "Add Python to PATH" is checked during installation.
2.  **LM Studio**: Required for AI processing.
    -   [Download LM Studio](https://lmstudio.ai/)

## LM Studio Setup

This application connects to LM Studio's local server API.

1.  Open **LM Studio**.
2.  **Search** for and **Download** a model (e.g., `Llama 3`, `Mistral`, or `Qwen`).
3.  Go to the **Local Server** tab (double-headed arrow icon on the left).
4.  Select your downloaded model from the dropdown at the top.
5.  Set the **Port** to `1234` (this is the default).
6.  Click **Start Server**.

Once the server is running (green indicator), the YT Transcript Processor will automatically detect the connection.

## Installation & Usage

1.  Download the latest installer from the [Releases](https://github.com/julienrollin/Youtube-Transcript-Processor/releases) page.
2.  Run the installer (`YT Transcript Processor Setup.exe`).
3.  Launch the application.
4.  Paste a YouTube URL and click **Start Process**.

## Development

To run this project locally:

```bash
# Clone the repository
git clone https://github.com/julienrollin/Youtube-Transcript-Processor.git

# Install dependencies
npm install

# Run in development mode
npm run electron:dev

# Build for production
npm run electron:build
```