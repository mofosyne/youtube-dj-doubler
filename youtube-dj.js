// YouTube DJ Doubler - Basic mode with mix timeline
//
// Model: one shared "mix clock" in seconds. Each video is a lane on that clock.
//   offset = (mix time B starts) - (mix time A starts); negative means B leads.
//   A lane's origin (mix time at which its start point plays) is max(0, -offset) for A
//   and max(0, offset) for B.
//   The crossfade is one curve of (mix time, x) points, x = 0 -> only A, x = 1 -> only B.

const IDS = ['A', 'B'];
const DEFAULT_LANE_SECONDS = 180; // used until the real duration is known

let playerA = null;
let playerB = null;
const playersReady = { A: false, B: false };
const playerCreating = { A: false, B: false };

const videoState = {
    A: { url: '', volume: 100, duration: 0 },
    B: { url: '', volume: 100, duration: 0 }
};

function defaultCurve() {
    return [{ t: 0, x: 0 }, { t: 20, x: 0 }, { t: 30, x: 1 }];
}
let curve = defaultCurve();

const mix = {
    playing: false,
    preparing: false,
    token: 0,
    t: 0,          // current playhead in mix seconds
    tAt0: 0,
    perf0: 0,
    timer: null,
    started: { A: false, B: false },
    startedAt: { A: 0, B: 0 },
    lastVol: { A: -1, B: -1 }
};

const taps = { A: [], B: [] };
const markers = { A: [], B: [] }; // seconds into each video, kept sorted

// ---------- small helpers ----------
const $ = (id) => document.getElementById(id);
const num = (id, def = 0) => {
    const v = parseFloat($(id).value);
    return isNaN(v) ? def : v;
};
const getPlayer = (id) => (id === 'A' ? playerA : playerB);
const startOf = (id) => num('start' + id);
const endOf = (id) => Math.max(0, num('end' + id)); // 0 = play to the end of the video
const bpmOf = (id) => num('bpm' + id);
const beatOf = (id) => num('beat' + id);
const getOffset = () => num('offsetB');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Playback speed of a video (1 = normal). A lane's length on the mix timeline is its
// video length divided by this, and video time -> mix time is (v - start) / rate.
function rateOf(id) {
    const r = parseFloat($('rate' + id).value);
    return isFinite(r) && r > 0 ? clamp(r, 0.25, 2) : 1;
}

// Mix time at which each lane's start point plays. `shift` (hidden, saved) is the mix time of the
// earlier lane, so editing a lane never slides the crossfade curve away from the music.
function origins() {
    const o = getOffset();
    const shift = Math.max(0, num('shift'));
    return { A: shift + Math.max(0, -o), B: shift + Math.max(0, o) };
}

// Set both lanes' absolute origins (mix seconds) by updating offset + shift.
function applyOrigins(oA, oB) {
    $('offsetB').value = Math.round((oB - oA) * 1000) / 1000;
    $('shift').value = Math.round(Math.max(0, Math.min(oA, oB)) * 1000) / 1000;
}

// Video second at which the clip stops (its end flag, or the end of the video).
function endVideo(id) {
    const d = videoState[id].duration;
    const e = endOf(id);
    if (e > 0) return d > 0 ? Math.min(e, d) : e;
    return d > 0 ? d : startOf(id) + DEFAULT_LANE_SECONDS;
}

function laneLength(id) {
    return Math.max(1, (endVideo(id) - startOf(id)) / rateOf(id));
}

// Overall play range on the mix: the start/end lines across both lanes. 0 = not set
// (start at 0:00, end when both clips have finished).
function contentEnd() {
    const o = origins();
    return Math.max(o.A + laneLength('A'), o.B + laneLength('B'));
}
const mixStart = () => Math.max(0, num('rangeStart'));
function mixEnd() {
    const e = num('rangeEnd');
    return e > 0 ? e : contentEnd();
}

function fmtTime(t) {
    t = Math.max(0, t);
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

function updateStatus(message) {
    $('statusText').textContent = message;
    console.log(message);
}

// ---------- YouTube API ----------
function onYouTubeIframeAPIReady() {
    console.log('YouTube IFrame API ready');
    updateStatus('YouTube API loaded. Enter URLs and click Load.');
    loadPendingVideos();
}

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
            onReady: (e) => onPlayerReady(e, playerId),
            onStateChange: (e) => onPlayerStateChange(e, playerId),
            onError: (e) => onPlayerError(e, playerId)
        }
    });
}

function onPlayerReady(event, playerId) {
    playersReady[playerId] = true;
    playerCreating[playerId] = false;
    if (playerId === 'A') playerA = event.target; else playerB = event.target;
    updateDuration(playerId);
    applyVolumes(true);
    applyRate(playerId);
    if (loadState[playerId] === 'loading' && event.target.getPlayerState() === 5) forceLoad(playerId);
}

function onPlayerStateChange(event, playerId) {
    updateDuration(playerId);
    if (event.data === 5 && loadState[playerId] === 'loading') forceLoad(playerId);
}

function updateDuration(playerId) {
    const p = getPlayer(playerId);
    if (!p || !p.getDuration) return;
    const d = p.getDuration();
    if (d > 0 && d !== videoState[playerId].duration) {
        videoState[playerId].duration = d;
        renderTimeline();
    }
}

const ERROR_TEXT = {
    2: 'invalid video ID',
    5: 'HTML5 player error',
    100: 'video not found or private',
    101: 'the owner does not allow embedding',
    150: 'the owner does not allow embedding',
    153: 'embedding blocked (no valid referrer - open the page over http/https, not file://)'
};

function onPlayerError(event, playerId) {
    console.error(`Player ${playerId} error:`, event.data);
    const why = ERROR_TEXT[event.data] ? ` - ${ERROR_TEXT[event.data]}` : '';
    updateStatus(`Error loading video ${playerId}: ${event.data}${why}`);
    forcing[playerId] = false;
    setLoadState(playerId, 'error');
    showPlayerMessage(playerId, event.data);
}

// Show the problem on the video itself (the status line is easy to miss).
function showPlayerMessage(playerId, code) {
    clearPlayerMessage(playerId);
    const frame = document.getElementById('player' + playerId); // the iframe that replaced the div
    if (!frame || !frame.parentElement) return;
    const blocked = code === 101 || code === 150;
    const box = document.createElement('div');
    box.className = 'player-msg';
    box.dataset.player = playerId;
    box.textContent = blocked
        ? "This video can't be embedded: the owner turned embedding off. Try another upload of the track " +
          "(auto-generated \"Topic\" and label uploads are often blocked). "
        : `YouTube could not play this video (${ERROR_TEXT[code] || 'error ' + code}). `;
    const vid = extractVideoId(videoState[playerId].url);
    if (vid) {
        const a = document.createElement('a');
        a.href = `https://www.youtube.com/watch?v=${vid}`;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = 'Open on YouTube';
        box.appendChild(a);
    }
    frame.parentElement.appendChild(box);
}

function clearPlayerMessage(playerId) {
    document.querySelectorAll(`.player-msg[data-player="${playerId}"]`).forEach((n) => n.remove());
}

function loadVideo(playerId) {
    const url = $(`url${playerId}`).value.trim();
    if (!url) {
        updateStatus(`Please enter a YouTube URL for player ${playerId}`);
        return;
    }
    loadVideoFromUrl(playerId, url);
}

