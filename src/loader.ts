import JSZip from 'jszip';
import type { Chat } from './types';
import { parseChatFile, parseMarkdownChat } from './parse';

export const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|svg)$/i;

export interface LoadResult {
  chats: Chat[];
  /** Image blobs keyed by file name (base name only), used to resolve markdown image links. */
  images: Record<string, Blob>;
  errors: string[];
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Parse one JSON / markdown / text entry. Returns chats or throws. */
function parseTextEntry(name: string, text: string): Chat[] {
  if (/\.(md|markdown|txt)$/i.test(name)) return parseMarkdownChat(name, text);
  return parseChatFile(name, text);
}

/** Read a zip (e.g. an AI Studio export) and pull out chats and images from it. */
async function readZip(file: File | Blob, name: string, out: LoadResult): Promise<void> {
  const zip = await JSZip.loadAsync(file);
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || entry.name.startsWith('__MACOSX/')) continue;
    const base = baseName(entry.name);
    try {
      if (IMAGE_EXT.test(base)) {
        out.images[base] = await entry.async('blob');
      } else if (/\.(json|jsonl|md|markdown)$/i.test(base)) {
        out.chats.push(...parseTextEntry(`${name}/${entry.name}`, await entry.async('string')));
      }
    } catch (e) {
      out.errors.push((e as Error).message);
    }
  }
}

/** Load any mix of chat files, markdown, images, and zip archives. */
export async function loadFiles(files: File[]): Promise<LoadResult> {
  const out: LoadResult = { chats: [], images: {}, errors: [] };
  for (const file of files) {
    try {
      if (/\.zip$/i.test(file.name)) {
        await readZip(file, file.name, out);
      } else if (IMAGE_EXT.test(file.name)) {
        out.images[baseName(file.name)] = file;
      } else {
        out.chats.push(...parseTextEntry(file.name, await file.text()));
      }
    } catch (e) {
      out.errors.push((e as Error).message);
    }
  }
  return out;
}
