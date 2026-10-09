// Saving edits back to the files they came from.
//
// A save starts from the bytes the file had when it was loaded (or last saved), applies the
// edits to a fresh parse of those bytes, and produces new bytes. The result is then parsed again
// and compared with the edits, so anything that did not survive the round trip is reported.
import JSZip from 'jszip';
import type { Chat, LoadedFile } from './types';
import { parseChatDocument } from './parse';
import { sameMessages, type ChatEdit } from './writeback';

export interface PendingEdit {
  chat: Chat;
  edit: ChatEdit;
}

export interface SavedChat {
  chatId: string;
  /** The chat as the file now contains it. */
  chat: Chat;
  /** True when the file does not contain exactly the edited messages or title. */
  mismatch: boolean;
}

export interface SavePlan {
  bytes: Uint8Array;
  updates: SavedChat[];
  notes: string[];
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function applyToDocument(
  name: string,
  text: string,
  edits: PendingEdit[],
): { text: string; updates: SavedChat[]; notes: string[] } {
  const doc = parseChatDocument(name, text);
  const notes: string[] = [];
  for (const { chat, edit } of edits) {
    notes.push(...doc.write(chat.origin?.index ?? -1, edit));
  }
  const out = doc.serialize();

  // Read the result back, the same way a fresh load would.
  const fresh = parseChatDocument(name, out);
  const updates = edits.map(({ chat, edit }) => {
    const reread = fresh.chats[chat.origin?.index ?? -1];
    if (!reread) throw new Error(`${name} no longer has the chat "${chat.title}" after saving.`);
    const titleOk = edit.title === edit.originalTitle || reread.title === edit.title.trim();
    return { chatId: chat.id, chat: reread, mismatch: !sameMessages(reread.messages, edit.edited) || !titleOk };
  });
  return { text: out, updates, notes };
}

/** Compute the new bytes for a file, and what the chats in it look like afterwards. Does not write. */
export async function planSave(file: LoadedFile, edits: PendingEdit[]): Promise<SavePlan> {
  if (!file.zip) {
    const result = applyToDocument(file.name, decoder.decode(file.bytes), edits);
    return { bytes: encoder.encode(result.text), updates: result.updates, notes: result.notes };
  }

  const zip = await JSZip.loadAsync(file.bytes);
  const byEntry = new Map<string, PendingEdit[]>();
  for (const e of edits) {
    const entry = e.chat.origin?.entry ?? '';
    byEntry.set(entry, [...(byEntry.get(entry) ?? []), e]);
  }

  const updates: SavedChat[] = [];
  const notes: string[] = [];
  for (const [entry, group] of byEntry) {
    const member = zip.file(entry);
    if (!member) throw new Error(`"${entry}" is no longer in ${file.name}.`);
    const result = applyToDocument(`${file.name}/${entry}`, await member.async('string'), group);
    zip.file(entry, result.text);
    updates.push(...result.updates);
    notes.push(...result.notes);
  }
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { bytes, updates, notes };
}

/** Compare two byte arrays. Used to check that a file has not changed since it was read. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