function loadVideoFromUrl(playerId, url) {
    const videoId = extractVideoId(url);
    if (!videoId) {
        updateStatus(`Invalid YouTube URL for player ${playerId}`);
        return;
    }
    videoState[playerId].url = url;
    clearPlayerMessage(playerId);
    setLoadState(playerId, 'loading');
    forcing[playerId] = false;
    scheduleSave();
    videoState[playerId].duration = 0;
    $(`url${playerId}`).value = url;

    const existing = getPlayer(playerId);
    if (existing) {
        existing.cueVideoById(videoId, startOf(playerId));
        updateStatus(`Loaded video ${playerId}`);
        renderTimeline();
        return;
    }
    if (playerCreating[playerId]) return;
    if (typeof YT === 'undefined' || !YT.Player) {
        updateStatus('YouTube API is still loading, try again in a moment.');
        return;
    }
    // Create the player directly with the video (an embed with no video shows a generic error)
    playerCreating[playerId] = true;
    createPlayer(`player${playerId}`, playerId, videoId, startOf(playerId));
    updateStatus(`Loading video ${playerId}`);
}

function extractVideoId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|shorts\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// ---------- crossfade curve ----------
function curveAt(t) {
    if (t <= curve[0].t) return curve[0].x;
    for (let i = 1; i < curve.length; i++) {
        if (t <= curve[i].t) {
            const a = curve[i - 1], b = curve[i];
            const span = b.t - a.t;
            return span <= 0 ? b.x : a.x + (b.x - a.x) * ((t - a.t) / span);
        }
    }
    return curve[curve.length - 1].x;
}

function gainsAt(t) {
    // Monitor overrides for beat checking (not saved, so a reload always starts in Mix)
    const monitor = $('monitor').value;
    if (monitor === 'a') return { A: 1, B: 0 };
    if (monitor === 'b') return { A: 0, B: 1 };
    if (monitor === 'both') return { A: 1, B: 1 };
    const x = curveAt(t);
    if ($('mixMode').value === 'linear') return { A: 1 - x, B: x };
    return { A: Math.cos(x * Math.PI / 2), B: Math.sin(x * Math.PI / 2) };
}

function applyVolumes(force) {
    const g = gainsAt(mix.t);
    IDS.forEach((id) => {
        const vol = Math.round(videoState[id].volume * g[id]);
        const p = getPlayer(id);
        if (p && p.setVolume && (force || vol !== mix.lastVol[id])) {
            p.setVolume(vol);
            mix.lastVol[id] = vol;
        }
    });
    $('fadeA').style.width = `${g.A * 100}%`;
    $('fadeB').style.width = `${g.B * 100}%`;
}

// ---------- beat helpers ----------
// Mix time of the beat nearest to t on lane `id` (needs a BPM).
function nearestBeatMix(id, t) {
    const bpm = bpmOf(id);
    if (bpm <= 0) return t;
    const p = 60 / bpm / rateOf(id);                         // beat spacing on the mix timeline
    const base = origins()[id] + (beatOf(id) - startOf(id)) / rateOf(id); // mix time of beat 0
    const k = Math.round((t - base) / p);
    return base + k * p;
}

// Snap a proposed offset so B's first visible beat lands on one of A's beats.
function snapOffset(raw, fine) {
    const bpmA = bpmOf('A'), bpmB = bpmOf('B');
    if (!fine && bpmA > 0 && bpmB > 0) {
        const rA = rateOf('A'), rB = rateOf('B');
        const pB = 60 / bpmB;
        const bOrigin = Math.max(0, raw);
        const k0 = Math.ceil((startOf('B') - beatOf('B')) / pB);
        const bFirst = bOrigin + (beatOf('B') + k0 * pB - startOf('B')) / rB;
        const pAm = 60 / bpmA / rA;                       // A's beat spacing on the mix timeline
        const aOrigin = Math.max(0, -raw);
        const aBase = aOrigin + (beatOf('A') - startOf('A')) / rA;
        const aBeat = aBase + Math.round((bFirst - aBase) / pAm) * pAm;
        return Math.round((raw - (bFirst - aBeat)) * 1000) / 1000;
    }
    const step = fine ? 0.01 : 0.1;
    return Math.round(raw / step) * step;
}

function tapTempo(id) {
    const now = performance.now();
    const list = taps[id];
    if (list.length && now - list[list.length - 1] > 2000) list.length = 0;
    list.push(now);
    if (list.length > 8) list.shift();
    if (list.length >= 2) {
        const avg = (list[list.length - 1] - list[0]) / (list.length - 1);
        $('bpm' + id).value = (60000 / avg).toFixed(1);
        renderTimeline();
    }
}

// "Solo" next to Tap: hear only this video while measuring; press again to go back to Mix.
function toggleSolo(id) {
    const mode = id.toLowerCase();
    $('monitor').value = $('monitor').value === mode ? 'mix' : mode;
    syncSoloButtons();
    applyVolumes(true);
}

function syncSoloButtons() {
    IDS.forEach((id) => {
        $('solo' + id).classList.toggle('active', $('monitor').value === id.toLowerCase());
    });
}

// ---------- markers (cue points inside a clip, e.g. where the vocals start) ----------
function addMarker(id) {
    const p = getPlayer(id);
    if (!p || !p.getCurrentTime) {
        updateStatus(`Load video ${id} first`);
        return;
    }
    const t = Math.round(p.getCurrentTime() * 100) / 100;
    if (markers[id].some((m) => Math.abs(m - t) < 0.05)) return;
    markers[id].push(t);
    markers[id].sort((a, b) => a - b);
    renderTimeline();
    updateStatus(`Marker added to video ${id} at ${fmtTime(t)}`);
}

function clearMarkers(id) {
    markers[id] = [];
    selectedMarker = null;
    syncFrom = null;
    renderTimeline();
}

function setFirstBeat(id) {
    const p = getPlayer(id);
    if (!p || !p.getCurrentTime) {
        updateStatus(`Load video ${id} first`);
        return;
    }
    $('beat' + id).value = p.getCurrentTime().toFixed(2);
    renderTimeline();
}

// ---------- speed & tempo matching ----------
// YouTube only accepts the speeds it offers (usually 0.25 steps), so after asking for a
// speed we read back what the player really took and show that.
function applyRate(id, done) {
    const p = getPlayer(id);
    if (!p || !p.setPlaybackRate) { if (done) done(); return; }
    const want = rateOf(id);
    p.setPlaybackRate(want);
    setTimeout(() => {
        const got = p.getPlaybackRate ? p.getPlaybackRate() : want;
        if (got && Math.abs(got - want) > 0.001) {
            $('rate' + id).value = got;
            renderTimeline();
        }
        if (mix.playing) startMix(mix.t); // re-sync the lanes at the new speed
        if (done) done();
    }, 150);
}

// Set this video's speed so its (BPM x speed) equals the other video's.
function matchTempo(id) {
    const other = id === 'A' ? 'B' : 'A';
    if (bpmOf(id) <= 0 || bpmOf(other) <= 0) {
        updateStatus('Set the BPM of both videos first (Beat grid section)');
        return;
    }
    const target = bpmOf(other) * rateOf(other);
    const rate = clamp(target / bpmOf(id), 0.25, 2);
    $('rate' + id).value = Math.round(rate * 1000) / 1000;
    renderTimeline();
    applyRate(id, () => {
        const mine = bpmOf(id) * rateOf(id);
        const off = Math.abs(mine - target) / target * 100;
        updateStatus(`Video ${id} at \u00d7${Math.round(rateOf(id) * 1000) / 1000} = ${mine.toFixed(1)} BPM, ` +
            `video ${other} = ${target.toFixed(1)} BPM` +
            (off > 0.3 ? ` (${off.toFixed(1)}% apart - closest speed YouTube allows)` : ' (matched)'));
    });
}

