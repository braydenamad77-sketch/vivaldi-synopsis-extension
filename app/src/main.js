import path from "node:path";

import { app, BrowserWindow, ipcMain } from "electron";

import { createCompanionHttpServer } from "./main/http-server.js";
import { createCacheDatabase } from "./main/cache-db.js";
import { createGoodreadsVisualService } from "./main/goodreads-service.js";

let mainWindow;
let cacheDb;
let goodreadsService;
let httpServer;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    backgroundColor: "#121214",
    webPreferences: {
      preload: path.join(app.getAppPath(), "src", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await mainWindow.loadFile(path.join(app.getAppPath(), "src", "renderer", "index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function bootstrap() {
  const userDataDir = app.getPath("userData");
  const runtimeDir = path.join(userDataDir, "runtime");
  const dbPath = path.join(userDataDir, "cache.sqlite");

  cacheDb = createCacheDatabase({ dbPath });
  goodreadsService = createGoodreadsVisualService({ runtimeDir });
  httpServer = createCompanionHttpServer({
    cacheDb,
    goodreadsService,
    host: "127.0.0.1",
    port: 4317,
  });

  await httpServer.start();

  ipcMain.handle("companion:list-cache", (_event, query) => cacheDb.listCacheEntries({ query }));
  ipcMain.handle("companion:get-cache-entry", (_event, cacheKey) => cacheDb.getCacheEntry(cacheKey));
  ipcMain.handle("companion:get-status", () => ({
    serverUrl: "http://127.0.0.1:4317",
    dbPath,
  }));

  await createMainWindow();
}

async function shutdown() {
  await httpServer?.stop().catch(() => {});
  await goodreadsService?.stop().catch(() => {});
  cacheDb?.close?.();
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(bootstrap).catch((error) => {
    console.error("[companion] bootstrap failed", error);
    app.quit();
  });
}

app.on("window-all-closed", async () => {
  await shutdown();
  app.quit();
});

app.on("before-quit", async () => {
  await shutdown();
});
