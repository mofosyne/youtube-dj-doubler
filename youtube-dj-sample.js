// YouTube DJ Doubler - Sample Mode

// Global state
let playerA = null;
let playerB = null;
let playersReady = { A: false, B: false };
let playerCreating = { A: false, B: false };

// Sample storage
let samples = {
    A: [],
    B: []
};

// Sample pads (16 pads total)
let samplePads = Array(16).fill(null);

// Recording state
let recordingState = {
    A: { isRecording: false, startTime: 0, samples: [] },
    B: { isRecording: false, startTime: 0, samples: [] }
};

// BPM and timing
let bpm = 120;
let lastTapTime = 0;
let tempoInterval = null;

// YouTube API setup
function onYouTubeIframeAPIReady() {
    console.log('YouTube IFrame API ready');
    updateStatus('YouTube API loaded. Enter URLs and click Load.');
}

// Create player
function createPlayer(containerId, playerId, videoId, startSeconds) {
    return new YT.Player(containerId, {
        videoId: videoId,
        height: '100%',
        width: '100%',
        playerVars: {
            autoplay: 0,
            start: Math.floor(startSeconds || 0),
            controls: 1,
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            // Error 153 happens when YouTube can't identify the embedding site
            // (e.g. page opened via file://). Only send origin on http(s).
            ...(location.protocol.startsWith('http') ? { origin: location.origin } : {})
        },
        events: {
            'onReady': function(e) { onPlayerReady(e, playerId); },
            'onStateChange': function(e) { onPlayerStateChange(e, playerId); }
        }
    });
}

// Player ready
function onPlayerReady(event, playerId) {
    console.log(`Player ${playerId} ready`);
    playersReady[playerId] = true;

    const player = event.target;
    if (playerId === 'A') {
        playerA = player;
    } else {
        playerB = player;
    }

    updateStatus(`Player ${playerId} ready`);

}

// Player state change
function onPlayerStateChange(event, playerId) {
    const state = event.data;
    const player = event.target;

    // Handle recording
    if (recordingState[playerId].isRecording) {
        handleRecording(playerId, player);
    }
}

// Load video
function loadVideo(playerId) {
    const urlInput = document.getElementById(`url${playerId}`);
    const url = urlInput.value.trim();

    if (!url) {
        updateStatus(`Please enter a YouTube URL for player ${playerId}`);
        return;
    }

    loadVideoFromUrl(playerId, url);
}

// Load video from URL
function loadVideoFromUrl(playerId, url) {
    const videoId = extractVideoId(url);

    if (!videoId) {
        updateStatus(`Invalid YouTube URL for player ${playerId}`);
        return;
    }

    // Store URL
    document.getElementById(`url${playerId}`).value = url;

    // Create player if needed
    const existing = playerId === 'A' ? playerA : playerB;
    if (!existing) {
        // Create the player directly with the video (an embed with no video shows a generic error)
        if (playerCreating[playerId]) return;
        if (typeof YT === 'undefined' || !YT.Player) {
            updateStatus('YouTube API is still loading, try again in a moment.');
            return;
        }
        playerCreating[playerId] = true;
        createPlayer(`player${playerId}`, playerId, videoId, 0);
        updateStatus(`Loading video ${playerId}`);
        return;
    }

    // Load video
    const player = playerId === 'A' ? playerA : playerB;
    if (player) {
        player.loadVideoById(videoId);
        updateStatus(`Loading video ${playerId}`);
    }
}

// Extract video ID
function extractVideoId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|shorts\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// Update status
function updateStatus(message) {
    document.getElementById('statusText').textContent = message;
    console.log(message);
}

// Record sample from player
function recordSample(playerId) {
    const player = playerId === 'A' ? playerA : playerB;

    if (!player) {
        updateStatus(`Player ${playerId} not loaded`);
        return;
    }

    const currentState = recordingState[playerId];

    if (currentState.isRecording) {
        // Stop recording
        currentState.isRecording = false;
        updateStatus(`Stopped recording from ${playerId}`);
        document.getElementById(`url${playerId}`).parentElement.style.borderColor = '';
    } else {
        // Start recording
        currentState.isRecording = true;
        currentState.startTime = player.getCurrentTime();
        currentState.samples = [];

        updateStatus(`Recording from ${playerId}...`);
        document.getElementById(`url${playerId}`).parentElement.style.borderColor = '#ff6b6b';

        // Add first sample point
        currentState.samples.push({
            time: player.getCurrentTime(),
            videoTime: player.getCurrentTime()
        });
    }
}

// Handle recording while player is playing
function handleRecording(playerId, player) {
    const currentState = recordingState[playerId];

    if (!currentState.isRecording) return;

    const currentTime = player.getCurrentTime();
    const sampleLength = parseFloat(document.getElementById(`sampleLength${playerId}`).value) || 2;

    // Add sample points periodically
    if (currentState.samples.length === 0 ||
        currentTime - currentState.samples[currentState.samples.length - 1].time >= 0.1) {
        currentState.samples.push({
            time: currentTime,
            videoTime: currentTime
        });
    }

    // Check if we should stop recording (after sample length)
    if (currentTime - currentState.startTime >= sampleLength) {
        currentState.isRecording = false;
        document.getElementById(`url${playerId}`).parentElement.style.borderColor = '';

        // Create sample from recorded points
        createSampleFromRecording(playerId, currentState.samples, currentState.startTime, currentTime);
    }
}