// ---------- loading: force-load each video, lock Play until ready ----------
// A video that is only "cued" has not loaded anything, and seeking it does nothing useful. So
// once it is cued we start it muted, wait until it really plays, pause it at its start point
// and unmute. Only then is the video "ready".
const FORCE_LOAD_TIMEOUT = 12000;  // ms to wait for the muted start
const LOAD_WATCHDOG = 25000;       // never lock Play for longer than this
const loadState = { A: 'none', B: 'none' }; // none | loading | ready | error
const forcing = { A: false, B: false };
const loadTimer = { A: null, B: null };

function setLoadState(id, s) {
    loadState[id] = s;
    clearTimeout(loadTimer[id]);
    if (s === 'loading') {
        loadTimer[id] = setTimeout(() => {
            if (loadState[id] === 'loading') {
                forcing[id] = false;
                setLoadState(id, 'ready');
                updateStatus(`Video ${id} is taking long to load; you can try Play anyway`);
            }
        }, LOAD_WATCHDOG);
    }
    const badge = $('loading' + id);
    if (badge) badge.hidden = s !== 'loading';
    updateTransport();
}

const isLoading = () => IDS.some((id) => loadState[id] === 'loading');

function updateTransport() {
    const locked = isLoading() || mix.preparing;
    ['playBoth', 'syncPlay'].forEach((bid) => {
        const b = $(bid);
        b.disabled = locked;
        b.title = locked ? (isLoading() ? 'Waiting for the videos to load' : 'Preparing playback') : '';
    });
    const play = $('playBoth');
    play.innerHTML = isLoading() ? '&#8987; Loading&hellip;' : mix.preparing ? '&#8987; Preparing&hellip;' : '&#9654; Play';
}

function waitFor(cond, timeoutMs, cb, minMs) {
    const t0 = performance.now();
    (function poll() {
        const elapsed = performance.now() - t0;
        if ((!minMs || elapsed >= minMs) && cond()) return cb(true);
        if (elapsed > timeoutMs) return cb(false);
        setTimeout(poll, 80);
    })();
}

function forceLoad(id) {
    const p = getPlayer(id);
    if (!p || forcing[id]) return;
    forcing[id] = true;
    updateStatus(`Loading video ${id} (muted pre-load)...`);
    if (p.mute) p.mute();
    p.seekTo(startOf(id), true);
    p.playVideo();
    const finish = (ok) => {
        if (p.unMute) p.unMute();
        forcing[id] = false;
        if (loadState[id] !== 'loading') return;
        setLoadState(id, 'ready');
        updateDuration(id);
        applyVolumes(true);
        applyRate(id);
        updateStatus(ok
            ? `Video ${id} loaded`
            : `Video ${id} could not be pre-loaded (your browser may block autoplay). Click its play button once, or press Play anyway.`);
    };
    waitFor(() => p.getPlayerState() === 1, FORCE_LOAD_TIMEOUT, (playing) => {
        p.pauseVideo();
        if (!playing) return finish(false);
        p.seekTo(startOf(id), true);
        waitFor(() => p.getPlayerState() === 2, 5000, finish, 250);
    });
}

// ---------- playback engine ----------
function startMix(t) {
    if (isLoading()) {
        updateStatus('Still loading the videos...');
        return;
    }
    if (!playerA && !playerB) {
        updateStatus('Load a video first');
        return;
    }
    clearInterval(mix.timer);
    mix.timer = null;
    mix.playing = false;
    // hard limit: playback always stays inside the start/end range
    if (t < mixStart() - 0.01 || t >= mixEnd()) t = mixStart();
    t = Math.max(0, t);
    const token = ++mix.token;

    // Prepare: park every lane at the spot it will play from and wait until it is buffered there,
    // so all lanes start together instead of loading while the clock is already running.
    mix.preparing = true;
    mix.t = t;
    updatePlayhead();
    updateTransport();
    updateStatus('Preparing playback...');
    const o = origins();
    const targets = {};
    IDS.forEach((id) => {
        const p = getPlayer(id);
        if (!p || !p.getPlayerState || loadState[id] === 'error') return;
        const pos = startOf(id) + Math.max(0, t - o[id]) * rateOf(id);
        const stopAt = endOf(id) > 0 ? endOf(id) : videoState[id].duration;
        if (stopAt && pos >= stopAt) return; // this lane has already finished at t
        targets[id] = pos;
        p.pauseVideo();
        p.seekTo(pos, true);
    });
    const settled = () => Object.keys(targets).every((id) => {
        const p = getPlayer(id);
        const s = p.getPlayerState();
        return (s === 2 || s === 5) && Math.abs(p.getCurrentTime() - targets[id]) < 1;
    });
    waitFor(settled, 6000, (ok) => {
        if (token !== mix.token) return; // paused or restarted meanwhile
        mix.preparing = false;
        updateTransport();
        beginMix(t);
        if (!ok) updateStatus('Started before every video finished buffering; it may catch up in a moment');
    }, 250);
}

function beginMix(t) {
    mix.t = t;
    mix.tAt0 = t;
    mix.perf0 = performance.now();
    mix.playing = true;
    mix.started = { A: false, B: false };
    mix.timer = setInterval(tick, 40);
    tick();
    updateStatus(`Playing mix from ${fmtTime(mix.t)}`);
}

function pauseMix() {
    mix.token++; // cancels a start that is still preparing
    mix.preparing = false;
    clearInterval(mix.timer);
    mix.timer = null;
    mix.playing = false;
    IDS.forEach((id) => {
        const p = getPlayer(id);
        if (p && p.pauseVideo) p.pauseVideo();
    });
    updateTransport();
    updatePlayhead();
}

function tick() {
    const t = mix.tAt0 + (performance.now() - mix.perf0) / 1000;
    mix.t = t;
    const o = origins();
    IDS.forEach((id) => {
        const p = getPlayer(id);
        if (!p || !p.getPlayerState) return;
        const start = startOf(id);
        const pos = start + (t - o[id]) * rateOf(id);
        const stopAt = endOf(id) > 0 ? endOf(id) : videoState[id].duration; // end flag or end of video
        if (pos < start) {
            // lane has not begun yet
            if (mix.started[id]) { p.pauseVideo(); mix.started[id] = false; }
            return;
        }
        if (stopAt && pos >= stopAt) {
            if (p.getPlayerState() === 1) p.pauseVideo();
            return;
        }
        if (!mix.started[id]) {
            if (p.setPlaybackRate) p.setPlaybackRate(rateOf(id));
            if (Math.abs(p.getCurrentTime() - pos) > 0.15) p.seekTo(pos, true);
            p.playVideo();
            mix.started[id] = true;
            mix.startedAt[id] = performance.now();
        } else if (performance.now() - mix.startedAt[id] > 1500 && p.getPlayerState() === 1) {
            if (Math.abs(p.getCurrentTime() - pos) > 0.4) p.seekTo(pos, true); // drift correction
        }
    });
    applyVolumes();
    // when zoomed in, scroll along with the playhead
    if (!view.fit && (t > view.t0 + view.span || t < view.t0)) {
        view.t0 = clamp(t - view.span * 0.1, 0, Math.max(0, view.extent - view.span));
        renderTimeline();
    }
    updatePlayhead();
    if (t >= mixEnd()) {
        pauseMix();
        mix.t = mixStart(); // ready to play the range again
        updatePlayhead();
        applyVolumes(true);
        updateStatus('Reached the end of the range');
    }
}

// Play always stays inside the start/end range: from the playhead if it is inside, else from the start line.
function playBoth() {
    const t = mix.t < mixStart() - 0.01 || mix.t >= mixEnd() - 0.05 ? mixStart() : mix.t;
    startMix(t);
}
function syncPlay() { startMix(mixStart()); }
function pauseBoth() {
    pauseMix();
    updateStatus('Paused');
}

