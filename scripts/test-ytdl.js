const ytdl = require('@distube/ytdl-core');
const https = require('https');

const VIDEO_ID = 'M7fi_IB5Kng'; // Gummy Bear Song

async function run() {
    console.log('Fetching info...');
    try {
        const info = await ytdl.getInfo(VIDEO_ID);
        const tracks = info.player_response.captions?.playerCaptionsTracklistRenderer?.captionTracks;

        if (tracks && tracks.length > 0) {
            console.log(`✅ Found ${tracks.length} tracks.`);
            console.log(tracks.map(t => `${t.name.simpleText} (${t.languageCode})`));

            // Try fetching
            const track = tracks[0];
            console.log(`Fetching: ${track.baseUrl}`);

            https.get(track.baseUrl, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    console.log(`✅ Data received: ${data.length} chars`);
                    console.log('Snippet:', data.substring(0, 100));
                });
            });
        } else {
            console.log('❌ No tracks found.');
        }
    } catch (e) {
        console.error('❌ Error:', e.message);
    }
}

run();
