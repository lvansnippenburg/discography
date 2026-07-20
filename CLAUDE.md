# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AI Discography** is a web-based music collection manager that allows users to:
- Scan physical album covers with a camera
- Use Google Gemini AI to automatically extract album metadata
- Store and organize music collection in IndexedDB (offline-first)
- Auto-sync collection to GitHub (push on every change, pull on first empty load)
- Search, edit, and delete album entries

This is a **vanilla JavaScript web app** with no build process, dependencies, or dev server required. Simply open `index.html` in a browser.

## Development Setup

**No installation required.** The app runs directly in a browser:

1. Open `index.html` in a modern browser (Chrome, Firefox, Safari)
2. For local development, use `python3 -m http.server 8000` or `npx serve` to serve over http (some browser APIs like camera access require secure context)
3. Camera access requires HTTPS in production, but localhost HTTP works in development

## Architecture

### File Structure
- **index.html** — Single-page app entry point; defines all modals and UI structure
- **scripts/app.js** — Main application logic
  - `app` IIFE module containing:
    - `dbManager` — IndexedDB abstraction for local storage (albums object store)
    - Camera/video capture functions
    - `analyzeImage()` — Calls Google Gemini API with captured image and prompt
    - Modal management (camera, editor, settings)
    - Import/export to JSON and GitHub
    - Debounced auto-push on local changes; auto-pull on first empty load
  - Exposes public API: `init`, `startCamera`, `capture`, `closeCamera`, `saveEntry`, `deleteCurrent`, `search`, `openSettings`, `closeSettings`, `saveSettings`, `exportData`, `pushGitHub`, `pullGitHub`, `triggerImport`, `importData`, `closeEditor`, `toggleTheme`
- **scripts/GitHubSync.js** — GitHub REST API (Contents API) integration
  - Manages GitHub settings (token, branch; owner/repo/filepath hardcoded)
  - `pushToGitHub(content, message)` — uploads local DB as JSON file via GitHub Contents API
  - `pullFromGitHub()` — fetches remote JSON file and validates structure
  - `isConfigured()` — checks if GitHub token is set
  - Settings persisted to localStorage
- **styles/style.css** — Dark theme styling (Material Design principles)

### Data Flow

1. **Capture:** User takes photo → cropped to 300×300px → converted to base64
2. **AI Analysis:** Base64 image + prompt sent to Google Gemini API → returns JSON with album metadata
3. **Storage:** Album entry (image, metadata) saved to IndexedDB via `dbManager`
4. **Display:** Albums fetched from DB, filtered by search term, rendered as cards
5. **Sync:** Auto-push to GitHub after ~1.5s debounce (debounced & serialized); auto-pull from GitHub on first load if DB is empty

### Key Technical Decisions

- **IndexedDB** for offline storage (no server required, persistent across sessions)
- **Vanilla JS** — no framework or build tool; simpler for static deployment
- **Google Gemini API** for image analysis (not on-device; requires API key)
- **localStorage** for sensitive config (API keys, GitHub token) — **plaintext, device-only**
- **GitHub REST API (Contents API)** for Git sync (not using Git CLI; REST API via fetch; supports push, pull, sha-based updates)
- **Auto-sync behavior**: debounced (~1.5s) + serialized auto-push on every local mutation; auto-pull on first empty load (with optional settings prompt if unconfigured)
- **Modal pattern** for all interactions (camera, editor, settings) rather than routing

## Important Notes

### API Keys & Secrets
- Google Gemini API key stored in `localStorage` under `geminiApiKey`
- GitHub fine-grained PAT stored in `localStorage` under `github_token`
- **These are plaintext in browser storage** — device-only, not synced
- Never commit API keys to repo

### Image Storage
- Album covers stored as **data URIs (base64)** in IndexedDB
- No server-side storage; all images stored locally
- GitHub sync exports/imports images as base64 strings in JSON

### Browser APIs Used
- `navigator.mediaDevices.getUserMedia()` — camera access
- `IndexedDB` — persistent client-side storage
- `FileReader` — import JSON files
- `Fetch API` — Gemini and GitHub API calls
- `Canvas` — image cropping and JPEG encoding

### Gemini API Integration
- **Endpoint:** `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent`
- **Input:** Image (JPEG, base64), text prompt asking for JSON with album metadata
- **Output:** Expected JSON keys: `Artist`, `Albumtitle`, `Composer`, `Year`, `songlist` (array), `mediumtype`, `recordcompany`, `discogsUrl`
- **Fallback:** If API fails, editor opens blank for manual entry

### GitHub Sync Behavior
- **Hardcoded config:** owner `lvansnippenburg`, repo `discography`, file `data/music.json`
- **Configurable:** GitHub fine-grained PAT (token), branch (default `main`)
- **Auto-push:** Debounced (~1.5s), serialized, fires after any local mutation (`saveEntry`, `deleteCurrent`, `importData`); no confirmation for background pushes
- **Auto-pull:** On first app load, if local DB is empty and GitHub is configured, auto-pulls `data/music.json` and populates DB; if not configured yet, prompts user for settings, then pulls once saved
- **Manual buttons:** Explicit "Push to GitHub" / "Pull from GitHub" buttons in settings modal (independent of debounce, require confirmation)
- **File format:** JSON array of album objects; base64-encoded when sent/received (GitHub Contents API standard)
- **Error handling:**
  - 404 on initial pull = file doesn't exist yet (silently accepted, expected on first run)
  - 404 on manual pull = file not found (user-facing alert)
  - Other errors logged to console and surfaced to `#sync-status` for auto-pull; alerted for manual actions
- **Overwrite behavior:** Both push and pull overwrite remote/local file respectively (destructive); no conflict resolution or three-way merge