function resetPlayers() {
    pauseMix();
    IDS.forEach((id) => {
        const p = getPlayer(id);
        if (p && p.seekTo) p.seekTo(startOf(id), true);
    });
    ['startA', 'startB', 'endA', 'endB', 'offsetB', 'shift', 'rangeStart', 'rangeEnd', 'beatA', 'beatB'].forEach((id) => { $(id).value = 0; });
    ['bpmA', 'bpmB'].forEach((id) => { $(id).value = ''; });
    IDS.forEach((id) => { $('rate' + id).value = 1; applyRate(id); });
    ['A', 'B'].forEach((id) => {
        $('volume' + id).value = 100;
        $('volumeValue' + id).textContent = '100%';
        videoState[id].volume = 100;
    });
    curve = defaultCurve();
    markers.A = []; markers.B = [];
    selectedMarker = null;
    syncFrom = null;
    mix.t = 0;
    applyVolumes(true);
    renderTimeline();
    updateStatus('Reset');
}

// ---------- timeline rendering ----------
const SVGNS = 'http://www.w3.org/2000/svg';
const LAYOUT = { pad: 12, rulerH: 22, laneH: 34, aY: 26, bY: 64, curveY: 106, curveH: 96, H: 210 };
// extent = whole mix in seconds; the visible window is [t0, t0 + span]. fit = show everything.
const view = { extent: 60, pps: 10, W: 600, playhead: null, fit: true, t0: 0, span: 60 };

