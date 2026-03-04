# Vivaldi Synopsis Extension (MVP)

Manifest V3 Chromium extension for quick non-spoiler synopses from highlighted titles.

## Features

- Highlight text and use right-click `Get Synopsis`
- Book/movie/TV matching
- Ambiguity chooser (up to 5 matches)
- Non-spoiler synopsis filtering with optional LLM rewrite (preferred by default)
- Metadata display (author/year for books, director-or-creator/year/cast for film/TV when available)
- Local cache with clear-cache option

## Project structure

- `manifest.json`
- `src/background/` service worker + router
- `src/providers/` Open Library, TMDB, Wikipedia fallback
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

## Notes

- LLM is enabled and preferred by default.
- If LLM times out/fails, sanitized provider text is used.
- Local-only mode returns cache hits only.

## Test

```bash
npm test
```

## Future-agent notes

- Current theme is provisional only.
- Before final UI lock, request user screenshots of current Vivaldi UI and retheme tokens in `src/content/card.css` and `src/options/options.css`.
