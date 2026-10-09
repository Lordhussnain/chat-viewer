import type { Chat, Message, Role, SourceKind } from './types';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function normalizeRole(raw: unknown): Role {
  const r = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (r === 'user' || r === 'human') return 'user';
  if (['assistant', 'ai', 'model', 'bot', 'claude', 'chatgpt'].includes(r)) return 'assistant';
  if (r === 'system') return 'system';
  if (['tool', 'function', 'ipython', 'tool_result'].includes(r)) return 'tool';
  return 'other';
}

/** Turn any reasonable content shape (string, block array, parts, {text}) into plain text. */
export function extractText(v: unknown, depth = 0): string {
  if (v == null || depth > 20) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    return v
      .map((x) => extractText(x, depth + 1))
      .filter((s) => s.length > 0)
      .join('\n\n');
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const contentType = String(o.content_type ?? o.type ?? '');
    if (contentType.includes('image')) return '[image]';
    if (typeof o.text === 'string') return o.text;
    if ('parts' in o) return extractText(o.parts, depth + 1);
    if ('content' in o) return extractText(o.content, depth + 1);
  }
  return '';
}

/** Accepts unix seconds, unix ms, or an ISO-like string. Returns ISO or undefined. */
export function toIso(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = v < 1e11 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (typeof v === 'string' && v.trim()) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  return undefined;
}

function deriveTitle(messages: Message[]): string {
  const first = messages.find((m) => m.role === 'user') ?? messages[0];
  if (!first) return '';
  const line = first.text.trim().split('\n')[0] ?? '';
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}

/* ------------------------------------------------------------------ */
/* Format adapters                                                     */
/* ------------------------------------------------------------------ */

interface Conversation {
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  messages: Message[];
}

/** ChatGPT export: { title, mapping: { id: { message, parent, children } }, current_node } */
function fromChatGPT(conv: any): Conversation {
  const mapping: Record<string, any> = conv.mapping ?? {};
  const path: string[] = [];
  const seen = new Set<string>();
  let cur: string | null | undefined = conv.current_node;
  while (cur && mapping[cur] && !seen.has(cur)) {
    seen.add(cur);
    path.push(cur);
    cur = mapping[cur].parent;
  }
  path.reverse();

  // Fallback when current_node is missing: order every message by create_time.
  const ids = path.length
    ? path
    : Object.keys(mapping)
        .filter((k) => mapping[k]?.message)
        .sort((a, b) => (mapping[a].message.create_time ?? 0) - (mapping[b].message.create_time ?? 0));

  const messages: Message[] = [];
  for (const id of ids) {
    const msg = mapping[id]?.message;
    if (!msg || msg.metadata?.is_visually_hidden_from_conversation) continue;
    const ct = msg.content ?? {};
    if (ct.content_type === 'thoughts' || ct.content_type === 'reasoning_recap') continue;
    const text = extractText(ct);
    if (!text.trim()) continue;
    messages.push({
      id: newId('m'),
      role: normalizeRole(msg.author?.role),
      text,
      createdAt: toIso(msg.create_time),
    });
  }

  return {
    title: typeof conv.title === 'string' ? conv.title : undefined,
    createdAt: toIso(conv.create_time),
    updatedAt: toIso(conv.update_time),
    messages,
  };
}

/** Claude export: { uuid, name, created_at, updated_at, chat_messages: [{ sender, text, content }] } */
function fromClaude(conv: any): Conversation {
  const messages: Message[] = [];
  for (const m of conv.chat_messages ?? []) {
    const text =
      typeof m.text === 'string' && m.text.trim() ? m.text : extractText(m.content);
    if (!text.trim()) continue;
    messages.push({
      id: newId('m'),
      role: normalizeRole(m.sender ?? m.role),
      text,
      createdAt: toIso(m.created_at),
    });
  }
  return {
    title: typeof conv.name === 'string' ? conv.name : undefined,
    createdAt: toIso(conv.created_at),
    updatedAt: toIso(conv.updated_at),
    messages,
  };
}

