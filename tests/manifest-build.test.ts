import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { test } from "vitest";

test("built manifest preserves current chrome mv3 contract", async () => {
  const manifestText = await readFile(".output/chrome-mv3/manifest.json", "utf8");
  const manifest = JSON.parse(manifestText) as {
    manifest_version: number;
    name: string;
    description: string;
    permissions: string[];
    host_permissions: string[];
    action: {
      default_title: string;
      default_popup: string;
      default_icon: Record<string, string>;
    };
    options_ui?: {
      page?: string;
    };
    options_page?: string;
    side_panel: {
      default_path: string;
    };
    background: {
      service_worker: string;
    };
    icons: Record<string, string>;
    web_accessible_resources: Array<{
      matches: string[];
      resources: string[];
    }>;
    content_scripts: Array<{
      matches: string[];
      run_at: string;
      css: string[];
      js: string[];
    }>;
  };

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "Vivaldi Synopsis");
  assert.equal(manifest.description, "Highlight a title and get a concise non-spoiler synopsis with metadata.");
  assert.deepEqual(manifest.permissions, ["contextMenus", "storage", "activeTab", "scripting", "sidePanel"]);
  assert.deepEqual(manifest.host_permissions, [
    "https://openlibrary.org/*",
    "https://api.themoviedb.org/*",
    "https://api.tvmaze.com/*",
    "https://en.wikipedia.org/*",
    "https://openrouter.ai/*",
    "http://127.0.0.1/*",
    "http://localhost/*",
  ]);
  assert.equal(manifest.action.default_title, "Vivaldi Synopsis");
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.equal(manifest.options_ui?.page || manifest.options_page, "options.html");
  assert.equal(manifest.side_panel.default_path, "sidepanel.html");
  assert.equal(manifest.background.service_worker, "background.js");
  assert.deepEqual(manifest.icons, {
    "16": "icon-16.png",
    "32": "icon-32.png",
    "48": "icon-48.png",
    "128": "icon-128.png",
  });
  assert.deepEqual(manifest.action.default_icon, {
    "16": "icon-16.png",
    "32": "icon-32.png",
    "48": "icon-48.png",
  });
  assert.deepEqual(manifest.web_accessible_resources, [
    {
      matches: ["http://*/*", "https://*/*"],
      resources: ["icon-48.png"],
    },
  ]);
  assert.deepEqual(manifest.content_scripts, [
    {
      matches: ["http://*/*", "https://*/*"],
      run_at: "document_idle",
      css: ["content-scripts/synopsis.css"],
      js: ["content-scripts/synopsis.js"],
    },
  ]);
});
