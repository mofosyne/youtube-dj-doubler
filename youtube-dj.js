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
const bpmOf = (id) => num('bpm' + id);
const beatOf = (id) => num('beat' + id);
const getOffset = () => num('offsetB');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function origins() {
    const o = getOffset();
    return { A: Math.max(0, -o), B: Math.max(0, o) };
}

function laneLength(id) {
    const d = videoState[id].duration;
    return Math.max(1, d > 0 ? d - startOf(id) : DEFAULT_LANE_SECONDS);
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
    updateStatus(`Player ${playerId} ready`);
}

function onPlayerStateChange(event, playerId) {
    updateDuration(playerId);
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
    const p = 60 / bpm;
    const base = origins()[id] + beatOf(id) - startOf(id); // mix time of beat 0
    const k = Math.round((t - base) / p);
    return base + k * p;
}

// Snap a proposed offset so B's first visible beat lands on one of A's beats.
function snapOffset(raw, fine) {
    const bpmA = bpmOf('A'), bpmB = bpmOf('B');
    if (!fine && bpmA > 0 && bpmB > 0) {
        const pB = 60 / bpmB;
        const bOrigin = Math.max(0, raw);
        const k0 = Math.ceil((startOf('B') - beatOf('B')) / pB);
        const bFirst = bOrigin + beatOf('B') + k0 * pB - startOf('B');
        const pA = 60 / bpmA;
        const aOrigin = Math.max(0, -raw);
        const j = Math.round((bFirst - aOrigin - beatOf('A') + startOf('A')) / pA);
        const aBeat = aOrigin + beatOf('A') + j * pA - startOf('A');
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

// ---------- playback engine ----------
function startMix(t) {
    if (!playerA && !playerB) {
        updateStatus('Load a video first');
        return;
    }
    clearInterval(mix.timer);
    mix.t = Math.max(0, t);
    mix.tAt0 = mix.t;
    mix.perf0 = performance.now();
    mix.playing = true;
    mix.started = { A: false, B: false };
    IDS.forEach((id) => {
        const p = getPlayer(id);
        if (p && p.pauseVideo) p.pauseVideo();
    });
    mix.timer = setInterval(tick, 40);
    tick();
    updateStatus(`Playing mix from ${fmtTime(mix.t)}`);
}

function pauseMix() {
    clearInterval(mix.timer);
    mix.timer = null;
    mix.playing = false;
    IDS.forEach((id) => {
        const p = getPlayer(id);
        if (p && p.pauseVideo) p.pauseVideo();
    });
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
        const pos = start + (t - o[id]);
        const dur = videoState[id].duration;
        if (pos < start) {
            // lane has not begun yet
            if (mix.started[id]) { p.pauseVideo(); mix.started[id] = false; }
            return;
        }
        if (dur && pos >= dur) {
            if (p.getPlayerState() === 1) p.pauseVideo();
            return;
        }
        if (!mix.started[id]) {
            p.seekTo(pos, true);
            p.playVideo();
            mix.started[id] = true;
            mix.startedAt[id] = performance.now();
        } else if (performance.now() - mix.startedAt[id] > 1500 && p.getPlayerState() === 1) {
            if (Math.abs(p.getCurrentTime() - pos) > 0.4) p.seekTo(pos, true); // drift correction
        }
    });
    applyVolumes();
    updatePlayhead();
    const end = Math.max(o.A + laneLength('A'), o.B + laneLength('B'));
    if (t > end) {
        pauseMix();
        updateStatus('Mix finished');
    }
}

function playBoth() { startMix(mix.t); }
function syncPlay() { startMix(0); }
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
    ['startA', 'startB', 'offsetB', 'beatA', 'beatB'].forEach((id) => { $(id).value = 0; });
    ['bpmA', 'bpmB'].forEach((id) => { $(id).value = ''; });
    ['A', 'B'].forEach((id) => {
        $('volume' + id).value = 100;
        $('volumeValue' + id).textContent = '100%';
        videoState[id].volume = 100;
    });
    curve = defaultCurve();
    markers.A = []; markers.B = [];
    mix.t = 0;
    applyVolumes(true);
    renderTimeline();
    updateStatus('Reset');
}