function el(name, attrs, parent) {
    const e = document.createElementNS(SVGNS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
}

function timelineExtent() {
    // keep the scale fixed while a lane or flag is being dragged (otherwise it rescales under the pointer)
    if (drag && drag.extent) return drag.extent;
    const o = origins();
    const lastPt = curve[curve.length - 1].t;
    // both whole clips (as trimmed), the curve, and the playhead
    const need = Math.max(60, o.A + laneLength('A'), o.B + laneLength('B'), lastPt + 15, mix.t + 20, num('rangeEnd'));
    return Math.ceil(need / 30) * 30;
}

const xOf = (t) => LAYOUT.pad + (t - view.t0) * view.pps;
const tOf = (x) => view.t0 + (x - LAYOUT.pad) / view.pps;
const curveYOf = (v) => LAYOUT.curveY + 8 + (1 - v) * (LAYOUT.curveH - 16);
const curveVOf = (y) => clamp(1 - (y - LAYOUT.curveY - 8) / (LAYOUT.curveH - 16), 0, 1);

function renderTimeline() {
    const svg = $('timeline');
    if (!svg) return;
    const W = Math.max(300, svg.clientWidth || 600);
    view.W = W;
    view.extent = timelineExtent();
    if (view.fit) {
        view.t0 = 0;
        view.span = view.extent;
    } else {
        view.span = clamp(view.span, 2, view.extent);
        view.t0 = clamp(view.t0, 0, Math.max(0, view.extent - view.span));
    }
    view.pps = (W - 2 * LAYOUT.pad) / view.span;
    svg.setAttribute('width', W);
    svg.setAttribute('height', LAYOUT.H);
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // ruler
    el('rect', { x: 0, y: 0, width: W, height: LAYOUT.rulerH, class: 'tl-ruler', 'data-kind': 'ruler' }, svg);
    const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = steps.find((s) => s * view.pps >= 60) || 600;
    for (let t = Math.ceil(view.t0 / step) * step; t <= view.t0 + view.span; t += step) {
        el('line', { x1: xOf(t), x2: xOf(t), y1: 14, y2: LAYOUT.curveY + LAYOUT.curveH, class: 'tl-tick' }, svg);
        const label = el('text', { x: xOf(t) + 3, y: 11 }, svg);
        label.textContent = fmtTime(t).replace('.0', '');
    }

    // lanes
    const o = origins();
    drawLane(svg, 'A', LAYOUT.aY, o.A);
    drawLane(svg, 'B', LAYOUT.bY, o.B);

    // curve area
    el('rect', {
        x: LAYOUT.pad, y: LAYOUT.curveY, width: W - 2 * LAYOUT.pad, height: LAYOUT.curveH,
        class: 'tl-curve-bg', 'data-kind': 'curvebg'
    }, svg);
    const lb = el('text', { x: LAYOUT.pad + 4, y: LAYOUT.curveY + 12 }, svg);
    lb.textContent = 'B';
    const la = el('text', { x: LAYOUT.pad + 4, y: LAYOUT.curveY + LAYOUT.curveH - 4 }, svg);
    la.textContent = 'A';

    const pts = [];
    pts.push(`${LAYOUT.pad},${curveYOf(curve[0].x)}`);
    curve.forEach((p) => pts.push(`${xOf(p.t)},${curveYOf(p.x)}`));
    pts.push(`${W - LAYOUT.pad},${curveYOf(curve[curve.length - 1].x)}`);
    el('polyline', { points: pts.join(' '), class: 'tl-curve' }, svg);
    curve.forEach((p, i) => {
        el('circle', {
            cx: xOf(p.t), cy: curveYOf(p.x), r: 6, class: 'tl-point',
            'data-kind': 'point', 'data-index': i
        }, svg);
    });

    // overall start / end lines across both lanes and the curve
    const rs = mixStart(), re = mixEnd();
    const xs = xOf(rs), xe = xOf(re);
    const bottom = LAYOUT.curveY + LAYOUT.curveH;
    if (xs > 0) el('rect', { x: 0, y: LAYOUT.rulerH, width: Math.min(xs, W), height: bottom - LAYOUT.rulerH, class: 'tl-dim' }, svg);
    if (xe < W) el('rect', { x: Math.max(xe, 0), y: LAYOUT.rulerH, width: W - Math.max(xe, 0), height: bottom - LAYOUT.rulerH, class: 'tl-dim' }, svg);
    const rangeLine = (kind, x, label, dir) => {
        if (x < -2 || x > W + 2) return;
        el('line', { x1: x, x2: x, y1: 0, y2: bottom, class: 'tl-range' }, svg);
        el('polygon', { points: `${x},0 ${x + dir * 10},0 ${x},12`, class: 'tl-range-flag' }, svg);
        const t = el('text', { x: x + dir * 4, y: 21, 'text-anchor': dir > 0 ? 'start' : 'end', class: 'tl-range-text' }, svg);
        t.textContent = label;
        const hit = el('rect', { x: x - 9, y: 0, width: 18, height: LAYOUT.rulerH, class: 'tl-handle-hit', 'data-kind': kind }, svg);
        const tip = document.createElementNS(SVGNS, 'title');
        tip.textContent = `${label} of the mix: drag to move (Shift = no snapping). Play runs from start to end.`;
        hit.appendChild(tip);
    };
    rangeLine('rangestart', xs, 'start', 1);
    rangeLine('rangeend', xe, 'end', -1);

    // playhead
    view.playhead = el('line', { y1: 0, y2: LAYOUT.H, class: 'tl-playhead' }, svg);
    updatePlayhead();
    renderMinimap();
    scheduleSave();
}

function drawLane(svg, id, y, origin) {
    const x0 = xOf(origin);
    const w = laneLength(id) * view.pps;
    el('rect', {
        x: x0, y: y, width: w, height: LAYOUT.laneH, rx: 5,
        class: `tl-lane ${id}`, 'data-kind': 'lane', 'data-id': id
    }, svg);

    // beat grid: video times fb + k*p within [start, start + length]
    const bpm = bpmOf(id);
    const rate = rateOf(id);
    if (bpm > 0 && (60 / bpm / rate) * view.pps >= 4) {
        const p = 60 / bpm;
        const start = startOf(id);
        const fb = beatOf(id);
        const kMin = Math.ceil((start - fb) / p);
        const kMax = Math.floor((start + laneLength(id) * rate - fb) / p);
        for (let k = kMin; k <= kMax; k++) {
            const x = x0 + ((fb + k * p - start) / rate) * view.pps;
            if (x < 0 || x > view.W) continue;
            const isBar = ((k % 4) + 4) % 4 === 0;
            el('line', {
                x1: x, x2: x, y1: y + (isBar ? 2 : 10), y2: y + LAYOUT.laneH - (isBar ? 2 : 10),
                class: 'tl-beat' + (isBar ? ' bar' : '')
            }, svg);
        }
    }
    // markers: a flag at (origin + marker - start), only inside the visible part of the clip
    markers[id].forEach((m, i) => {
        if (m < startOf(id) || m > startOf(id) + laneLength(id) * rate) return;
        const x = x0 + ((m - startOf(id)) / rate) * view.pps;
        if (x < 0 || x > view.W) return;
        const isTarget = syncFrom && syncFrom.id !== id;
        el('line', { x1: x, x2: x, y1: y, y2: y + LAYOUT.laneH, class: 'tl-marker' + (isTarget ? ' target' : '') }, svg);
        el('polygon', { points: `${x},${y} ${x + 9},${y + 4} ${x},${y + 8}`, class: 'tl-marker-flag' + (isTarget ? ' target' : '') }, svg);
        const hit = el('rect', {
            x: x - 5, y: y, width: 14, height: LAYOUT.laneH, class: 'tl-marker-hit',
            'data-kind': 'marker', 'data-id': id, 'data-index': i
        }, svg);
        const tip = document.createElementNS(SVGNS, 'title');
        tip.textContent = `${fmtTime(m)} - click to jump, double-click to delete`;
        hit.appendChild(tip);
    });
    // start / end flags: drag to cut the clip there
    const handle = (kind, x, title) => {
        if (x < -2 || x > view.W + 2) return;
        el('rect', { x: x - 3, y: y + 2, width: 6, height: LAYOUT.laneH - 4, rx: 2, class: 'tl-handle ' + kind }, svg);
        const hit = el('rect', {
            x: x - 8, y: y, width: 16, height: LAYOUT.laneH, class: 'tl-handle-hit',
            'data-kind': kind, 'data-id': id
        }, svg);
        const tip = document.createElementNS(SVGNS, 'title');
        tip.textContent = title;
        hit.appendChild(tip);
    };
    handle('trimstart', x0, 'Start flag: drag to choose where this clip starts (Shift = no snapping)');
    handle('trimend', x0 + w, 'End flag: drag to choose where this clip ends (Shift = no snapping)');
    if (selectedMarker && selectedMarker.id === id && markers[id][selectedMarker.index] !== undefined) {
        const m = markers[id][selectedMarker.index];
        const x = x0 + ((m - startOf(id)) / rate) * view.pps;
        if (m >= startOf(id) && x >= 0 && x <= view.W) {
            const other = id === 'A' ? 'B' : 'A';
            const canSync = markers[other].length > 0;
            const px = Math.min(x + 12, view.W - (canSync ? 156 : 74));
            const pill = (kind, label, left, width) => {
                el('rect', {
                    x: left, y: y + 9, width, height: 17, rx: 8, class: 'tl-start-btn',
                    'data-kind': kind, 'data-id': id, 'data-index': selectedMarker.index
                }, svg);
                const t = el('text', { x: left + width / 2, y: y + 21, 'text-anchor': 'middle', class: 'tl-start-text' }, svg);
                t.textContent = label;
            };
            pill('markstart', 'Start here', px, 66);
            if (canSync) pill('marksync', syncFrom ? 'Pick target\u2026' : 'Sync to\u2026', px + 72, 78);
        }
    }
    const label = el('text', { x: Math.max(x0, LAYOUT.pad) + 6, y: y + 21 }, svg);
    const st = startOf(id);
    const notes = [];
    if (st > 0) notes.push(`starts at ${fmtTime(st)}`);
    if (endOf(id) > 0 && endOf(id) < (videoState[id].duration || Infinity)) notes.push(`ends at ${fmtTime(endOf(id))}`);
    if (Math.abs(rate - 1) > 0.0005) notes.push(`\u00d7${Math.round(rate * 1000) / 1000}`);
    label.textContent = notes.length ? `Video ${id} (${notes.join(', ')})` : `Video ${id}`;
}

function updatePlayhead() {
    if (view.playhead) {
        const x = xOf(mix.t);
        view.playhead.setAttribute('x1', x);
        view.playhead.setAttribute('x2', x);
    }
    const td = $('timeDisplay');
    if (td) td.textContent = fmtTime(mix.t);
    renderMinimap();
}

// ---------- zoom, pan and the overview strip ----------
function zoomBy(factor, anchor) {
    if (anchor === undefined) anchor = mix.t >= view.t0 && mix.t <= view.t0 + view.span ? mix.t : view.t0 + view.span / 2;
    const span = clamp(view.span / factor, 2, view.extent);
    const frac = (anchor - view.t0) / view.span;
    view.fit = span >= view.extent - 0.001;
    view.span = span;
    view.t0 = clamp(anchor - frac * span, 0, Math.max(0, view.extent - span));
    renderTimeline();
}

function panBy(dt) {
    if (view.span >= view.extent - 0.001) return;
    view.fit = false;
    view.t0 = clamp(view.t0 + dt, 0, Math.max(0, view.extent - view.span));
    renderTimeline();
}

function fitTimeline() {
    view.fit = true;
    renderTimeline();
}

const MINI_H = 18;
let miniDrag = null;

function renderMinimap() {
    const mini = $('minimap');
    if (!mini) return;
    const W = Math.max(100, mini.clientWidth || 600);
    mini.setAttribute('width', W);
    mini.setAttribute('height', MINI_H);
    while (mini.firstChild) mini.removeChild(mini.firstChild);
    const k = W / view.extent;
    const o = origins();
    el('rect', { x: 0, y: 0, width: W, height: MINI_H, rx: 4, class: 'mini-bg' }, mini);
    el('rect', { x: o.A * k, y: 3, width: laneLength('A') * k, height: 5, class: 'mini-lane A' }, mini);
    el('rect', { x: o.B * k, y: 10, width: laneLength('B') * k, height: 5, class: 'mini-lane B' }, mini);
    el('rect', {
        x: view.t0 * k, y: 0, width: Math.max(6, view.span * k), height: MINI_H, rx: 4,
        class: 'mini-window', 'data-kind': 'miniwin'
    }, mini);
    el('line', { x1: mix.t * k, x2: mix.t * k, y1: 0, y2: MINI_H, class: 'mini-playhead' }, mini);
}

function miniT(e) {
    const mini = $('minimap');
    return (e.clientX - mini.getBoundingClientRect().left) / Math.max(100, mini.clientWidth) * view.extent;
}

// ---------- timeline interaction ----------
let drag = null;
let lastPointTap = { index: -1, time: 0 };
let lastMarkerTap = { key: '', time: 0 };
let syncFrom = null;       // marker waiting to be synced to a marker on the other lane
let selectedMarker = null; // { id, index } - shows a "Start here" button next to it

function svgX(e) {
    return e.clientX - $('timeline').getBoundingClientRect().left;
}
function svgY(e) {
    return e.clientY - $('timeline').getBoundingClientRect().top;
}

function removePoint(i) {
    if (curve.length > 2) {
        curve.splice(i, 1);
        renderTimeline();
        applyVolumes();
    }
}

function onTimelineDown(e) {
    const kind = e.target.dataset.kind;
    if (!kind) return;
    const svg = $('timeline');
    svg.setPointerCapture(e.pointerId);
    if ((selectedMarker || syncFrom) && kind !== 'marker' && kind !== 'markstart' && kind !== 'marksync') {
        selectedMarker = null;
        syncFrom = null;
        renderTimeline();
    }

    if (kind === 'lane') {
        const id = e.target.dataset.id;
        const o = origins();
        drag = {
            kind, id, x0: svgX(e), extent: view.extent,
            o0: o[id],                       // mix time where this lane's start point plays
            s0: startOf(id),                 // start point (seconds into the clip)
            other: o[id === 'A' ? 'B' : 'A'] // the other lane stays put
        };
    } else if (kind === 'rangestart' || kind === 'rangeend') {
        drag = { kind, extent: view.extent };
    } else if (kind === 'trimstart' || kind === 'trimend') {
        const id = e.target.dataset.id;
        drag = {
            kind, id, x0: svgX(e), extent: view.extent,
            s0: startOf(id), e0: endVideo(id),
            o0: origins()[id], other: origins()[id === 'A' ? 'B' : 'A']
        };
    } else if (kind === 'marker') {
        const id = e.target.dataset.id;
        const i = parseInt(e.target.dataset.index, 10);
        if (syncFrom && syncFrom.id !== id) {
            // sync: shift the lanes so the selected marker lines up with this one
            const mine = { [syncFrom.id]: markers[syncFrom.id][syncFrom.index], [id]: markers[id][i] };
            const off = (mine.A - startOf('A')) / rateOf('A') - (mine.B - startOf('B')) / rateOf('B');
            const oA = origins().A;
            applyOrigins(oA, Math.max(0, oA + off));
            updateStatus(`Synced: A ${fmtTime(mine.A)} now lines up with B ${fmtTime(mine.B)}`);
            selectedMarker = null;
            syncFrom = null;
            lastMarkerTap = { key: '', time: 0 };
            renderTimeline();
            return;
        }
        syncFrom = null;
        const key = `${id}${i}`;
        const now = performance.now();
        if (lastMarkerTap.key === key && now - lastMarkerTap.time < 350) {
            lastMarkerTap = { key: '', time: 0 };
            markers[id].splice(i, 1);
            selectedMarker = null;
            renderTimeline();
            return;
        }
        lastMarkerTap = { key, time: now };
        selectedMarker = { id, index: i };
        const t = origins()[id] + (markers[id][i] - startOf(id)) / rateOf(id);
        renderTimeline();
        if (mix.playing) startMix(t); else { mix.t = t; updatePlayhead(); applyVolumes(); }
    } else if (kind === 'marksync') {
        syncFrom = { id: e.target.dataset.id, index: parseInt(e.target.dataset.index, 10) };
        renderTimeline();
        updateStatus(`Click a marker on video ${syncFrom.id === 'A' ? 'B' : 'A'} to line it up with this one`);
    } else if (kind === 'markstart') {
        // make this marker the clip's start point; the lane keeps its place on the mix,
        // so the marker now plays at the lane's left edge
        const id = e.target.dataset.id;
        let start = markers[id][parseInt(e.target.dataset.index, 10)];
        const dur = videoState[id].duration;
        if (dur > 0) start = Math.min(start, dur - 1);
        // Keep the clip lined up with the other one: cutting off the front moves the lane's
        // left edge forward by the cut length, so the music still sits where it was.
        const cut = Math.max(0, (start - startOf(id)) / rateOf(id));
        const oo = origins();
        if (id === 'B') applyOrigins(oo.A, oo.B + cut); else applyOrigins(oo.A + cut, oo.B);
        $('start' + id).value = start;
        selectedMarker = null;
        syncFrom = null;
        renderTimeline();
        updateStatus(`Video ${id} now starts at ${fmtTime(start)} (still lined up with the other clip)`);
    } else if (kind === 'ruler') {
        drag = { kind, wasPlaying: mix.playing };
        if (mix.playing) pauseMix();
        mix.t = Math.max(0, tOf(svgX(e)));
        updatePlayhead();
        applyVolumes();
    } else if (kind === 'point') {
        const i = parseInt(e.target.dataset.index, 10);
        const now = performance.now();
        if (lastPointTap.index === i && now - lastPointTap.time < 350) {
            lastPointTap = { index: -1, time: 0 };
            removePoint(i);
            return;
        }
        lastPointTap = { index: i, time: now };
        drag = { kind, index: i };
    } else if (kind === 'curvebg') {
        let t = Math.max(0, tOf(svgX(e)));
        if (!e.shiftKey && bpmOf('A') > 0) t = Math.max(0, nearestBeatMix('A', t));
        const pt = { t, x: curveVOf(svgY(e)) };
        let idx = curve.findIndex((p) => p.t > t);
        if (idx === -1) idx = curve.length;
        curve.splice(idx, 0, pt);
        drag = { kind: 'point', index: idx };
        renderTimeline();
        applyVolumes();
    }
}

function onTimelineMove(e) {
    if (!drag) return;
    if (drag.kind === 'lane') {
        const dt = (svgX(e) - drag.x0) / view.pps;
        // Moving left past 0:00 trims the front of the clip (the start point moves into
        // the clip); moving back right first un-trims, then slides the lane.
        let origin, start;
        const rate = rateOf(drag.id);
        if (dt >= 0) {
            if (dt * rate <= drag.s0) { start = drag.s0 - dt * rate; origin = drag.o0; }
            else { start = 0; origin = drag.o0 + (dt - drag.s0 / rate); }
        } else if (drag.o0 + dt >= 0) {
            start = drag.s0; origin = drag.o0 + dt;
        } else {
            start = drag.s0 - (drag.o0 + dt) * rate; origin = 0;
        }
        const dur = videoState[drag.id].duration;
        if (dur > 0) start = Math.min(start, dur - 1);
        start = Math.round(start * 1000) / 1000;
        $('start' + drag.id).value = start;

        const raw = drag.id === 'B' ? origin - drag.other : drag.other - origin;
        // each lane must still overlap the other and stay inside the visible timeline
        const maxOff = Math.max(0, Math.min(laneLength('A'), drag.extent - 2));
        const minOff = -Math.max(0, Math.min(laneLength('B'), drag.extent - 2));
        let off = clamp(snapOffset(clamp(raw, minOff, maxOff), e.shiftKey), minOff, maxOff);
        if (!e.shiftKey) {
            // snap so a marker on A lines up with a marker on B (within ~10px)
            const sA = drag.id === 'A' ? start : startOf('A');
            const sB = drag.id === 'B' ? start : startOf('B');
            let best = null;
            markers.A.forEach((ma) => markers.B.forEach((mb) => {
                if (ma < sA || mb < sB) return;
                const cand = (ma - sA) / rateOf('A') - (mb - sB) / rateOf('B');
                if (Math.abs(cand - raw) < 10 / view.pps && (best === null || Math.abs(cand - raw) < Math.abs(best - raw))) best = cand;
            }));
            if (best !== null) off = clamp(best, minOff, maxOff);
        }
        // the lane being dragged moves; the other one keeps its place on the mix
        if (drag.id === 'B') applyOrigins(drag.other, Math.max(0, drag.other + off));
        else applyOrigins(Math.max(0, drag.other - off), drag.other);
        renderTimeline();
    } else if (drag.kind === 'rangestart' || drag.kind === 'rangeend') {
        let t = tOf(svgX(e));
        if (!e.shiftKey) {
            // snap to markers and beats of either clip, within ~8px
            const tol = 8 / view.pps;
            let best = t, bestD = tol;
            IDS.forEach((id) => {
                markers[id].forEach((m) => {
                    const mt = origins()[id] + (m - startOf(id)) / rateOf(id);
                    if (Math.abs(mt - t) < bestD) { best = mt; bestD = Math.abs(mt - t); }
                });
                if (bpmOf(id) > 0) {
                    const bt = nearestBeatMix(id, t);
                    if (Math.abs(bt - t) < bestD) { best = bt; bestD = Math.abs(bt - t); }
                }
            });
            t = best;
        }
        if (drag.kind === 'rangestart') {
            t = clamp(t, 0, mixEnd() - 0.5);
            $('rangeStart').value = t < 0.01 ? 0 : Math.round(t * 1000) / 1000;
        } else {
            t = Math.max(t, mixStart() + 0.5);
            $('rangeEnd').value = t >= contentEnd() - 0.01 ? 0 : Math.round(t * 1000) / 1000; // at the very end = not set
        }
        renderTimeline();
    } else if (drag.kind === 'trimstart' || drag.kind === 'trimend') {
        const id = drag.id;
        const rate = rateOf(id);
        const dt = (svgX(e) - drag.x0) / view.pps;          // mix seconds
        const dur = videoState[id].duration;
        // snap (in video seconds) to this clip's own markers and beats, within ~8px
        const snapTo = (v) => {
            if (e.shiftKey) return v;
            const tol = 8 / view.pps * rate;
            let best = v, bestD = tol;
            markers[id].forEach((m) => { if (Math.abs(m - v) < bestD) { best = m; bestD = Math.abs(m - v); } });
            if (bpmOf(id) > 0) {
                const p = 60 / bpmOf(id);
                const b = beatOf(id) + Math.round((v - beatOf(id)) / p) * p;
                if (Math.abs(b - v) < bestD) best = b;
            }
            return best;
        };
        if (drag.kind === 'trimstart') {
            const s = Math.round(clamp(snapTo(drag.s0 + dt * rate), 0, drag.e0 - 1) * 1000) / 1000;
            // the lane's left edge moves by the cut length, so the music stays lined up
            const cut = (s - drag.s0) / rate;
            $('start' + id).value = s;
            if (id === 'B') applyOrigins(drag.other, drag.o0 + cut); else applyOrigins(drag.o0 + cut, drag.other);
        } else {
            let en = Math.round(clamp(snapTo(drag.e0 + dt * rate), startOf(id) + 1, dur > 0 ? dur : Infinity) * 1000) / 1000;
            $('end' + id).value = dur > 0 && en >= dur - 0.01 ? 0 : en; // back at the very end = no end flag
        }
        renderTimeline();
    } else if (drag.kind === 'ruler') {
        mix.t = Math.max(0, tOf(svgX(e)));
        updatePlayhead();
        applyVolumes();
    } else if (drag.kind === 'point') {
        const i = drag.index;
        let t = Math.max(0, tOf(svgX(e)));
        if (!e.shiftKey && bpmOf('A') > 0) t = Math.max(0, nearestBeatMix('A', t));
        const lo = i > 0 ? curve[i - 1].t + 0.05 : 0;
        const hi = i < curve.length - 1 ? curve[i + 1].t - 0.05 : Infinity;
        curve[i].t = clamp(t, lo, hi);
        curve[i].x = curveVOf(svgY(e));
        renderTimeline();
        applyVolumes();
    }
}

function onTimelineUp() {
    if (drag && drag.kind === 'ruler' && drag.wasPlaying) startMix(mix.t);
    drag = null;
}

// ---------- saved settings (localStorage + shareable link) ----------
const STORAGE_KEY = 'ytdj-basic-v1';
const SETTING_FIELDS = ['startA', 'startB', 'endA', 'endB', 'offsetB', 'shift', 'rangeStart', 'rangeEnd', 'bpmA', 'bpmB', 'beatA', 'beatB', 'rateA', 'rateB'];
let saveTimer = null;
const pendingLoad = {}; // video ids restored from settings, loaded once the YT API is ready

function collectSettings() {
    const round3 = (v) => Math.round(v * 1000) / 1000;
    const s = { f: {}, vol: {}, ids: {}, markers: { A: markers.A.slice(), B: markers.B.slice() }, mode: $('mixMode').value,
                curve: curve.map((p) => ({ t: round3(p.t), x: round3(p.x) })) };
    SETTING_FIELDS.forEach((id) => { s.f[id] = $(id).value; });
    IDS.forEach((id) => {
        s.vol[id] = videoState[id].volume;
        s.ids[id] = extractVideoId($('url' + id).value.trim()) || '';
    });
    return s;
}

// Compact hash format, e.g.  #a=ViMftVmc3Ts&b=yt1polx2D_4&o=3.5&bb=128&c=0:0,20:0,30:1
// Anything left at its default is omitted. (Old #s=<json> links are still read.)
const HASH_FIELDS = { startA: 'sa', startB: 'sb', endA: 'ea', endB: 'eb', offsetB: 'o', shift: 'sh', rangeStart: 'rs', rangeEnd: 're', bpmA: 'ba', bpmB: 'bb', beatA: 'fa', beatB: 'fb', rateA: 'ra', rateB: 'rb' };

function encodeHash(s) {
    const parts = [];
    IDS.forEach((id) => { if (s.ids[id]) parts.push(`${id.toLowerCase()}=${s.ids[id]}`); });
    for (const field in HASH_FIELDS) {
        const v = parseFloat(s.f[field]);
        const def = field.startsWith('rate') ? 1 : 0; // speed defaults to 1, everything else to 0
        if (!isNaN(v) && v !== def) parts.push(`${HASH_FIELDS[field]}=${v}`);
    }
    IDS.forEach((id) => { if (s.vol[id] !== 100) parts.push(`v${id.toLowerCase()}=${s.vol[id]}`); });
    IDS.forEach((id) => { if (s.markers[id].length) parts.push(`m${id.toLowerCase()}=${s.markers[id].join(',')}`); });
    if (s.mode === 'linear') parts.push('m=linear');
    if (JSON.stringify(s.curve) !== JSON.stringify(defaultCurve())) {
        parts.push('c=' + s.curve.map((p) => `${p.t}:${p.x}`).join(','));
    }
    return parts.join('&');
}

function decodeHash(str) {
    const kv = {};
    str.split('&').forEach((pair) => {
        const i = pair.indexOf('=');
        if (i > 0) kv[pair.slice(0, i)] = decodeURIComponent(pair.slice(i + 1));
    });
    const s = { f: {}, vol: {}, ids: { A: kv.a || '', B: kv.b || '' }, mode: kv.m || 'equal', markers: { A: [], B: [] } };
    IDS.forEach((id) => {
        const raw = kv[`m${id.toLowerCase()}`];
        if (raw) s.markers[id] = raw.split(',').map(parseFloat).filter(isFinite);
    });
    for (const field in HASH_FIELDS) s.f[field] = kv[HASH_FIELDS[field]] || (field.startsWith('bpm') ? '' : field.startsWith('rate') ? '1' : '0');
    s.vol.A = kv.va !== undefined ? kv.va : 100;
    s.vol.B = kv.vb !== undefined ? kv.vb : 100;
    if (kv.c) {
        s.curve = kv.c.split(',').map((pt) => {
            const [t, x] = pt.split(':');
            return { t: parseFloat(t), x: parseFloat(x) };
        });
    } else {
        s.curve = defaultCurve();
    }
    return s;
}

function hashLink(s) {
    const h = encodeHash(s);
    return h ? `#${h}` : '';
}

function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        const json = JSON.stringify(collectSettings());
        try { localStorage.setItem(STORAGE_KEY, json); } catch (e) { /* storage unavailable */ }
        // Keep the address bar in sync so the page URL is always a share link
        try { history.replaceState(null, '', location.pathname + location.search + hashLink(collectSettings())); } catch (e) { /* e.g. file:// */ }
    }, 300);
}

