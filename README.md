# YouTube DJ Doubler

A web-based application that lets you mix YouTube videos like a DJ, with both basic and advanced sample-based modes.

## Features

### Basic Mode
- **Dual Video Players**: Load two YouTube videos simultaneously
- **Mix Timeline**: Two lanes on one shared clock. Drag lane A or B to shift them (negative offsets allowed). Dragging a lane left past 0:00 cuts off its beginning, which sets that clip's start point; dragging back right undoes the cut. Shift = fine, otherwise snaps to 0.1s
- **Start / end flags**: each lane has a flag at both ends; drag to cut the clip there. The music stays lined up with the other clip and the flags snap to that clip's beats and markers (Shift = free). Saved as `sa`/`sb` (start) and `ea`/`eb` (end)
- **Force-load & lock**: each video is pre-loaded when it is set (started muted for a moment, then paused at its start point), with a "Loading…" overlay; Play and Space stay locked until the videos are ready, and just before playback every lane is parked and buffered at its start spot so they begin together. If a browser blocks the muted pre-load, Play unlocks after about 12 seconds with a message
- **Mix start / end**: two cyan flags in the ruler (lines across both lanes and the curve) limit playback: Play runs from the start line to the end line, then stops; anything outside is dimmed. They snap to beats and markers (Shift = free). Saved as `rs` / `re`
- **Zoom & move**: scroll the mouse wheel over the timeline to zoom (or `−` / `+`); Shift + scroll or the scrollbar under the timeline moves it (drag the bar, click the track or the arrows, drag the bar's ends to zoom); Fit shows both whole clips. Fully zoomed out, scrolling down scrolls the page
- **BPM & Beat Grid**: Enter or tap a BPM and a first-beat position per video to see a beat grid; dragging then snaps beats of A and B together
- **Crossfade Curve**: One editable curve (top = only B, bottom = only A). Click to add points, drag to move, double-click to remove. Supports multiple transitions (A→B→A…). Equal-power or linear fade law
- **Start Time / Volume**: Per-video start point and master volume
- **Saved settings**: Everything (YouTube IDs, start/offset, BPM, volumes, fade law, curve) is saved automatically in your browser and written live into the page URL as a short readable hash such as `#a=ViMftVmc3Ts&b=yt1polx2D_4&o=3.5&bb=128` (defaults are omitted), so the address bar is always a shareable link. "Copy share link" is a shortcut for that
- **Speed & tempo match**: per-video speed; with both BPMs set, "Match to A/B" sets the speed so the tempos are equal. The page shows the speed YouTube actually accepted and how far apart the tempos remain, since YouTube only offers certain speeds (often 0.25 steps) and speeding up raises the pitch. Saved in the URL as `ra=` / `rb=`
- **Markers**: "Mark here" drops a flag at a video's current time (e.g. where the vocals start). Click a flag to jump the playhead, then "Start here" (make it the clip's start) or "Sync to…" (click a marker on the other clip to line the two up); double-click deletes; dragging a lane snaps a marker on A to a marker on B. Saved in the URL as `ma=` / `mb=`
- **Solo button** (next to Tap) plays just that video while you measure its tempo; press again to return to Mix
- **Monitor**: Solo A, Solo B, or hear Both at full volume (ignoring the curve) while checking beats; always starts back on Mix after a reload
- **Playback**: Play from the playhead (click the ruler to move it) or from the start

### Sample Mode (not linked yet)

> Experimental and not supported for now: it is no longer linked from the landing page. The files (`youtube-dj-sample.*`) are still in the repo.
- **Sample Recording**: Capture audio samples from YouTube videos
- **16 Sample Pads**: Trigger samples with a grid interface
- **BPM Control**: Set and tap tempo for synchronized playback
- **Loop Options**: Enable looping for continuous playback
- **Export/Import**: Save and load your sample collections

## Live Demo

**https://mofosyne.github.io/youtube-dj-doubler/**

Deployed automatically to GitHub Pages by `.github/workflows/pages.yml` on every push to `main`
(enable it once under Settings → Pages → Source: **GitHub Actions**).

## Example

[Open an example mix](https://mofosyne.github.io/youtube-dj-doubler/youtube-dj.html#a=ViMftVmc3Ts&b=yt1polx2D_4&sb=0.51&o=-16.9&rs=16.484&ba=101.8&bb=99.8&fa=42.61&fb=60&vb=80&ma=42.58&mb=59.99&c=0:0,57.152:0,57.202:0.265,59.46:0.747,59.51:1):
two videos with a marker on each (to line up the vocals), beat grids (about 102 and 100 BPM), a trimmed start, a play range and a crossfade curve, all stored in the link itself.

## Quick Start

1. **Basic Mode**:
   - Open `youtube-dj.html` (via the live demo or a local web server, not `file://`)
   - Enter YouTube URLs for both videos and click "Load"
   - Drag the lanes on the timeline to align them, optionally set BPMs for beat snapping
   - Shape the crossfade curve, then press "Play" or "Play from start"

2. **Sample Mode**:
   - Open `youtube-dj-sample.html` in your browser
   - Load YouTube videos
   - Click "Record Sample" to capture audio segments
   - Click sample pads to trigger playback
   - Use BPM controls for tempo synchronization

## How to Use

### Basic Mode Controls

- **URL Input**: YouTube URLs or video IDs
- **Start Time**: Where in each video its lane begins
- **Offset**: Time B starts relative to A (drag the lanes or type it; negative = B first)
- **BPM / Tap / First beat**: Define a beat grid for a video (YouTube audio can't be analysed, so enter it or tap it)
- **Timeline**: Drag lanes to shift, click the ruler to move the playhead
- **Crossfade curve**: Click to add a point, drag to move, double-click (or right-click) to remove; Shift disables snapping
- **Fade law**: Equal power (constant loudness) or Linear
- **Volume Sliders**: Master volume per video (the curve scales it)
- **Play / Pause / Play from start / Reset**

### Sample Mode Controls

- **Record Sample**: Start/stop recording a sample from the current video
- **Sample Length**: Set the duration for recorded samples
- **BPM**: Set beats per minute for tempo synchronization
- **Tap Tempo**: Click to set BPM based on your taps
- **Sample Pads**: Click to play recorded samples
- **Play All**: Play all samples sequentially
- **Stop All**: Stop all currently playing samples
- **Clear All**: Remove all samples
- **Export**: Download your samples as a JSON file
- **Import**: Load previously exported samples

## Browser Compatibility

- Chrome (recommended)
- Firefox
- Safari
- Edge

Note: Requires an active internet connection to load YouTube videos.

## Technical Details

- Uses YouTube IFrame Player API
- No server required - runs entirely in the browser
- Samples are stored in memory and can be exported/imported
- Supports most YouTube URL formats

## Limitations

- **YouTube error 153 ("video player configuration error")**: YouTube refuses to embed when the page has no
  valid HTTP referrer, which happens when opening the `.html` files directly via `file://`.
  Use the live demo above, or serve locally, e.g. `python3 -m http.server` and open `http://localhost:8000`.

- YouTube videos must be publicly accessible
- Some videos may be blocked due to copyright restrictions
- Audio playback is subject to YouTube's terms of service
- Samples are limited by browser memory constraints

## File Structure

- `index.html` – landing page
- `youtube-dj.html` / `youtube-dj.js` – basic mode
- `youtube-dj-sample.html` / `youtube-dj-sample.js` – sample mode
- `youtube-dj.css` – shared styles
- `.github/workflows/pages.yml` – GitHub Pages deployment