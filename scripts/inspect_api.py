from youtube_transcript_api import YouTubeTranscriptApi
import inspect

print("Methods available:", dir(YouTubeTranscriptApi))

if hasattr(YouTubeTranscriptApi, 'list'):
    print("\n--- 'list' method found ---")
    try:
        print(inspect.signature(YouTubeTranscriptApi.list))
        print("Doc:", YouTubeTranscriptApi.list.__doc__)
    except:
        print("Could not inspect 'list'")

if hasattr(YouTubeTranscriptApi, 'fetch'):
    print("\n--- 'fetch' method found ---")
    try:
        print(inspect.signature(YouTubeTranscriptApi.fetch))
        print("Doc:", YouTubeTranscriptApi.fetch.__doc__)
    except:
        print("Could not inspect 'fetch'")
