// YouTube DJ Doubler - JavaScript

// Global player references
let playerA = null;
let playerB = null;
let playersReady = { A: false, B: false };

// State management
let videoState = {
    A: { url: '', startTime: 0, volume: 100, loaded: false },
    B: { url: '', startTime: 0, volume: 100, offset: 0, loaded: false }
};

// Crossfade state
let crossfadeDuration = 2; // seconds
let isCrossfading = false;
let crossfadeStartTime = 0;

// YouTube API setup
function onYouTubeIframeAPIReady() {
    console.log('YouTube IFrame API ready');
    updateStatus('YouTube API loaded. Enter URLs and click Load.');
}

// Create player for a specific container
function createPlayer(containerId, playerId) {
    return new YT.Player(containerId, {
        height: '100%',
        width: '100%',
        playerVars: {
            autoplay: 0,
            controls: 1,
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            // Error 153 happens when YouTube can't identify the embedding site
            // (e.g. page opened via file://). Only send origin on http(s).
            ...(location.protocol.startsWith('http') ? { origin: location.origin } : {})
        },
        events: {
            'onReady': function(e) {
                onPlayerReady(e, playerId);
            },
            'onStateChange': function(e) {
                onPlayerStateChange(e, playerId);
            },
            'onError': function(e) {
                onPlayerError(e, playerId);
            }
        }
    });
}

// Player ready event handler
function onPlayerReady(event, playerId) {
    console.log(`Player ${playerId} ready`);
    playersReady[playerId] = true;

    const player = event.target;
    if (playerId === 'A') {
        playerA = player;
    } else {
        playerB = player;
    }

    // Set initial volume
    player.setVolume(videoState[playerId].volume);

    updateStatus(`Player ${playerId} ready`);

    // If both players are ready, check if we can load videos
    if (playersReady.A && playersReady.B) {
        const urlA = document.getElementById('urlA').value;
        const urlB = document.getElementById('urlB').value;
        if (urlA) loadVideoFromUrl('A', urlA);
        if (urlB) loadVideoFromUrl('B', urlB);
    }
}

// Player state change handler
function onPlayerStateChange(event, playerId) {
    const state = event.data;
    const player = event.target;
    console.log(`Player ${playerId} state changed to: ${state}`);
    videoState[playerId].loaded = true;
    if (playerId === 'B' && state === YT.PlayerState.PLAYING) {
        handleOffsetSync();
    }
}

// Player error handler
function onPlayerError(event, playerId) {
    console.error(`Player ${playerId} error:`, event.data);
    updateStatus(`Error loading video ${playerId}: ${event.data}`);
}

// Load video from URL input
function loadVideo(playerId) {
    const urlInput = document.getElementById(`url${playerId}`);
    const url = urlInput.value.trim();
    if (!url) {
        updateStatus(`Please enter a YouTube URL for player ${playerId}`);
        return;
    }
    loadVideoFromUrl(playerId, url);
}

// Extract video ID from URL and load
function loadVideoFromUrl(playerId, url) {
    const videoId = extractVideoId(url);
    if (!videoId) {
        updateStatus(`Invalid YouTube URL for player ${playerId}`);
        return;
    }
    videoState[playerId].url = url;
    if (!playersReady[playerId]) {
        createPlayer(`player${playerId}`, playerId);
    }
    const player = playerId === 'A' ? playerA : playerB;
    if (player) {
        player.loadVideoById(videoId, videoState[playerId].startTime);
        player.setVolume(videoState[playerId].volume);
        updateStatus(`Loading video ${playerId}`);
    }
    document.getElementById(`url${playerId}`).value = url;
}

// Extract YouTube video ID from URL
function extractVideoId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|shorts\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// Update status message
function updateStatus(message) {
    document.getElementById('statusText').textContent = message;
    console.log(message);
}

// Play both videos
function playBoth() {
    if (playerA && playerA.getVideoUrl) {
        const startA = parseFloat(document.getElementById('startA').value) || 0;
        playerA.seekTo(startA);
        playerA.playVideo();
    }
    if (playerB && playerB.getVideoUrl) {
        const startB = parseFloat(document.getElementById('startB').value) || 0;
        const offset = parseFloat(document.getElementById('offsetB').value) || 0;
        playerB.seekTo(startB + offset);
        playerB.playVideo();
    }
    updateStatus('Playing both videos');
}

// Pause both videos
function pauseBoth() {
    if (playerA) playerA.pauseVideo();
    if (playerB) playerB.pauseVideo();
    updateStatus('Paused both videos');
}

// Sync play with offset
function syncPlay() {
    if (!playerA || !playerB) {
        updateStatus('Both players need videos loaded');
        return;
    }
    const startA = parseFloat(document.getElementById('startA').value) || 0;
    const startB = parseFloat(document.getElementById('startB').value) || 0;
    const offset = parseFloat(document.getElementById('offsetB').value) || 0;
    const actualStartA = startA;
    const actualStartB = startA + offset + startB;
    playerA.seekTo(actualStartA);
    playerB.seekTo(actualStartB);
    startCrossfade();
    playerA.playVideo();
    playerB.playVideo();
    updateStatus(`Sync playing: A at ${actualStartA}s, B at ${actualStartB}s`);
}