// ---------- timeline rendering ----------
const SVGNS = 'http://www.w3.org/2000/svg';
const LAYOUT = { pad: 12, rulerH: 22, laneH: 34, aY: 26, bY: 64, curveY: 106, curveH: 96, H: 210 };
const view = { extent: 60, pps: 10, W: 600, playhead: null };

function el(name, attrs, parent) {
    const e = document.createElementNS(SVGNS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
}

function timelineExtent() {
    // keep the scale fixed while a lane is being dragged (otherwise it rescales under the pointer)
    if (drag && drag.kind === 'lane') return drag.extent;
    const o = origins();
    const lastPt = curve[curve.length - 1].t;
    const need = Math.max(60, Math.abs(getOffset()) + 45, lastPt + 15, mix.t + 20);
    return Math.ceil(need / 30) * 30;
}

const xOf = (t) => LAYOUT.pad + t * view.pps;
const tOf = (x) => (x - LAYOUT.pad) / view.pps;
const curveYOf = (v) => LAYOUT.curveY + 8 + (1 - v) * (LAYOUT.curveH - 16);
const curveVOf = (y) => clamp(1 - (y - LAYOUT.curveY - 8) / (LAYOUT.curveH - 16), 0, 1);

function renderTimeline() {
    const svg = $('timeline');
    if (!svg) return;
    const W = Math.max(300, svg.clientWidth || 600);
    view.W = W;
    view.extent = timelineExtent();
    view.pps = (W - 2 * LAYOUT.pad) / view.extent;
    svg.setAttribute('width', W);
    svg.setAttribute('height', LAYOUT.H);
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // ruler
    el('rect', { x: 0, y: 0, width: W, height: LAYOUT.rulerH, class: 'tl-ruler', 'data-kind': 'ruler' }, svg);
    const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = steps.find((s) => s * view.pps >= 60) || 600;
    for (let t = 0; t <= view.extent; t += step) {
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
    pts.push(`${xOf(view.extent)},${curveYOf(curve[curve.length - 1].x)}`);
    el('polyline', { points: pts.join(' '), class: 'tl-curve' }, svg);
    curve.forEach((p, i) => {
        el('circle', {
            cx: xOf(p.t), cy: curveYOf(p.x), r: 6, class: 'tl-point',
            'data-kind': 'point', 'data-index': i
        }, svg);
    });

    // playhead
    view.playhead = el('line', { y1: 0, y2: LAYOUT.H, class: 'tl-playhead' }, svg);
    updatePlayhead();
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
    if (bpm > 0 && (60 / bpm) * view.pps >= 4) {
        const p = 60 / bpm;
        const start = startOf(id);
        const fb = beatOf(id);
        const kMin = Math.ceil((start - fb) / p);
        const kMax = Math.floor((start + laneLength(id) - fb) / p);
        for (let k = kMin; k <= kMax; k++) {
            const x = x0 + (fb + k * p - start) * view.pps;
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
        if (m < startOf(id) || m > startOf(id) + laneLength(id)) return;
        const x = x0 + (m - startOf(id)) * view.pps;
        if (x < 0 || x > view.W) return;
        el('line', { x1: x, x2: x, y1: y, y2: y + LAYOUT.laneH, class: 'tl-marker' }, svg);
        el('polygon', { points: `${x},${y} ${x + 9},${y + 4} ${x},${y + 8}`, class: 'tl-marker-flag' }, svg);
        const hit = el('rect', {
            x: x - 5, y: y, width: 14, height: LAYOUT.laneH, class: 'tl-marker-hit',
            'data-kind': 'marker', 'data-id': id, 'data-index': i
        }, svg);
        const tip = document.createElementNS(SVGNS, 'title');
        tip.textContent = `${fmtTime(m)} - click to jump, double-click to delete`;
        hit.appendChild(tip);
    });
    const label = el('text', { x: Math.max(x0, LAYOUT.pad) + 6, y: y + 21 }, svg);
    const st = startOf(id);
    label.textContent = st > 0 ? `Video ${id} (starts at ${fmtTime(st)})` : `Video ${id}`;
}

function updatePlayhead() {
    if (view.playhead) {
        const x = xOf(mix.t);
        view.playhead.setAttribute('x1', x);
        view.playhead.setAttribute('x2', x);
    }
    const td = $('timeDisplay');
    if (td) td.textContent = fmtTime(mix.t);
}

// ---------- timeline interaction ----------
let drag = null;
let lastPointTap = { index: -1, time: 0 };
let lastMarkerTap = { key: '', time: 0 };

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

    if (kind === 'lane') {
        const id = e.target.dataset.id;
        const o = origins();
        drag = {
            kind, id, x0: svgX(e), extent: view.extent,
            o0: o[id],                       // mix time where this lane's start point plays
            s0: startOf(id),                 // start point (seconds into the clip)
            other: o[id === 'A' ? 'B' : 'A'] // the other lane stays put
        };
    } else if (kind === 'marker') {
        const id = e.target.dataset.id;
        const i = parseInt(e.target.dataset.index, 10);
        const key = `${id}${i}`;
        const now = performance.now();
        if (lastMarkerTap.key === key && now - lastMarkerTap.time < 350) {
            lastMarkerTap = { key: '', time: 0 };
            markers[id].splice(i, 1);
            renderTimeline();
            return;
        }
        lastMarkerTap = { key, time: now };
        const t = origins()[id] + markers[id][i] - startOf(id);
        if (mix.playing) startMix(t); else { mix.t = t; updatePlayhead(); applyVolumes(); }
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
        if (dt >= 0) {
            if (dt <= drag.s0) { start = drag.s0 - dt; origin = drag.o0; }
            else { start = 0; origin = drag.o0 + (dt - drag.s0); }
        } else if (drag.o0 + dt >= 0) {
            start = drag.s0; origin = drag.o0 + dt;
        } else {
            start = drag.s0 - (drag.o0 + dt); origin = 0;
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
                const cand = (ma - sA) - (mb - sB);
                if (Math.abs(cand - raw) < 10 / view.pps && (best === null || Math.abs(cand - raw) < Math.abs(best - raw))) best = cand;
            }));
            if (best !== null) off = clamp(best, minOff, maxOff);
        }
        $('offsetB').value = Math.round(off * 1000) / 1000;
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
const SETTING_FIELDS = ['startA', 'startB', 'offsetB', 'bpmA', 'bpmB', 'beatA', 'beatB'];
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
const HASH_FIELDS = { startA: 'sa', startB: 'sb', offsetB: 'o', bpmA: 'ba', bpmB: 'bb', beatA: 'fa', beatB: 'fb' };

function encodeHash(s) {
    const parts = [];
    IDS.forEach((id) => { if (s.ids[id]) parts.push(`${id.toLowerCase()}=${s.ids[id]}`); });
    for (const field in HASH_FIELDS) {
        const v = parseFloat(s.f[field]);
        if (!isNaN(v) && v !== 0) parts.push(`${HASH_FIELDS[field]}=${v}`);
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
    for (const field in HASH_FIELDS) s.f[field] = kv[HASH_FIELDS[field]] || (field.startsWith('bpm') ? '' : '0');
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

    ['startA', 'startB', 'offsetB', 'bpmA', 'bpmB', 'beatA', 'beatB'].forEach((id) => {
        $(id).addEventListener('input', renderTimeline);
    });
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
window.addMarker = addMarker;
window.clearMarkers = clearMarkers;
window.copyShareLink = copyShareLink;
