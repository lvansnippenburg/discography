# 💿 AI Discography

[See this site on the web](https://lvansnippenburg.github.io/discography/)

A web app for cataloging your music collection. Point your camera at an album cover, and AI automatically extracts the metadata. Store everything offline and optionally sync to Codeberg.

## Features

- 📸 **Camera Scan** — Capture album covers with your device camera
- 🤖 **AI Detection** — Google Gemini AI extracts artist, title, year, and tracks
- 💾 **Offline Storage** — All data stored locally in your browser (IndexedDB)
- ☁️ **Cloud Sync** — Optional backup/sync with Codeberg
- 🔍 **Search** — Find albums by artist, title, or composer
- ✏️ **Edit** — Manually correct or update album details

## Quick Start

1. Open `index.html` in a modern browser (Chrome, Firefox, Safari)
2. Go to **Settings** (⚙️) and paste your Google Gemini API key
   - Get one free at [aistudio.google.com](https://aistudio.google.com)
3. Click **+ SCAN** to take a photo of an album cover
4. Review and edit the auto-detected info, then save

## Usage

### Adding Albums
- Tap **+ SCAN** to open the camera
- Align the album cover within the guide box
- Tap the shutter button to capture
- Edit the details if needed and save

### Managing Your Collection
- **Search** — Use the search bar to filter by artist, album title, or composer
- **Edit** — Tap any album card to edit its details
- **Delete** — Open an album and tap the Delete button

### Export & Sync

**Local Export:**
- Settings → Export — Save your collection as a JSON file

**Codeberg Sync** (optional):
- Settings → Enter your Codeberg token and repo details
- Settings → Export to Codeberg — Backup your collection
- Settings → Import — Load a previously exported collection

## Requirements

- Modern browser (Chrome, Firefox, Safari, Edge)
- **Google Gemini API key** for AI detection ([free tier available](https://aistudio.google.com))
- Codeberg account (optional, for cloud sync)

## Notes

- All data is stored locally in your browser — no server uploads
- API keys are stored in browser localStorage (device-only)
- Offline mode works — just can't use AI detection without internet
