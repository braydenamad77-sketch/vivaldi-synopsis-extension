# Vivaldi Synopsis Extension (MVP)

WXT-powered MV3 Chromium extension for quick non-spoiler synopses from highlighted titles.

## Features

- Highlight text and use right-click `Get Synopsis`
- Right-click empty page area and use `Search Synopsis` for manual title entry
- Popup shows whether manual search can open on the current page before you click it
- Book/movie/TV matching
- Pixel-locked split panel mode with poster/book-cover pane
- Styled no-artwork placeholder pane
- Ambiguity chooser (up to 6 matches)
- Non-spoiler synopsis filtering with optional LLM rewrite (preferred by default)
- Metadata display (author/year for books, director-or-creator/year/cast for film/TV when available)
- Settings toggle: `With Image Panel` or `Without Image`
- Local cache with clear-cache option

## Project structure

- `wxt.config.ts`
- `entrypoints/` WXT background, content script, popup, options, and sidepanel entrypoints
- `src/background/` background logic + router
- `src/providers/` Open Library, TMDB, Goodreads book fallback, Wikipedia fallback
- `src/llm/` OpenRouter integration
- `src/core/` normalize, disambiguate, spoiler guard, cache
- `src/content/` inline card UI
- `src/options/`, `src/popup/`, `src/sidepanel/` shared page logic and styles
- `public/` extension icons copied into the final build
- `tests/` unit tests for core logic

## Setup

1. Install dependencies with `npm install`
2. Copy `web-ext.config.example.ts` to `web-ext.config.ts` if you want to customize the local Vivaldi binary/profile path
3. Run `npm run dev` for the WXT dev server and automatic extension reloads
4. Open extension options page and set:
   - `OpenRouter API Key`
   - `OpenRouter Model` (default is pre-filled)
   - `TMDB API Key` (required for movie/TV metadata)
   - `Result Display Mode` (`With Image Panel` by default)

## Development

- `npm run dev` starts the WXT dev server without launching a browser. This is the default for using the unpacked dev build in your normal Vivaldi profile.
- Load `.output/chrome-mv3-dev` as the unpacked extension in Vivaldi once, then keep using that installed dev copy in your regular profile while `npm run dev` is running.
- `npm run dev:open` still asks WXT/web-ext to launch a browser window if you specifically want that flow.
- `npm run build` creates a production extension in `.output/chrome-mv3`
- `npm run zip` packages the built extension
- `npm run test` runs Vitest for the extension, verifies the generated manifest, and then runs the Electron companion app tests

## Notes

- LLM is enabled and preferred by default.
- If LLM times out/fails, sanitized provider text is used.
- Book flow uses Open Library first and Goodreads as fallback when Open Library lacks a description.
- Right-click flow supports both selected text and manual search input.
- Manual search works on regular `http` and `https` pages. Built-in browser pages such as `vivaldi://` are blocked by Chromium.
- Local-only mode returns cache hits only.

## Test

```bash
npm test
```
