const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { writeFile } = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const allowedRequests = new Map([
  ["/api/state", "GET"],
  ["/api/seed/new", "POST"],
  ["/api/share/export", "POST"],
  ["/api/share/import", "POST"],
  ["/api/detect", "POST"],
  ["/api/scan", "POST"],
  ["/api/generate", "POST"],
  ["/api/install", "POST"],
  ["/api/restore", "POST"],
]);

let dispatchApi;

async function createWindow() {
  const applicationRoot = app.getAppPath();
  process.env.DSR_RANDOMIZER_APP_ROOT ||= applicationRoot;
  process.env.DSR_RANDOMIZER_STATE_ROOT ||= app.getPath("userData");
  ({ dispatchApi } = await import(
    pathToFileURL(path.join(applicationRoot, "src", "server.js")).href
  ));

  const window = new BrowserWindow({
    width: 1220,
    height: 860,
    minWidth: 940,
    minHeight: 680,
    backgroundColor: "#0c0d0e",
    title: "DSR Randomizer",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//u.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  await window.loadFile(path.join(applicationRoot, "public", "index.html"));
}

ipcMain.handle("randomizer:request", async (_event, request) => {
  const pathname = String(request?.pathname || "");
  const method = String(request?.method || "GET").toUpperCase();
  if (allowedRequests.get(pathname) !== method) {
    return {
      ok: false,
      status: 403,
      payload: { error: "Desktop request was not allowed." },
    };
  }
  return dispatchApi({ pathname, method, body: request?.body || {} });
});

ipcMain.handle("randomizer:select-directory", async (_event, initialPath) => {
  const result = await dialog.showOpenDialog({
    title: "Select the DARK SOULS REMASTERED directory",
    defaultPath: String(initialPath || ""),
    properties: ["openDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("randomizer:save-json", async (_event, request) => {
  const result = await dialog.showSaveDialog({
    title: "Export shared seed",
    defaultPath: String(request?.defaultName || "dsr-seed.json"),
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return false;
  await writeFile(result.filePath, String(request?.contents || ""), "utf8");
  return true;
});

app.whenReady().then(createWindow).catch((error) => {
  dialog.showErrorBox("DSR Randomizer", error.stack || error.message);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
