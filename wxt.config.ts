import { defineConfig } from "wxt";

const iconSet = {
  "16": "/icon-16.png",
  "32": "/icon-32.png",
  "48": "/icon-48.png",
  "128": "/icon-128.png",
} as const;

export default defineConfig({
  srcDir: ".",
  publicDir: "public",
  entrypointsDir: "entrypoints",
  imports: false,
  browser: "chrome",
  targetBrowsers: ["chrome"],
  manifestVersion: 3,
  webExt: {
    keepProfileChanges: true,
  },
  manifest: {
    name: "Vivaldi Synopsis",
    description: "Highlight a title and get a concise non-spoiler synopsis with metadata.",
    permissions: ["contextMenus", "storage", "activeTab", "scripting", "sidePanel"],
    host_permissions: [
      "https://openlibrary.org/*",
      "https://api.themoviedb.org/*",
      "https://api.tvmaze.com/*",
      "https://en.wikipedia.org/*",
      "https://openrouter.ai/*",
      "http://127.0.0.1/*",
      "http://localhost/*",
    ],
    icons: iconSet,
    action: {
      default_title: "Vivaldi Synopsis",
      default_icon: {
        "16": "/icon-16.png",
        "32": "/icon-32.png",
        "48": "/icon-48.png",
      },
    },
    web_accessible_resources: [
      {
        resources: ["/icon-48.png"],
        matches: ["http://*/*", "https://*/*"],
      },
    ],
  },
});