// Create sample from recording
function createSampleFromRecording(playerId, points, startTime, endTime) {
    const sampleLength = parseFloat(document.getElementById(`sampleLength${playerId}`).value) || 2;

    const sample = {
        playerId: playerId,
        videoId: extractVideoId(document.getElementById(`url${playerId}`).value),
        startTime: startTime,
        endTime: endTime,
        duration: endTime - startTime,
        createdAt: Date.now()
    };

    // Add to samples array
    samples[playerId].push(sample);

    // Find first empty pad
    let padIndex = samplePads.findIndex(pad => pad === null);
    if (padIndex === -1) {
        padIndex = samplePads.length;
        samplePads.push(sample);
    } else {
        samplePads[padIndex] = sample;
    }

    updateStatus(`Sample recorded: ${sample.duration.toFixed(1)}s, assigned to pad ${padIndex + 1}`);

    // Refresh sample grid
    renderSampleGrid();
}

// Play sample
function playSample(padIndex) {
    const sample = samplePads[padIndex];
    if (!sample) {
        updateStatus(`No sample on pad ${padIndex + 1}`);
        return;
    }

    const player = sample.playerId === 'A' ? playerA : playerB;
    if (!player) {
        updateStatus(`Player ${sample.playerId} not loaded`);
        return;
    }

    // Seek to start time and play
    player.seekTo(sample.startTime);
    player.playVideo();

    // Highlight pad
    const padElement = document.querySelector(`.sample-pad:nth-child(${padIndex + 1})`);
    if (padElement) {
        padElement.classList.add('playing');
        setTimeout(() => {
            padElement.classList.remove('playing');
        }, 200);
    }

    // Auto-stop after sample duration
    setTimeout(() => {
        player.pauseVideo();
    }, sample.duration * 1000);

    updateStatus(`Playing sample ${padIndex + 1}: ${sample.duration.toFixed(1)}s`);
}

// Play all samples
function playAllSamples() {
    samplePads.forEach((sample, index) => {
        if (sample) {
            setTimeout(() => {
                playSample(index);
            }, index * 100);
        }
    });
}

// Stop all samples
function stopAllSamples() {
    if (playerA) playerA.stopVideo();
    if (playerB) playerB.stopVideo();
    updateStatus('All samples stopped');
}

// Clear all samples
function clearAllSamples() {
    samples = { A: [], B: [] };
    samplePads = Array(16).fill(null);
    renderSampleGrid();
    updateStatus('All samples cleared');
}

// Render sample grid
function renderSampleGrid() {
    const grid = document.getElementById('sampleGrid');
    grid.innerHTML = '';

    samplePads.forEach((sample, index) => {
        const pad = document.createElement('div');
        pad.className = 'sample-pad';
        if (sample) {
            pad.classList.add('active');
            pad.innerHTML = `
                <span class="number">${index + 1}</span>
                <span class="start">${sample.startTime.toFixed(1)}s</span>
                <span class="duration">${sample.duration.toFixed(1)}s</span>
            `;
        } else {
            pad.innerHTML = `<span class="number">${index + 1}</span>`;
        }

        pad.onclick = () => playSample(index);

        grid.appendChild(pad);
    });
}

// Tap tempo
function tapTempo() {
    const now = Date.now();

    if (lastTapTime) {
        const interval = now - lastTapTime;
        bpm = Math.round(60000 / interval);
        document.getElementById('bpm').value = bpm;
        document.getElementById('tempoStatus').textContent = `BPM: ${bpm}`;

        // Clear after 2 seconds
        setTimeout(() => {
            document.getElementById('tempoStatus').textContent = '';
        }, 2000);
    }

    lastTapTime = now;
}

// BPM change handler
function updateBPM() {
    bpm = parseInt(document.getElementById('bpm').value) || 120;
    document.getElementById('tempoStatus').textContent = `BPM: ${bpm}`;

    // Clear tempo status
    setTimeout(() => {
        document.getElementById('tempoStatus').textContent = '';
    }, 2000);
}

// Export samples
function exportSamples() {
    const data = {
        samples: samples,
        samplePads: samplePads,
        bpm: bpm
    };

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'youtube-dj-samples.json';
    a.click();

    URL.revokeObjectURL(url);
    updateStatus('Samples exported');
}

// Import samples
function importSamples() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                samples = data.samples || { A: [], B: [] };
                samplePads = data.samplePads || Array(16).fill(null);
                bpm = data.bpm || 120;

                document.getElementById('bpm').value = bpm;
                renderSampleGrid();
                updateStatus('Samples imported');
            } catch (error) {
                updateStatus('Error importing samples: ' + error.message);
            }
        };

        reader.readAsText(file);
    };

    input.click();
}

// Switch between modes
function switchMode(mode) {
    if (mode === 'basic') {
        window.location.href = 'youtube-dj.html';
    } else {
        document.getElementById('basicModeBtn').classList.remove('active');
        document.getElementById('sampleModeBtn').classList.add('active');
    }
}

// Initialize
window.addEventListener('DOMContentLoaded', function() {
    renderSampleGrid();
    document.getElementById('bpm').addEventListener('change', updateBPM);
    document.getElementById('urlA').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') loadVideo('A');
    });
    document.getElementById('urlB').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') loadVideo('B');
    });
    updateStatus('Sample mode ready. Load YouTube videos to start recording samples.');
});

// Make functions globally available
window.loadVideo = loadVideo;
window.playSample = playSample;
window.stopAllSamples = stopAllSamples;
window.clearAllSamples = clearAllSamples;
window.recordSample = recordSample;
window.playAllSamples = playAllSamples;
window.tapTempo = tapTempo;
window.exportSamples = exportSamples;
window.importSamples = importSamples;
window.switchMode = switchMode;