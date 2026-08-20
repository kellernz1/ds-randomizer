const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("randomizerDesktop", Object.freeze({
  request: (pathname, options = {}) => ipcRenderer.invoke(
    "randomizer:request",
    {
      pathname,
      method: options.method || "GET",
      body: options.body || {},
    },
  ),
  selectDirectory: (initialPath) => ipcRenderer.invoke(
    "randomizer:select-directory",
    initialPath,
  ),
  saveJson: (defaultName, contents) => ipcRenderer.invoke(
    "randomizer:save-json",
    { defaultName, contents },
  ),
}));
