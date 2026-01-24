const { YoutubeTranscript } = require('youtube-transcript');
const { getSubtitles } = require('youtube-captions-scraper');
const ytdl = require('@distube/ytdl-core');

const VIDEO_ID = 'M7fi_IB5Kng'; // Gummy Bear Song - definitely has captions

async function testYoutubeTranscript() {
    console.log('--- Testing youtube-transcript ---');
    try {
        const transcript = await YoutubeTranscript.fetchTranscript(VIDEO_ID);
        console.log(`✅ Success! Found ${transcript.length} segments.`);
        if (transcript.length > 0) console.log('Sample:', transcript[0]);
    } catch (error) {
        console.log('❌ Failed:', error.message);
    }
}

async function testYoutubeCaptionsScraper() {
    console.log('\n--- Testing youtube-captions-scraper ---');
    try {
        const captions = await getSubtitles({
            videoID: VIDEO_ID,
            lang: 'en'
        });
        console.log(`✅ Success! Found ${captions.length} segments.`);
        if (captions.length > 0) console.log('Sample:', captions[0]);
    } catch (error) {
        console.log('❌ Failed:', error.message);
    }
}

async function testYtdlCore() {
    console.log('\n--- Testing @distube/ytdl-core ---');
    try {
        const info = await ytdl.getInfo(VIDEO_ID);
        const tracks = info.player_response.captions?.playerCaptionsTracklistRenderer?.captionTracks;

        if (tracks && tracks.length > 0) {
            console.log(`✅ Found ${tracks.length} caption tracks.`);
            console.log('Tracks:', tracks.map(t => `${t.name.simpleText} (${t.languageCode})`));

            // Fetch the first track
            const track = tracks[0];
            console.log(`Fetching track: ${track.baseUrl}`);
            const response = await fetch(track.baseUrl);
            const xml = await response.text();
            console.log(`✅ Fetched XML (${xml.length} chars)`);
        } else {
            console.log('❌ No captions found in ytdl-core info.');
        }
    } catch (error) {
        console.log('❌ Failed:', error.message);
    }
}

async function run() {
    await testYoutubeTranscript();
    await testYoutubeCaptionsScraper();
    await testYtdlCore();
}

run();
