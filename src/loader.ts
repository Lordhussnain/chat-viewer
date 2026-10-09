import JSZip from 'jszip';
import type { Chat, LoadedFile, WriteTarget } from './types';
import { newId, parseChatDocument } from './parse';

export const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|svg)$/i;

export interface LoadResult {
  chats: Chat[];
  /** Image blobs keyed by file name (base name only), used to resolve markdown image links. */
  images: Record<string, Blob>;
  /** The chat files that were read, with the bytes they had. Saves are based on these. */
  files: LoadedFile[];
  errors: string[];
}

const decoder = new TextDecoder();

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Read a zip (e.g. an AI Studio export) and pull out chats and images from it. */
async function readZip(file: LoadedFile, out: LoadResult): Promise<void> {
  const zip = await JSZip.loadAsync(file.bytes);
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || entry.name.startsWith('__MACOSX/')) continue;
    const base = baseName(entry.name);
    try {
      if (IMAGE_EXT.test(base)) {
        out.images[base] = await entry.async('blob');
      } else if (/\.(json|jsonl|md|markdown)$/i.test(base)) {
        const docName = `${file.name}/${entry.name}`;
        const chats = parseChatDocument(docName, await entry.async('string')).chats;
        chats.forEach((chat, index) => {
          out.chats.push({ ...chat, origin: { fileId: file.id, entry: entry.name, index } });
        });
      }
    } catch (e) {
      out.errors.push((e as Error).message);
    }
  }
}

/**
 * Load any mix of chat files, markdown, images, and zip archives.
 * `targets` says where each File can be written back to (for example, a file handle from a drop).
 */
export async function loadFiles(files: File[], targets?: Map<File, WriteTarget | undefined>): Promise<LoadResult> {
  const out: LoadResult = { chats: [], images: {}, files: [], errors: [] };
  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (IMAGE_EXT.test(file.name)) {
        out.images[baseName(file.name)] = file;
        continue;
      }
      const loaded: LoadedFile = {
        id: newId('file'),
        name: file.name,
        zip: /\.zip$/i.test(file.name),
        bytes,
        target: targets?.get(file),
      };
      if (loaded.zip) {
        out.files.push(loaded);
        await readZip(loaded, out);
      } else {
        const chats = parseChatDocument(file.name, decoder.decode(bytes)).chats;
        chats.forEach((chat, index) => {
          out.chats.push({ ...chat, origin: { fileId: loaded.id, index } });
        });
        out.files.push(loaded);
      }
    } catch (e) {
      out.errors.push((e as Error).message);
    }
  }
  return out;
}
