import type { Chat, Message, Role, SourceKind } from './types';
import { imageUrl } from './imageUrl';
import {
  attachmentLines,
  blockedEditor,
  chatGPTEditor,
  exporterMdStyle,
  flatEditor,
  markdownEditor,
  openWebUIEditor,
  type ChatEdit,
  type Editor,
  type MdSection,
  type Ref,
  type Slot,
  type TitleSlot,
} from './writeback';

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
  if (r === 'user' || r === 'human' || r === 'prompt') return 'user';
  if (['assistant', 'ai', 'model', 'bot', 'claude', 'chatgpt', 'response'].includes(r)) return 'assistant';
  if (r === 'system') return 'system';
  if (r === 'reasoning' || r === 'thinking') return 'reasoning';
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

/**
 * ChatGPT embeds interactive widgets as "genui" markers (private-use characters around a JSON
 * blob). They are not readable text, so they are dropped from what the viewer shows.
 */
function stripGenui(text: string): string {
  return text
    .replace(/\n{2,}\uE200genui\uE202[\s\S]*?\uE201\n{2,}/g, '\n\n')
    .replace(/^\uE200genui\uE202[\s\S]*?\uE201\n{0,2}/, '')
    .replace(/\n{0,2}\uE200genui\uE202[\s\S]*?\uE201$/, '')
    .replace(/\uE200genui\uE202[\s\S]*?\uE201/g, '');
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
  /** One reference per message, in the same order. */
  refs: Ref[];
  editor: Editor;
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
  const refs: Ref[] = [];
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
    refs.push({ kind: 'node', key: id, node: mapping[id], slot: 'whole' });
  }

  // The visible chain hangs from the parent of its first message; hidden nodes above that stay put.
  const anchor = refs.length
    ? ((refs[0] as { node: any }).node.parent ?? null)
    : path.length
      ? path[path.length - 1]
      : null;

  const editor = path.length
    ? chatGPTEditor({
        format: 'chatgpt',
        nodes: mapping,
        parentKey: 'parent',
        childrenKey: 'children',
        anchor,
        refs,
        setCurrent: (id) => {
          conv.current_node = id;
        },
        title: { holder: conv, key: 'title' },
      })
    : blockedEditor('This export has no current branch recorded, so it can be viewed but not saved.');

  return {
    title: typeof conv.title === 'string' ? conv.title : undefined,
    createdAt: toIso(conv.create_time),
    updatedAt: toIso(conv.update_time),
    messages,
    refs,
    editor,
  };
}

/** Claude export: { uuid, name, created_at, updated_at, chat_messages: [{ sender, text, content }] } */
function fromClaude(conv: any): Conversation {
  const list: any[] = Array.isArray(conv.chat_messages) ? conv.chat_messages : [];
  const messages: Message[] = [];
  const refs: Ref[] = [];
  for (const m of list) {
    const text =
      typeof m.text === 'string' && m.text.trim() ? m.text : extractText(m.content);
    if (!text.trim()) continue;
    messages.push({
      id: newId('m'),
      role: normalizeRole(m.sender ?? m.role),
      text,
      createdAt: toIso(m.created_at),
    });
    refs.push({ kind: 'item', item: m, field: 'text' });
  }
  return {
    title: typeof conv.name === 'string' ? conv.name : undefined,
    createdAt: toIso(conv.created_at),
    updatedAt: toIso(conv.updated_at),
    messages,
    refs,
    editor: flatEditor('claude', list, refs, { holder: conv, key: 'name' }),
  };
}

const GENERIC_TEXT_FIELDS = ['content', 'text', 'message', 'parts'] as const;

