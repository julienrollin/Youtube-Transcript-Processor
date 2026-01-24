from youtube_transcript_api import YouTubeTranscriptApi
import json

VIDEO_ID = 'M7fi_IB5Kng'

try:
    print(f"Fetching transcript for {VIDEO_ID}...")
    transcript = YouTubeTranscriptApi.get_transcript(VIDEO_ID)
    print("✅ Success!")
    print(json.dumps(transcript[0], indent=2))
except Exception as e:
    print(f"❌ Error: {e}")
