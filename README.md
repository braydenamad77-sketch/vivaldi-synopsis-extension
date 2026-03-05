# Vivaldi Synopsis Extension (MVP)

Manifest V3 Chromium extension for quick non-spoiler synopses from highlighted titles.

## Features

- Highlight text and use right-click `Get Synopsis`
- Right-click empty page area and use `Search Synopsis` for manual title entry
- Book/movie/TV matching
- Pixel-locked split panel mode with poster/book-cover pane
- Styled no-artwork placeholder pane
- Ambiguity chooser (up to 5 matches)
- Non-spoiler synopsis filtering with optional LLM rewrite (preferred by default)
- Metadata display (author/year for books, director-or-creator/year/cast for film/TV when available)
- Settings toggle: `With Image Panel` or `Without Image`
- Local cache with clear-cache option

## Project structure

- `manifest.json`
- `src/background/` service worker + router
- `src/providers/` Open Library, TMDB, Goodreads book fallback, Wikipedia fallback
- `src/llm/` OpenRouter integration
- `src/core/` normalize, disambiguate, spoiler guard, cache
- `src/content/` inline card UI
- `src/options/` settings page
- `tests/` unit tests for core logic

## Setup

1. Open `chrome://extensions` or `vivaldi://extensions`
2. Enable Developer Mode
3. Click **Load unpacked** and select this project directory
4. Open extension options page and set:
   - `OpenRouter API Key`
   - `OpenRouter Model` (default is pre-filled)
   - `TMDB API Key` (required for movie/TV metadata)
   - `Result Display Mode` (`With Image Panel` by default)

## Notes

- LLM is enabled and preferred by default.
- If LLM times out/fails, sanitized provider text is used.
- Book flow uses Open Library first and Goodreads as fallback when Open Library lacks a description.
- Right-click flow supports both selected text and manual search input.
- Local-only mode returns cache hits only.

## Test

```bash
npm test
```