/** Generic: { title, messages: [{ role, content|text, createdAt }] } or a bare message array. */
function fromGeneric(conv: any, bare: boolean): Conversation {
  const list: any[] = conv.messages ?? conv.chat_messages ?? [];
  const messages: Message[] = [];
  const refs: Ref[] = [];
  for (const m of list) {
    if (!m || typeof m !== 'object') continue;
    const values = [m.content, m.text, m.message, m.parts].map((x) => extractText(x));
    const at = values.findIndex((t) => t.trim());
    if (at < 0) continue;
    const text = values[at];
    const roleRaw =
      m.role ?? (typeof m.author === 'object' ? m.author?.role : m.author) ?? m.sender ?? m.from;
    messages.push({
      id: newId('m'),
      role: normalizeRole(roleRaw),
      text,
      createdAt: toIso(m.createdAt ?? m.created_at ?? m.timestamp ?? m.create_time ?? m.time),
    });
    refs.push({ kind: 'item', item: m, field: GENERIC_TEXT_FIELDS[at] });
  }
  const titleKey = typeof conv.title === 'string' || !('name' in conv) ? 'title' : 'name';
  const title: TitleSlot = bare ? null : { holder: conv, key: titleKey };
  return {
    title: typeof conv.title === 'string' ? conv.title : typeof conv.name === 'string' ? conv.name : undefined,
    createdAt: toIso(conv.createdAt ?? conv.created_at ?? conv.create_time),
    updatedAt: toIso(conv.updatedAt ?? conv.updated_at ?? conv.update_time),
    messages,
    refs,
    editor: flatEditor('generic', list, refs, title),
  };
}

/** ChatGPT Exporter (chatgptexporter.com) JSON: { metadata, messages: [{ role, model, say, time }] }. */
function fromChatGPTExporter(conv: any, bare: boolean): Conversation {
  if (!conv.metadata || typeof conv.metadata !== 'object') conv.metadata = {};
  const meta: Record<string, any> = conv.metadata;
  const list: any[] = Array.isArray(conv.messages) ? conv.messages : [];
  const messages: Message[] = [];
  const refs: Ref[] = [];
  for (const m of list) {
    if (!m || typeof m !== 'object') continue;
    const field = 'say' in m ? 'say' : 'content' in m ? 'content' : 'text';
    const text = stripGenui(extractText(m[field]));
    if (!text.trim()) continue;
    messages.push({
      id: newId('m'),
      role: normalizeRole(m.role),
      text,
      createdAt: toIso(m.time ?? m.createdAt ?? m.created_at),
    });
    refs.push({ kind: 'item', item: m, field });
  }
  const dates: Record<string, any> = meta.dates && typeof meta.dates === 'object' ? meta.dates : {};
  return {
    title: typeof meta.title === 'string' ? meta.title : undefined,
    createdAt: toIso(dates.created ?? dates.createdAt),
    updatedAt: toIso(dates.updated ?? dates.updatedAt ?? dates.exported),
    messages,
    refs,
    editor: flatEditor('exporter', list, refs, bare ? null : { holder: meta, key: 'title' }),
  };
}

/* ------------------------------------------------------------------ */
/* File-level detection                                                */
/* ------------------------------------------------------------------ */

interface Found {
  kind: SourceKind;
  data: any;
  /** True when `data` was a bare array of messages wrapped by us (it is not part of the file's structure). */
  bare: boolean;
}

/**
 * Qwen Chat / Open WebUI-style export:
 * { id, title, created_at, updated_at, chat: { history: { messages: { id: msg }, currentId } } }
 * Messages form a tree (parentId / childrenIds). We follow the active branch from currentId
 * back to the root. Assistant output lives in content_list: 'answer' (text),
 * 'thinking_summary' (reasoning) and 'image_gen' (image URL).
 * One assistant node can yield a reasoning message and an answer message; both refer to that node.
 */