/** Generic: { title, messages: [{ role, content|text, createdAt }] } or a bare message array. */
function fromGeneric(conv: any): Conversation {
  const list: any[] = conv.messages ?? conv.chat_messages ?? [];
  const messages: Message[] = [];
  for (const m of list) {
    if (!m || typeof m !== 'object') continue;
    const text =
      [m.content, m.text, m.message, m.parts].map((x) => extractText(x)).find((t) => t.trim()) ?? '';
    if (!text.trim()) continue;
    const roleRaw =
      m.role ?? (typeof m.author === 'object' ? m.author?.role : m.author) ?? m.sender ?? m.from;
    messages.push({
      id: newId('m'),
      role: normalizeRole(roleRaw),
      text,
      createdAt: toIso(m.createdAt ?? m.created_at ?? m.timestamp ?? m.create_time ?? m.time),
    });
  }
  return {
    title: typeof conv.title === 'string' ? conv.title : typeof conv.name === 'string' ? conv.name : undefined,
    createdAt: toIso(conv.createdAt ?? conv.created_at ?? conv.create_time),
    updatedAt: toIso(conv.updatedAt ?? conv.updated_at ?? conv.update_time),
    messages,
  };
}

/* ------------------------------------------------------------------ */
/* File-level detection                                                */
/* ------------------------------------------------------------------ */

interface Found {
  kind: SourceKind;
  data: any;
}

function looksLikeMessage(x: unknown): boolean {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  if ('mapping' in o || 'messages' in o || 'chat_messages' in o) return false;
  return ('role' in o || 'sender' in o || 'author' in o) && ('content' in o || 'text' in o);
}

function findConversations(data: any, depth = 0): Found[] {
  if (data == null || depth > 4) return [];
  if (Array.isArray(data)) {
    if (data.length > 0 && data.every(looksLikeMessage)) {
      return [{ kind: 'generic', data: { messages: data } }];
    }
    return data.flatMap((d) => findConversations(d, depth + 1));
  }
  if (typeof data !== 'object') return [];
  if (data.mapping && typeof data.mapping === 'object') return [{ kind: 'chatgpt', data }];
  if (Array.isArray(data.chat_messages)) return [{ kind: 'claude', data }];
  if (Array.isArray(data.messages)) return [{ kind: 'generic', data }];
  if (Array.isArray(data.conversations)) return findConversations(data.conversations, depth + 1);
  return [];
}

/** Parses JSON, or JSON Lines (one JSON value per line). */
function parseJsonOrJsonl(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (firstErr) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    try {
      return lines.map((l) => JSON.parse(l));
    } catch {
      throw firstErr;
    }
  }
}

/**
 * Parse one uploaded file into one or more chats.
 * Throws a readable Error if the file is not JSON or the shape is unknown.
 */
export function parseChatFile(fileName: string, text: string): Chat[] {
  let data: unknown;
  try {
    data = parseJsonOrJsonl(text);
  } catch (e) {
    throw new Error(`${fileName}: not valid JSON (${(e as Error).message})`);
  }

  const found = findConversations(data);
  if (found.length === 0) {
    throw new Error(`${fileName}: no chats recognised (expected ChatGPT, Claude, or a {messages:[…]} format)`);
  }

  return found.map(({ kind, data: raw }) => {
    const conv =
      kind === 'chatgpt' ? fromChatGPT(raw) : kind === 'claude' ? fromClaude(raw) : fromGeneric(raw);
    const title = conv.title?.trim() || deriveTitle(conv.messages) || `Untitled (${fileName})`;
    const messages = conv.messages;
    return {
      id: newId('chat'),
      fileName,
      source: kind,
      title,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      messages,
      original: { title, messages },
      dirty: false,
    };
  });
}