function applySettings(s) {
    if (!s || typeof s !== 'object') return;
    SETTING_FIELDS.forEach((id) => {
        if (s.f && s.f[id] !== undefined) $(id).value = s.f[id];
    });
    IDS.forEach((id) => {
        const v = s.vol && parseInt(s.vol[id], 10);
        if (!isNaN(v)) {
            videoState[id].volume = clamp(v, 0, 100);
            $('volume' + id).value = videoState[id].volume;
            $('volumeValue' + id).textContent = `${videoState[id].volume}%`;
        }
        const vid = s.ids && s.ids[id];
        if (typeof vid === 'string' && /^[\w-]{11}$/.test(vid)) {
            $('url' + id).value = `https://youtu.be/${vid}`;
            pendingLoad[id] = vid;
        }
    });
    IDS.forEach((id) => {
        const list = s.markers && s.markers[id];
        markers[id] = Array.isArray(list) ? list.filter((v) => isFinite(v) && v >= 0).map(Number).sort((a, b) => a - b) : [];
    });
    if (s.mode === 'linear' || s.mode === 'equal') $('mixMode').value = s.mode;
    mix.t = mixStart();
    if (Array.isArray(s.curve) && s.curve.length >= 2 &&
        s.curve.every((p) => isFinite(p.t) && isFinite(p.x))) {
        curve = s.curve.map((p) => ({ t: Math.max(0, +p.t), x: clamp(+p.x, 0, 1) }))
                       .sort((a, b) => a.t - b.t);
    }
}

