// Preload script: gives the viewer a narrow bridge to the files the user opened.
// It never exposes the file system itself. Only paths of files the user picked or dropped in this
// session can be read or written, and the main process checks that.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// The real path of a File is only visible here (webUtils), so remember it by name, size and date.
const paths = new Map();
const keyOf = (f) => [f.name, f.size, f.lastModified].join('\u0000');

function remember(list) {
  for (const f of Array.from(list || [])) {
    const p = webUtils.getPathForFile(f);
    if (!p) continue;
    paths.set(keyOf(f), p);
    ipcRenderer.send('file:allow', p);
  }
}

// Capture phase, so the paths are recorded before the page's own handlers run (and clear the input).
document.addEventListener(
  'change',
  (e) => {
    if (e.target && e.target.type === 'file') remember(e.target.files);
  },
  true,
);
document.addEventListener('drop', (e) => remember(e.dataTransfer && e.dataTransfer.files), true);

contextBridge.exposeInMainWorld('chatViewerDesktop', {
  pathFor(info) {
    return paths.get(keyOf(info));
  },
  readFile(p) {
    return ipcRenderer.invoke('file:read', p);
  },
  writeFile(p, data) {
    return ipcRenderer.invoke('file:write', p, data);
  },
});
