# Goodreads Visual Helper

Local Playwright helper for the extension's Goodreads fallback.

## What it does

1. Opens Goodreads in a real browser context.
2. Expands the visible description when needed.
3. Captures targeted screenshots of the description area.
4. Sends those screenshots to OpenRouter to extract only the visible description text.

## Run it

```bash
cd helpers/goodreads-visual
npm install
npm start
```

The helper listens on `http://127.0.0.1:4317` by default.

## Notes

- It keeps its own isolated Playwright profile under `.runtime/`.
- It does not return a final synopsis. It only returns extracted Goodreads description text.