function loadSavedSettings() {
    try {
        const legacy = location.hash.match(/^#s=(.+)$/);
        if (legacy) { applySettings(JSON.parse(decodeURIComponent(legacy[1]))); return; }
        if (location.hash.length > 1) { applySettings(decodeHash(location.hash.slice(1))); return; }
    } catch (e) { /* bad link: fall back to local storage */ }
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) applySettings(JSON.parse(raw));
    } catch (e) { /* ignore */ }
}

function loadPendingVideos() {
    if (typeof YT === 'undefined' || !YT.Player) return;
    IDS.forEach((id) => {
        if (pendingLoad[id]) {
            const vid = pendingLoad[id];
            delete pendingLoad[id];
            loadVideoFromUrl(id, `https://youtu.be/${vid}`);
        }
    });
}

function copyShareLink() {
    clearTimeout(saveTimer);
    const link = `${location.origin}${location.pathname}${hashLink(collectSettings())}`;
    const done = () => updateStatus('Share link copied to clipboard');
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(done, () => window.prompt('Copy this link:', link));
    } else {
        window.prompt('Copy this link:', link);
    }
}

// ---------- wiring ----------
window.addEventListener('DOMContentLoaded', function() {
    loadSavedSettings();

    ['A', 'B'].forEach((id) => {
        $('volume' + id).addEventListener('input', function() {
            $('volumeValue' + id).textContent = `${this.value}%`;
            videoState[id].volume = parseInt(this.value, 10);
            applyVolumes(true);
            scheduleSave();
        });
        $('url' + id).addEventListener('keypress', function(e) {
            if (e.key === 'Enter') loadVideo(id);
        });
    });

    ['startA', 'startB', 'endA', 'endB', 'offsetB', 'bpmA', 'bpmB', 'beatA', 'beatB', 'rateA', 'rateB'].forEach((id) => {
        $(id).addEventListener('input', renderTimeline);
    });
    IDS.forEach((id) => $('rate' + id).addEventListener('change', () => applyRate(id)));
    $('mixMode').addEventListener('change', () => { applyVolumes(true); scheduleSave(); });
    $('monitor').addEventListener('change', () => { syncSoloButtons(); applyVolumes(true); });

    const svg = $('timeline');
    svg.addEventListener('pointerdown', onTimelineDown);
    svg.addEventListener('pointermove', onTimelineMove);
    svg.addEventListener('pointerup', onTimelineUp);
    svg.addEventListener('pointercancel', onTimelineUp);
    svg.addEventListener('contextmenu', function(e) {
        if (e.target.dataset.kind === 'point') {
            e.preventDefault();
            removePoint(parseInt(e.target.dataset.index, 10));
        }
    });
    window.addEventListener('resize', renderTimeline);

    // zoom: Ctrl/Cmd + scroll (or pinch); pan: Shift + scroll or sideways scroll. Plain scroll still scrolls the page.
    svg.addEventListener('wheel', function(e) {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, tOf(svgX(e)));
        } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            e.preventDefault();
            panBy((e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) / view.pps);
        }
    }, { passive: false });

    const mini = $('minimap');
    mini.addEventListener('pointerdown', function(e) {
        mini.setPointerCapture(e.pointerId);
        let t = miniT(e);
        if (t < view.t0 || t > view.t0 + view.span) { // clicked outside the window: centre it there
            view.fit = view.span >= view.extent - 0.001;
            view.t0 = clamp(t - view.span / 2, 0, Math.max(0, view.extent - view.span));
            renderTimeline();
        }
        miniDrag = { grab: miniT(e) - view.t0 };
    });
    mini.addEventListener('pointermove', function(e) {
        if (!miniDrag || view.span >= view.extent - 0.001) return;
        view.fit = false;
        view.t0 = clamp(miniT(e) - miniDrag.grab, 0, Math.max(0, view.extent - view.span));
        renderTimeline();
    });
    ['pointerup', 'pointercancel'].forEach((n) => mini.addEventListener(n, () => { miniDrag = null; }));

    // Following a link that only changes the #... part (e.g. the example mix) loads it in place
    window.addEventListener('hashchange', function() {
        if (location.hash.length <= 1) return;
        pauseMix();
        loadSavedSettings();
        renderTimeline();
        applyVolumes(true);
        IDS.forEach((id) => applyRate(id));
        loadPendingVideos();
        updateStatus('Loaded mix from link');
    });

    // Space = play / pause (not while typing in a field)
    document.addEventListener('keydown', function(e) {
        if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
        const t = e.target;
        const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) &&
            !(t.tagName === 'INPUT' && (t.type === 'range' || t.type === 'checkbox'));
        if (typing) return;
        e.preventDefault(); // also stops a focused button from being "clicked" again
        if (mix.playing || mix.preparing) pauseBoth(); else if (isLoading()) updateStatus('Still loading the videos...'); else playBoth();
    });

    renderTimeline();
    applyVolumes(true);
    loadPendingVideos();
    updateStatus('Ready to load YouTube videos');
});

// Make functions globally available
window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;
window.loadVideo = loadVideo;
window.playBoth = playBoth;
window.pauseBoth = pauseBoth;
window.syncPlay = syncPlay;
window.resetPlayers = resetPlayers;
window.tapTempo = tapTempo;
window.setFirstBeat = setFirstBeat;
window.toggleSolo = toggleSolo;
window.zoomBy = zoomBy;
window.fitTimeline = fitTimeline;
window.matchTempo = matchTempo;
window.addMarker = addMarker;
window.clearMarkers = clearMarkers;
window.copyShareLink = copyShareLink;
