export type Role = 'user' | 'assistant' | 'system' | 'tool' | 'other';

export type SourceKind = 'chatgpt' | 'claude' | 'generic';

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

export interface Chat {
  id: string;
  fileName: string;
  source: SourceKind;
  title: string;
  createdAt?: string;
  updatedAt?: string;
  messages: Message[];
  /** Snapshot taken at load time, used by "Revert". */
  original: ChatSnapshot;
  dirty: boolean;
}
