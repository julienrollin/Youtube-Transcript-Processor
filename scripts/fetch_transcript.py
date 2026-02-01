import sys
import json
from youtube_transcript_api import YouTubeTranscriptApi

def get_transcript(video_id, language='auto'):
    """Fetch transcript for a YouTube video with API version compatibility."""
    try:
        # Try the different API method names that exist across versions
        transcript_list = None
        transcript_obj = None
        data = None
        
        # Method 1: list_transcripts (newer versions)
        if hasattr(YouTubeTranscriptApi, 'list_transcripts'):
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
        # Method 2: list (some versions)
        elif hasattr(YouTubeTranscriptApi, 'list'):
            try:
                transcript_list = YouTubeTranscriptApi.list(video_id)
            except TypeError:
                # Might need instance
                transcript_list = YouTubeTranscriptApi().list(video_id)
        
        # If we got a list, pick the best transcript
        if transcript_list:
            if language == 'auto':
                # Prefer manual transcripts
                for t in transcript_list:
                    if not t.is_generated:
                        transcript_obj = t
                        break
                if not transcript_obj:
                    transcript_obj = next(iter(transcript_list))
            else:
                transcript_obj = transcript_list.find_transcript([language])
            
            data = transcript_obj.fetch()
        
        # Fallback: Direct fetch methods
        if not data:
            langs = [language] if language != 'auto' else ['en']
            
            if hasattr(YouTubeTranscriptApi, 'get_transcript'):
                try:
                    data = YouTubeTranscriptApi.get_transcript(video_id, languages=langs)
                except TypeError:
                    data = YouTubeTranscriptApi.get_transcript(video_id)
            elif hasattr(YouTubeTranscriptApi, 'fetch'):
                try:
                    data = YouTubeTranscriptApi.fetch(video_id, languages=langs)
                except TypeError:
                    data = YouTubeTranscriptApi.fetch(video_id)
        
        if data:
            # Check if timecodes arg is passed
            with_timecodes = len(sys.argv) > 3 and sys.argv[3].lower() == 'true'
            return json.dumps({
                "success": True, 
                "transcript": format_transcript(data, with_timecodes), 
                "segments": len(data),
                "language": transcript_obj.language_code if transcript_obj else "unknown",
                "is_generated": transcript_obj.is_generated if transcript_obj else True
            })
        else:
            return json.dumps({"success": False, "error": "Could not find or fetch transcript."})
        
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


def format_seconds_to_timestamp(seconds):
    """Convert seconds to MM:SS format."""
    minutes = int(seconds // 60)
    secs = int(seconds % 60)
    return f"[{minutes:02d}:{secs:02d}]"


def format_transcript(data, with_timecodes=False):
    """Convert transcript data to plain text, optionally with timecodes."""
    if not data:
        return ""
    
    parts = []
    for item in data:
        # Get text and start time
        if hasattr(item, 'text'):
            text = item.text
            start = getattr(item, 'start', 0)
        elif isinstance(item, dict):
            text = item.get('text', '')
            start = item.get('start', 0)
        else:
            text = str(item)
            start = 0
        
        if with_timecodes:
            timestamp = format_seconds_to_timestamp(start)
            parts.append(f"{timestamp} {text}")
        else:
            parts.append(text)
    
    return " ".join(parts).replace('\n', ' ')


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "No video ID provided"}))
        sys.exit(1)
    
    video_id = sys.argv[1]
    language = sys.argv[2] if len(sys.argv) > 2 else 'auto'
    
    print(get_transcript(video_id, language))