function fromOpenWebUI(conv: any): Conversation {
  const history = conv.chat?.history ?? {};
  const byId: Record<string, any> = history.messages ?? {};

  const path: string[] = [];
  const seen = new Set<string>();
  let cur: string | null | undefined = history.currentId ?? conv.currentId;
  while (cur && byId[cur] && !seen.has(cur)) {
    seen.add(cur);
    path.push(cur);
    cur = byId[cur].parentId;
  }
  path.reverse();

  const messages: Message[] = [];
  const refs: Ref[] = [];

  if (!path.length) {
    // Older layout: a flat chat.messages list. It is shown, but not saved back.
    const legacy: any[] = Array.isArray(conv.chat?.messages) ? conv.chat.messages : [];
    for (const m of legacy) {
      if (!m || typeof m !== 'object') continue;
      const role = normalizeRole(m.role);
      const text = extractText(m.content);
      if (text.trim()) messages.push({ id: newId('m'), role, text, createdAt: toIso(m.timestamp) });
    }
    return {
      title: typeof conv.title === 'string' ? conv.title : undefined,
      createdAt: toIso(conv.created_at),
      updatedAt: toIso(conv.updated_at),
      messages,
      refs,
      editor: blockedEditor('This export uses an older chat layout, so it can be viewed but not saved yet.'),
    };
  }

  const push = (role: Role, text: string, createdAt: string | undefined, key: string, node: any, slot: Slot) => {
    if (!text.trim()) return;
    messages.push({ id: newId('m'), role, text, createdAt });
    refs.push({ kind: 'node', key, node, slot });
  };

  for (const id of path) {
    const m = byId[id];
    if (!m || typeof m !== 'object') continue;
    const role = normalizeRole(m.role);
    const when = toIso(m.timestamp);
    const items: any[] = Array.isArray(m.content_list) ? m.content_list : [];

    if (role === 'user') {
      const attachments = attachmentLines(m.files);
      push('user', [...attachments, extractText(m.content)].filter(Boolean).join('\n\n'), when, id, m, 'user');
      continue;
    }

    if (role === 'assistant') {
      const thoughts = items
        .filter((i) => i?.phase === 'thinking_summary')
        .map((i) => {
          const title = (i.extra?.summary_title?.content ?? []).join(' ').trim();
          const thought = (i.extra?.summary_thought?.content ?? []).join('\n\n').trim();
          const body = typeof i.content === 'string' ? i.content.trim() : '';
          return [title ? `**${title}**` : '', thought, body].filter(Boolean).join('\n\n');
        });
      if (typeof m.reasoning_content === 'string') thoughts.push(m.reasoning_content);
      push('reasoning', thoughts.filter((t) => t.trim()).join('\n\n'), when, id, m, 'reasoning');

      const answer =
        items
          .filter((i) => i?.phase === 'answer')
          .map((i) => extractText(i.content))
          .filter(Boolean)
          .join('\n\n') || extractText(m.content);
      const images = items
        .filter((i) => i?.phase === 'image_gen' && typeof i.content === 'string' && i.content.trim())
        .map((i) => `![generated image](${imageUrl(i.content)})`);
      push('assistant', [answer, ...images].filter(Boolean).join('\n\n'), when, id, m, 'answer');
      continue;
    }

    push(role, extractText(m.content), when, id, m, 'whole');
  }

  // The visible chain hangs from the parent of its first message.
  const anchor = refs.length ? ((refs[0] as { node: any }).node.parentId ?? null) : path[path.length - 1];

  const editor = openWebUIEditor({
    format: 'openwebui',
    nodes: byId,
    parentKey: 'parentId',
    childrenKey: 'childrenIds',
    anchor,
    refs,
    setCurrent: (id) => {
      history.currentId = id;
      if ('currentId' in conv) conv.currentId = id;
    },
    title: { holder: conv, key: 'title' },
  });

  return {
    title: typeof conv.title === 'string' ? conv.title : undefined,
    createdAt: toIso(conv.created_at),
    updatedAt: toIso(conv.updated_at),
    messages,
    refs,
    editor,
  };
}

function looksLikeMessage(x: unknown): boolean {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  if ('mapping' in o || 'messages' in o || 'chat_messages' in o) return false;
  return ('role' in o || 'sender' in o || 'author' in o) && ('content' in o || 'text' in o);
}

