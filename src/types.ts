export type Role = 'user' | 'assistant' | 'reasoning' | 'system' | 'tool' | 'other';

export type SourceKind =
  | 'chatgpt'
  | 'chatgptexporter'
  | 'claude'
  | 'openwebui'
  | 'generic'
  | 'aistudio'
  | 'markdown';

export interface Message {
  id: string;
  role: Role;
  text: string;
  createdAt?: string;
}

export interface ChatSnapshot {
  title: string;
  messages: Message[];
}

/** Where a chat's data lives in the file it was loaded from. */
export interface ChatOrigin {
  /** Id of the loaded file (see LoadedFile). */
  fileId: string;
  /** Zip entry name, when the chat came from inside a zip. */
  entry?: string;
  /** Position of the chat among the chats parsed from that document. */
  index: number;
}

export interface Chat {
  id: string;
  fileName: string;
  source: SourceKind;
  title: string;
  createdAt?: string;
  updatedAt?: string;
  messages: Message[];
  /** Snapshot taken at load time (and after each save), used by "Revert". */
  original: ChatSnapshot;
  dirty: boolean;
  /** Set when the file came from a loaded source; undefined for chats not tied to a file. */
  origin?: ChatOrigin;
  /** Why this chat can't be saved back to its file (for example, an older export layout). */
  writeBlocked?: string | null;
}

/** Where a loaded file can be written back to. */
export type WriteTarget = { kind: 'handle'; handle: FileSystemFileHandle } | { kind: 'path'; path: string };

/** A file the user opened, with the bytes it had when it was read. */
export interface LoadedFile {
  id: string;
  name: string;
  /** True for .zip archives, whose chats live in entries. */
  zip: boolean;
  /** The bytes as last read from, or last written by a save. Used as the base for the next save. */
  bytes: Uint8Array;
  /** Where saves go. Undefined means the file can only be exported. */
  target?: WriteTarget;
}
