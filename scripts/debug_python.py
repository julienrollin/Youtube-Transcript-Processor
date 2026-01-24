import youtube_transcript_api
print("Module file:", youtube_transcript_api.__file__)
print("Dir:", dir(youtube_transcript_api))

try:
    from youtube_transcript_api import YouTubeTranscriptApi
    print("Class Dir:", dir(YouTubeTranscriptApi))
except ImportError as e:
    print("Import Error:", e)