/** ChatGPT Exporter JSON: messages carry their text in `say`, with a `metadata` header. */
function isChatGPTExporter(data: any): boolean {
  if (!data || typeof data !== 'object' || !Array.isArray(data.messages)) return false;
  if (data.messages.some((m: any) => m && typeof m === 'object' && 'say' in m)) return true;
  return typeof data.metadata?.powered_by === 'string' && /chatgpt\s*exporter/i.test(data.metadata.powered_by);
}

function findConversations(data: any, depth = 0): Found[] {
  if (data == null || depth > 4) return [];
  if (Array.isArray(data)) {
    if (data.length > 0 && data.every(looksLikeMessage)) {
      return [{ kind: 'generic', data: { messages: data }, bare: true }];
    }
    return data.flatMap((d) => findConversations(d, depth + 1));
  }
  if (typeof data !== 'object') return [];
  if (data.mapping && typeof data.mapping === 'object') return [{ kind: 'chatgpt', data, bare: false }];
  if (data.chat && typeof data.chat === 'object' && (data.chat.history || Array.isArray(data.chat.messages))) {
    return [{ kind: 'openwebui', data, bare: false }];
  }
  if (Array.isArray(data.chat_messages)) return [{ kind: 'claude', data, bare: false }];
  if (isChatGPTExporter(data)) return [{ kind: 'chatgptexporter', data, bare: false }];
  if (Array.isArray(data.messages)) return [{ kind: 'generic', data, bare: false }];
  if (Array.isArray(data.conversations)) return findConversations(data.conversations, depth + 1);
  return [];
}

