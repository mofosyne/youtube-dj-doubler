# YouTube DJ Doubler

A web-based application that lets you mix YouTube videos like a DJ, with both basic and advanced sample-based modes.

## Features

### Basic Mode
- **Dual Video Players**: Load two YouTube videos simultaneously
- **Start Time Control**: Set custom start times for each video
- **Offset Control**: Sync videos with precise timing offsets
- **Volume Control**: Adjust volume levels for each video independently
- **Crossfade**: Smooth transitions between videos with adjustable duration
- **Sync Play**: Start both videos with calculated timing

### Sample Mode
- **Sample Recording**: Capture audio samples from YouTube videos
- **16 Sample Pads**: Trigger samples with a grid interface
- **BPM Control**: Set and tap tempo for synchronized playback
- **Loop Options**: Enable looping for continuous playback
- **Export/Import**: Save and load your sample collections

## Quick Start

1. **Basic Mode**:
   - Open `youtube-dj.html` in your browser
   - Enter YouTube URLs for both videos
   - Click "Load" for each video
   - Adjust start times, offsets, and volumes
   - Use "Sync Play" to start both videos with your settings

2. **Sample Mode**:
   - Open `youtube-dj-sample.html` in your browser
   - Load YouTube videos
   - Click "Record Sample" to capture audio segments
   - Click sample pads to trigger playback
   - Use BPM controls for tempo synchronization

## How to Use

### Basic Mode Controls

- **URL Input**: Enter YouTube video URLs (full URLs or video IDs work)
- **Start Time**: Set where each video should begin playing (in seconds)
- **Offset**: Set the time difference between Video A and Video B
- **Volume Sliders**: Control the volume for each video (0-100%)
- **Crossfade**: Set the duration for smooth transitions between videos
- **Play Both**: Start both videos at their current positions
- **Pause Both**: Pause both videos
- **Sync Play**: Start both videos with offset synchronization
- **Reset**: Reset all controls and stop videos

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

- YouTube videos must be publicly accessible
- Some videos may be blocked due to copyright restrictions
- Audio playback is subject to YouTube's terms of service
- Samples are limited by browser memory constraints

## File Structure