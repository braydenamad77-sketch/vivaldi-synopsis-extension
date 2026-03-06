import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("companionApp", {
  listCacheEntries(query = "") {
    return ipcRenderer.invoke("companion:list-cache", query);
  },
  getCacheEntry(cacheKey) {
    return ipcRenderer.invoke("companion:get-cache-entry", cacheKey);
  },
  getStatus() {
    return ipcRenderer.invoke("companion:get-status");
  },
});