// Handle offset synchronization
function handleOffsetSync() {
    if (!playerA || !playerB) return;
    const offset = parseFloat(document.getElementById('offsetB').value) || 0;
    const startA = parseFloat(document.getElementById('startA').value) || 0;
    const startB = parseFloat(document.getElementById('startB').value) || 0;
    if (playerB.getPlayerState() === YT.PlayerState.PLAYING) {
        const currentTimeB = playerB.getCurrentTime();
        const expectedTimeA = currentTimeB - offset - startB + startA;
        if (expectedTimeA > 0) {
            playerA.seekTo(expectedTimeA);
            playerA.playVideo();
        }
    }
}

// Start crossfade between videos
function startCrossfade() {
    if (!playerA || !playerB) return;
    const duration = parseFloat(document.getElementById('crossfade').value) || 0;
    crossfadeDuration = duration;
    if (duration <= 0) {
        const volumeA = parseInt(document.getElementById('volumeA').value) || 100;
        const volumeB = parseInt(document.getElementById('volumeB').value) || 100;
        playerA.setVolume(volumeA);
        playerB.setVolume(volumeB);
        return;
    }
    isCrossfading = true;
    crossfadeStartTime = Date.now();
    animateCrossfade();
}

// Animate crossfade
function animateCrossfade() {
    if (!isCrossfading || !playerA || !playerB) return;
    const elapsed = (Date.now() - crossfadeStartTime) / 1000;
    const progress = Math.min(elapsed / crossfadeDuration, 1);
    const volumeA = parseInt(document.getElementById('volumeA').value) || 100;
    const volumeB = parseInt(document.getElementById('volumeB').value) || 100;
    const newVolumeA = Math.round(volumeA * (1 - progress));
    const newVolumeB = Math.round(volumeB * progress);
    playerA.setVolume(newVolumeA);
    playerB.setVolume(newVolumeB);
    updateFadeIndicators(progress);
    if (progress < 1) {
        requestAnimationFrame(animateCrossfade);
    } else {
        isCrossfading = false;
    }
}

// Update visual fade indicators
function updateFadeIndicators(progress) {
    const fadeA = document.getElementById('fadeA');
    const fadeB = document.getElementById('fadeB');
    if (fadeA && fadeB) {
        const widthA = 100 - (progress * 100);
        const widthB = progress * 100;
        fadeA.style.width = `${widthA}%`;
        fadeB.style.width = `${widthB}%`;
    }
}

// Reset players
function resetPlayers() {
    if (playerA) {
        playerA.stopVideo();
        playerA.seekTo(0);
    }
    if (playerB) {
        playerB.stopVideo();
        playerB.seekTo(0);
    }
    document.getElementById('startA').value = 0;
    document.getElementById('startB').value = 0;
    document.getElementById('offsetB').value = 0;
    document.getElementById('volumeA').value = 100;
    document.getElementById('volumeB').value = 100;
    document.getElementById('crossfade').value = 2;
    document.getElementById('fadeA').style.width = '50%';
    document.getElementById('fadeB').style.width = '50%';
    document.getElementById('volumeValueA').textContent = '100%';
    document.getElementById('volumeValueB').textContent = '100%';
    document.getElementById('crossfadeValue').textContent = '2s';
    videoState.A.startTime = 0;
    videoState.B.startTime = 0;
    videoState.B.offset = 0;
    crossfadeDuration = 2;
    isCrossfading = false;
    updateStatus('Players reset');
}

// Event listeners for controls
window.addEventListener('DOMContentLoaded', function() {
    const volumeA = document.getElementById('volumeA');
    const volumeB = document.getElementById('volumeB');
    const volumeValueA = document.getElementById('volumeValueA');
    const volumeValueB = document.getElementById('volumeValueB');
    volumeA.addEventListener('input', function() {
        const value = this.value;
        volumeValueA.textContent = `${value}%`;
        videoState.A.volume = parseInt(value);
        if (playerA) playerA.setVolume(parseInt(value));
    });
    volumeB.addEventListener('input', function() {
        const value = this.value;
        volumeValueB.textContent = `${value}%`;
        videoState.B.volume = parseInt(value);
        if (playerB) playerB.setVolume(parseInt(value));
    });
    const crossfade = document.getElementById('crossfade');
    const crossfadeValue = document.getElementById('crossfadeValue');
    crossfade.addEventListener('input', function() {
        const value = this.value;
        crossfadeValue.textContent = `${value}s`;
        crossfadeDuration = parseFloat(value);
    });
    const startA = document.getElementById('startA');
    const startB = document.getElementById('startB');
    const offsetB = document.getElementById('offsetB');
    startA.addEventListener('change', function() {
        videoState.A.startTime = parseFloat(this.value) || 0;
    });
    startB.addEventListener('change', function() {
        videoState.B.startTime = parseFloat(this.value) || 0;
    });
    offsetB.addEventListener('change', function() {
        videoState.B.offset = parseFloat(this.value) || 0;
    });
    document.getElementById('urlA').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') loadVideo('A');
    });
    document.getElementById('urlB').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') loadVideo('B');
    });
    if (typeof YT === 'object' && YT.Player) {
        createPlayer('playerA', 'A');
        createPlayer('playerB', 'B');
    }
    updateStatus('Ready to load YouTube videos');
});

// Make functions globally available
window.loadVideo = loadVideo;
window.playBoth = playBoth;
window.pauseBoth = pauseBoth;
window.syncPlay = syncPlay;
window.resetPlayers = resetPlayers;