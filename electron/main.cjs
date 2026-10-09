// Electron main process: opens the single-file viewer in a desktop window.
// The viewer runs entirely in the renderer; nothing here reads or sends chat data.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const APP_FILE = path.join(__dirname, '..', 'dist-single', 'chat-viewer.html');

// Files the user has opened or dropped in this session. The viewer may only read or write these.
const allowedPaths = new Set();
// Originals already backed up this session, so each file is copied at most once.
const backedUp = new Set();

function allowedPath(p) {
  if (typeof p !== 'string' || !allowedPaths.has(path.resolve(p))) {
    throw new Error('This file was not opened in this session.');
  }
  return path.resolve(p);
}

ipcMain.on('file:allow', (_event, p) => {
  if (typeof p === 'string') allowedPaths.add(path.resolve(p));
});

ipcMain.handle('file:read', (_event, p) => fs.readFileSync(allowedPath(p)));

// Before the first overwrite, keep the original next to it as <name>.bak (never overwritten).
ipcMain.handle('file:write', (_event, p, data) => {
  const abs = allowedPath(p);
  let backup;
  if (!backedUp.has(abs)) {
    const bak = `${abs}.bak`;
    if (!fs.existsSync(bak)) {
      fs.copyFileSync(abs, bak);
      backup = bak;
    }
    backedUp.add(abs);
  }
  // Write a temporary file first, then rename it over the original, so a crash mid-write
  // cannot leave a half-written chat behind.
  const tmp = `${abs}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, Buffer.from(data));
  fs.renameSync(tmp, abs);
  return backup;
});

// Used by CI to confirm the packaged app renders: set CHAT_VIEWER_SCREENSHOT to a .png path.
const SCREENSHOT_PATH = process.env.CHAT_VIEWER_SCREENSHOT || '';

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    title: 'Chat Viewer',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  win.loadFile(APP_FILE);

  // Links that try to leave the app open in the default browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file:')) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  if (SCREENSHOT_PATH) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const image = await win.webContents.capturePage();
        fs.writeFileSync(SCREENSHOT_PATH, image.toPNG());
        app.quit();
      }, 1500);
    });
    // Safety net so a broken build cannot hang CI.
    setTimeout(() => app.exit(1), 60_000).unref();
  }

  return win;
}

// Only one copy of the viewer at a time; a second launch focuses the first window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