/** Parses JSON, or JSON Lines (one JSON value per line). */
function parseJsonOrJsonl(text: string): { data: unknown; jsonl: boolean } {
  try {
    return { data: JSON.parse(text), jsonl: false };
  } catch (firstErr) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    try {
      return { data: lines.map((l) => JSON.parse(l)), jsonl: true };
    } catch {
      throw firstErr;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

/**
 * One source document (a JSON or markdown file, or one entry of a zip) parsed with the means to
 * write edits back. Writing changes the document's structure in place; `serialize` then gives the
 * new text. Chat indexes match `chats`.
 */
export interface ChatDocument {
  chats: Chat[];
  /** Apply the edits to chat `index`. Throws if that chat can't be written back. */
  write(index: number, edit: ChatEdit): string[];
  /** The document text, including any edits applied so far. */
  serialize(): string;
}

/** Parse one uploaded file into one or more chats. Throws a readable Error if it is not understood. */
export function parseChatFile(fileName: string, text: string): Chat[] {
  return parseChatDocument(fileName, text).chats;
}

export function parseChatDocument(fileName: string, text: string): ChatDocument {
  if (/\.(md|markdown|txt)$/i.test(fileName)) return markdownDocument(fileName, text);
  return jsonDocument(fileName, text);
}

function jsonDocument(fileName: string, text: string): ChatDocument {
  let parsed: { data: unknown; jsonl: boolean };
  try {
    parsed = parseJsonOrJsonl(text);
  } catch (e) {
    throw new Error(`${fileName}: not valid JSON (${(e as Error).message})`);
  }
  const { data, jsonl } = parsed;

  const found = findConversations(data);
  if (found.length === 0) {
    throw new Error(`${fileName}: no chats recognised (expected ChatGPT, Claude, or a {messages:[…]} format)`);
  }

  const editors: Editor[] = [];
  const chats: Chat[] = found.map(({ kind, data: raw, bare }) => {
    const conv =
      kind === 'chatgpt'
        ? fromChatGPT(raw)
        : kind === 'claude'
          ? fromClaude(raw)
          : kind === 'openwebui'
            ? fromOpenWebUI(raw)
            : kind === 'chatgptexporter'
              ? fromChatGPTExporter(raw, bare)
              : fromGeneric(raw, bare);
    const title = conv.title?.trim() || deriveTitle(conv.messages) || `Untitled (${fileName})`;
    editors.push(conv.editor);
    return {
      id: newId('chat'),
      fileName,
      source: kind,
      title,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      messages: conv.messages,
      original: { title, messages: conv.messages },
      dirty: false,
      writeBlocked: conv.editor.readOnly,
    };
  });

  return {
    chats,
    write(index, edit) {
      const editor = editors[index];
      if (!editor) throw new Error(`${fileName}: no chat at position ${index}`);
      if (editor.readOnly) throw new Error(editor.readOnly);
      return editor.write(edit);
    },
    serialize() {
      if (jsonl) {
        return `${(data as unknown[]).map((line) => JSON.stringify(line)).join('\n')}\n`;
      }
      return `${JSON.stringify(data, null, 2)}\n`;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Markdown transcripts (AI Studio, ChatGPT Exporter, plain notes)     */
/* ------------------------------------------------------------------ */

/**
 * Turn headings such as "## 👤 User", "## 🤖 Model" and "## 🤖 Model (Reasoning)".
 * Only exact turn headings match, so ordinary "## Topic" headings stay inside the text.
 */
const TURN_HEADING = /^##\s+(?:\S+\s+)?(User|Model)(?:\s*\((Reasoning)\))?\s*$/;

/** ChatGPT Exporter turn headings: "## Prompt:", "## Response:" (the colon is optional). */
const EXPORTER_TURN = /^##\s+(Prompt|Response|Reasoning|System|Tool)\s*:?\s*$/;

/** Timestamp line the ChatGPT Exporter puts right after a turn heading: "7/5/2026, 7:43:01 AM · gpt-5-5". */
const EXPORTER_STAMP = /^(\d{1,2}\/\d{1,2}\/\d{4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)(?:\s*·.*)?$/i;

/** The "Powered by ChatGPT Exporter" footer the exporter appends at the end of the document. */
const EXPORTER_FOOTER = /\s*Powered by \[?ChatGPT Exporter[\s\S]*$/i;

function trimTrailingRules(s: string): string {
  let out = s.trim();
  while (/(^|\n)\s*(-{3,}|\*{3,})\s*$/.test(out)) {
    out = out.replace(/(^|\n)\s*(-{3,}|\*{3,})\s*$/, '').trim();
  }
  return out;
}

/** The turn a heading starts, and which transcript style it belongs to. */
function turnRole(line: string): { role: Role; style: 'aistudio' | 'exporter' } | null {
  const exp = EXPORTER_TURN.exec(line);
  if (exp) {
    const word = exp[1].toLowerCase();
    const role: Role = word === 'prompt' ? 'user' : word === 'response' ? 'assistant' : (word as Role);
    return { role, style: 'exporter' };
  }
  const ai = TURN_HEADING.exec(line);
  if (ai) {
    const role: Role = ai[1] === 'User' ? 'user' : ai[2] ? 'reasoning' : 'assistant';
    return { role, style: 'aistudio' };
  }
  return null;
}

/**
 * Parse a markdown transcript into one chat. Turns are split on turn headings;
 * image attachments become markdown image links that the viewer resolves against
 * images loaded alongside the file.
 */
function markdownDocument(fileName: string, text: string): ChatDocument {
  const lines = text.split(/\r?\n/);

  const h1 = lines.find((l) => /^#\s+/.test(l));
  const headingTitle = h1
    ?.replace(/^#\s+/, '')
    .replace(/\*\*/g, '')
    .replace(/^Title:\s*/i, '')
    .trim();
  const exported = /Exported on:\s*(.+)$/m.exec(text)?.[1]?.trim();
  const exportedIso = exported ? toIso(Date.parse(exported)) : undefined;

  let firstTurn = -1;
  let style: 'aistudio' | 'exporter' = 'aistudio';
  for (let i = 0; i < lines.length; i++) {
    const turn = turnRole(lines[i]);
    if (turn) {
      firstTurn = i;
      style = turn.style;
      break;
    }
  }
  const header = firstTurn < 0 ? lines : lines.slice(0, firstTurn);
  const headerText = header.join('\n');

  // ChatGPT Exporter writes its dates as bold labels in the header.
  const created = /\*\*Created:\*\*\s*(.+)$/m.exec(headerText)?.[1]?.trim();
  const updated = /\*\*Updated:\*\*\s*(.+)$/m.exec(headerText)?.[1]?.trim();
  const expExported = /\*\*Exported:\*\*\s*(.+)$/m.exec(headerText)?.[1]?.trim();

  const sections: MdSection[] = [];
  for (const line of lines.slice(firstTurn < 0 ? lines.length : firstTurn)) {
    const turn = turnRole(line);
    if (turn) {
      sections.push({ heading: line, role: turn.role, lines: [] });
    } else if (sections.length) {
      sections[sections.length - 1].lines.push(line);
    }
  }

  const messages: Message[] = [];
  const refs: Ref[] = [];
  let source: SourceKind;
  if (sections.length > 0) {
    source = style === 'exporter' ? 'chatgptexporter' : 'aistudio';
    sections.forEach((sec, index) => {
      let rest = sec.lines;
      let createdAt: string | undefined;
      if (style === 'exporter') {
        // The timestamp line after the heading becomes the message time; it is kept for write-back.
        const take =
          rest.length > 0 && EXPORTER_STAMP.test(rest[0])
            ? 1
            : rest.length > 1 && rest[0].trim() === '' && EXPORTER_STAMP.test(rest[1])
              ? 2
              : 0;
        if (take > 0) {
          sec.head = rest.slice(0, take);
          rest = rest.slice(take);
          const stamp = sec.head.map((l) => EXPORTER_STAMP.exec(l)).find((m) => m);
          createdAt = stamp ? toIso(stamp[1]) : undefined;
        }
      }
      let body = rest.join('\n');
      if (style === 'exporter') {
        body = stripGenui(body.replace(EXPORTER_FOOTER, ''));
      } else if (sec.role === 'user') {
        // Attachment blocks: keep only the image link itself, rendered inline.
        body = body
          .replace(/\*\*Image Attachment:\*\*/g, '')
          .replace(/^\s*File Name:.*$/gm, '')
          .replace(/^\s*Image:\s*(\!\[[^\]]*\]\([^)]*\))/gm, '$1');
      }
      body = trimTrailingRules(body);
      if (!body) return;
      messages.push({ id: newId('m'), role: sec.role, text: body, createdAt });
      refs.push({ kind: 'section', index });
    });
  } else {
    // No turn headings: treat the whole document as one note.
    source = 'markdown';
    if (text.trim()) messages.push({ id: newId('m'), role: 'other', text: text.trim() });
  }

  if (messages.length === 0) {
    throw new Error(`${fileName}: no chat content found in markdown`);
  }

  const title = headingTitle || deriveTitle(messages) || fileName.replace(/\.[^.]+$/, '');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const editor = markdownEditor(header, sections, refs, text, eol, style === 'exporter' ? exporterMdStyle : undefined);
  const chat: Chat = {
    id: newId('chat'),
    fileName,
    source,
    title,
    createdAt: created ? toIso(created) : undefined,
    updatedAt: updated ? toIso(updated) : expExported ? toIso(expExported) : exportedIso,
    messages,
    original: { title, messages },
    dirty: false,
    writeBlocked: null,
  };

  return {
    chats: [chat],
    write(index, edit) {
      if (index !== 0) throw new Error(`${fileName}: no chat at position ${index}`);
      return editor.write(edit);
    },
    serialize() {
      return editor.serialize?.() ?? text;
    },
  };
}

/** Export for tests and callers that only need the chats of a markdown transcript. */
export function parseMarkdownChat(fileName: string, text: string): Chat[] {
  return markdownDocument(fileName, text).chats;
}
