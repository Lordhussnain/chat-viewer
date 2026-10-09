// Reading and writing the user's files, through whichever route this window supports:
//  - Desktop app (Electron): a preload bridge that knows the real path of each opened file.
//  - Chromium-based browsers: File System Access handles (from the Open button or a drop).
// Anywhere else, files can be read but not written back; the viewer then offers export only.
import type { WriteTarget } from './types';

interface DesktopBridge {
  /** Path of a file the user picked or dropped, identified by its name, size and date. */
  pathFor(info: { name: string; size: number; lastModified: number }): string | undefined;
  readFile(path: string): Promise<Uint8Array>;
  /** Writes the file and returns the backup path, if one was made. */
  writeFile(path: string, data: Uint8Array): Promise<string | undefined>;
}

declare global {
  interface Window {
    chatViewerDesktop?: DesktopBridge;
  }
}

const OPEN_TYPES = [
  {
    description: 'Chats, notes and images',
    accept: {
      'application/json': ['.json', '.jsonl'],
      'text/markdown': ['.md', '.markdown', '.txt'],
      'application/zip': ['.zip'],
      'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'],
    },
  },
];

export function desktopBridge(): DesktopBridge | undefined {
  return window.chatViewerDesktop;
}

/** Where a file picked through <input type="file"> can be written back to, in the desktop app. */
export function desktopTarget(file: File): WriteTarget | undefined {
  const path = window.chatViewerDesktop?.pathFor({
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
  });
  return path ? { kind: 'path', path } : undefined;
}

/** True when the browser can open files with handles, which makes saving back possible. */
export function canOpenWithHandles(): boolean {
  return !window.chatViewerDesktop && typeof (window as { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function';
}

/** Open files through the browser's picker. Returns the files and their write targets. */
export async function pickFilesWithHandles(): Promise<{ file: File; target?: WriteTarget }[]> {
  const picker = (window as unknown as { showOpenFilePicker: (o: object) => Promise<FileSystemFileHandle[]> })
    .showOpenFilePicker;
  let handles: FileSystemFileHandle[];
  try {
    handles = await picker({ multiple: true, types: OPEN_TYPES });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return [];
    throw e;
  }
  return Promise.all(
    handles.map(async (handle) => ({ file: await handle.getFile(), target: { kind: 'handle', handle } as WriteTarget })),
  );
}

/**
 * Start reading the handles of dropped files. Call this synchronously inside the drop handler,
 * because the browser only gives out handles during that event.
 */
export function handlesFromDrop(dt: DataTransfer): Promise<(WriteTarget | undefined)[]> | null {
  const items = Array.from(dt.items ?? []).filter((i) => i.kind === 'file');
  const first = items[0] as (DataTransferItem & { getAsFileSystemHandle?: () => Promise<unknown> }) | undefined;
  if (!first || typeof first.getAsFileSystemHandle !== 'function') return null;
  const requests = items.map((i) =>
    (i as DataTransferItem & { getAsFileSystemHandle: () => Promise<unknown> })
      .getAsFileSystemHandle()
      .catch(() => null),
  );
  return Promise.all(requests).then((handles) =>
    handles.map((h) =>
      h && (h as FileSystemHandle).kind === 'file'
        ? ({ kind: 'handle', handle: h as FileSystemFileHandle } as WriteTarget)
        : undefined,
    ),
  );
}

export async function readTarget(target: WriteTarget): Promise<Uint8Array> {
  if (target.kind === 'path') {
    const bridge = desktopBridge();
    if (!bridge) throw new Error('The desktop bridge is not available.');
    return bridge.readFile(target.path);
  }
  const file = await target.handle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

/** Write bytes to the target. Returns the backup path when the desktop app made one. */
export async function writeTarget(target: WriteTarget, bytes: Uint8Array): Promise<string | undefined> {
  if (target.kind === 'path') {
    const bridge = desktopBridge();
    if (!bridge) throw new Error('The desktop bridge is not available.');
    return bridge.writeFile(target.path, bytes);
  }
  const handle = target.handle as FileSystemFileHandle & {
    queryPermission?: (o: object) => Promise<string>;
    requestPermission?: (o: object) => Promise<string>;
  };
  const options = { mode: 'readwrite' };
  if ((await handle.queryPermission?.(options)) !== 'granted') {
    if ((await handle.requestPermission?.(options)) !== 'granted') {
      throw new Error('Permission to write the file was not granted.');
    }
  }
  const writable = await handle.createWritable();
  await writable.write(bytes as BufferSource);
  await writable.close();
  return undefined;
}
