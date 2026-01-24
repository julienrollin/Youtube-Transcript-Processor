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
            return json.dumps({
                "success": True, 
                "transcript": format_transcript(data), 
                "segments": len(data),
                "language": transcript_obj.language_code if transcript_obj else "unknown",
                "is_generated": transcript_obj.is_generated if transcript_obj else True
            })
        else:
            return json.dumps({"success": False, "error": "Could not find or fetch transcript."})
        
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


def format_transcript(data):
    """Convert transcript data to plain text."""
    if not data:
        return ""
    # Check first item type and process accordingly
    if hasattr(data[0], 'text'):
        return " ".join(item.text for item in data).replace('\n', ' ')
    elif isinstance(data[0], dict) and 'text' in data[0]:
        return " ".join(item['text'] for item in data).replace('\n', ' ')
    return " ".join(str(item) for item in data).replace('\n', ' ')


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "No video ID provided"}))
        sys.exit(1)
    
    video_id = sys.argv[1]
    language = sys.argv[2] if len(sys.argv) > 2 else 'auto'
    
    print(get_transcript(video_id, language))
