// Write-back: apply edited messages to the structure of the source document they came from.
//
// Each parser records, for every visible message, where that message lives in the source
// (a flat array entry, a node in a conversation tree, or a markdown turn). An editor uses those
// references to change only what the user edited, leaving the rest of the file as it was.
// Parts of the source that the viewer never shows (hidden turns, empty entries) are kept.
import type { Message, Role } from './types';
import { imageUrl } from './imageUrl';

export type Slot = 'whole' | 'user' | 'reasoning' | 'answer';

/** Where a visible message is stored inside its source document. */
export type Ref =
  | { kind: 'item'; item: Record<string, any>; field: string }
  | { kind: 'node'; key: string; node: Record<string, any>; slot: Slot }
  | { kind: 'section'; index: number };

export interface ChatEdit {
  title: string;
  originalTitle: string;
  /** Messages as they were at the last load or save, in order. */
  original: Message[];
  /** The messages the user now wants. Unchanged messages keep their ids. */
  edited: Message[];
}

export interface Editor {
  /** Why this chat can't be written back, or null when it can. */
  readOnly: string | null;
  /** Apply the edit in place. Returns notes about anything that could not be stored. */
  write(edit: ChatEdit): string[];
  /** Markdown documents rebuild their text; JSON documents are serialised by the parser. */
  serialize?(): string;
}

/** Where the chat title is stored, or null when the format has nowhere to put it. */
export type TitleSlot = { holder: Record<string, any>; key: string } | null;

const TITLE_NOTE = "The title can't be stored in this file, so it was not saved.";

export function blockedEditor(reason: string): Editor {
  return {
    readOnly: reason,
    write() {
      throw new Error(reason);
    },
  };
}

export function newNodeId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function indexById(list: Message[]): Map<string, number> {
  const out = new Map<string, number>();
  list.forEach((m, i) => out.set(m.id, i));
  return out;
}

/** True when two message lists have the same roles and texts (ignoring surrounding whitespace). */
export function sameMessages(a: Message[], b: Message[]): boolean {
  return a.length === b.length && a.every((m, i) => m.role === b[i].role && m.text.trim() === b[i].text.trim());
}

/** The markdown lines the Qwen / Open WebUI parser generates for a user message's attachments. */
export function attachmentLines(files: unknown): string[] {
  const list = Array.isArray(files) ? files : [];
  return list.map((f: any) => {
    const name = String(f?.name ?? f?.filename ?? 'attachment');
    const isImage = f?.file_class === 'vision' || String(f?.file_type ?? '').startsWith('image/');
    if (isImage) return `![${name}](${f?.url ?? encodeURIComponent(name)})`;
    return `📎 ${name}`;
  });
}

/**
 * Remove the lines the parser generated (attachment links, image links) from a message text.
 * The parser joins them to the body with blank lines, so those separators go too. Everything else,
 * including the user's own blank lines, is kept exactly as typed.
 */
function removeGenerated(text: string, generated: string[]): string {
  let rest = text;
  for (const g of generated) {
    if (rest === g) rest = '';
    else if (rest.startsWith(g + '\n\n')) rest = rest.slice(g.length + 2);
    else if (rest.includes('\n\n' + g)) rest = rest.replace('\n\n' + g, '');
    else rest = rest.replace(g, '');
  }
  return rest.replace(/^\n\n/, '');
}

function writeTitle(title: TitleSlot, edit: ChatEdit, notes: string[]): void {
  if (edit.title === edit.originalTitle) return;
  if (!title) {
    notes.push(TITLE_NOTE);
    return;
  }
  title.holder[title.key] = edit.title.trim();
}

function uniq(notes: string[]): string[] {
  return [...new Set(notes)];
}

/* ------------------------------------------------------------------ */
/* Flat arrays: Claude `chat_messages`, generic `messages`, ChatGPT Exporter */
/* ------------------------------------------------------------------ */

/** Role names the ChatGPT Exporter writes ("Prompt" / "Response"). */
function exporterRoleLabel(role: Role): string {
  if (role === 'user') return 'Prompt';
  if (role === 'assistant') return 'Response';
  return role[0].toUpperCase() + role.slice(1);
}

/** The "7/5/2026, 7:43:01 AM" timestamp format the ChatGPT Exporter writes. */
function exporterTime(d: Date): string {
  return d.toLocaleString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function newFlatItem(format: 'claude' | 'generic' | 'exporter', m: Message): Record<string, unknown> {
  if (format === 'claude') return { sender: m.role === 'user' ? 'human' : m.role, text: m.text };
  if (format === 'exporter') {
    return { role: exporterRoleLabel(m.role), model: '', say: m.text, time: exporterTime(new Date()) };
  }
  return { role: m.role, content: m.text };
}

function setFlatRole(format: 'claude' | 'generic' | 'exporter', item: Record<string, any>, role: Role): void {
  if (format === 'claude') {
    item.sender = role === 'user' ? 'human' : role;
    return;
  }
  if (format === 'exporter') {
    item.role = exporterRoleLabel(role);
    return;
  }
  if ('role' in item) item.role = role;
  else if (item.author && typeof item.author === 'object') item.author.role = role;
  else if (typeof item.author === 'string') item.author = role;
  else if ('sender' in item) item.sender = role;
  else if ('from' in item) item.from = role;
  else item.role = role;
}

export function flatEditor(format: 'claude' | 'generic' | 'exporter', list: any[], refs: Ref[], title: TitleSlot): Editor {
  const visible = new Set<unknown>();
  for (const r of refs) if (r.kind === 'item') visible.add(r.item);

  return {
    readOnly: null,
    write(edit) {
      const notes: string[] = [];
      const idx = indexById(edit.original);
      const out: unknown[] = [];
      for (const m of edit.edited) {
        const i = idx.get(m.id);
        if (i === undefined) {
          out.push(newFlatItem(format, m));
          continue;
        }
        const ref = refs[i];
        if (ref?.kind !== 'item') throw new Error('Internal error: message has no source reference.');
        const before = edit.original[i];
        if (m.text !== before.text) ref.item[ref.field] = m.text;
        if (m.role !== before.role) setFlatRole(format, ref.item, m.role);
        out.push(ref.item);
      }
      // Entries that never produced a visible message (empty turns, odd shapes) stay, after the visible ones.
      const hidden = list.filter((x) => !visible.has(x));
      list.splice(0, list.length, ...out, ...hidden);
      writeTitle(title, edit, notes);
      return uniq(notes);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Conversation trees: ChatGPT `mapping`, Qwen / Open WebUI `history`  */
/* ------------------------------------------------------------------ */

export interface TreeInfo {
  format: 'chatgpt' | 'openwebui';
  /** The node table, keyed by node id. Mutated in place. */
  nodes: Record<string, any>;
  parentKey: 'parent' | 'parentId';
  childrenKey: 'children' | 'childrenIds';
  /** The node the visible chain hangs from (its parent). Null for a root. */
  anchor: string | null;
  refs: Ref[];
  setCurrent(id: string | null): void;
  title: TitleSlot;
}

function reaches(info: TreeInfo, from: string | null, target: string): boolean {
  const seen = new Set<string>();
  let c: string | null = from;
  while (c !== null && !seen.has(c)) {
    if (c === target) return true;
    seen.add(c);
    c = info.nodes[c]?.[info.parentKey] ?? null;
  }
  return false;
}

/** Take `id` out of its current parent's child list. */
function detach(info: TreeInfo, id: string): void {
  const old = info.nodes[id]?.[info.parentKey] ?? null;
  if (old !== null && info.nodes[old]) {
    info.nodes[old][info.childrenKey] = (info.nodes[old][info.childrenKey] ?? []).filter((x: string) => x !== id);
  }
}

/** Remove a node. Its children move up to its parent, so no other branch is lost. */
function removeNode(info: TreeInfo, id: string): void {
  const { nodes, parentKey: pk, childrenKey: ck } = info;
  const node = nodes[id];
  if (!node) return;
  const parent: string | null = node[pk] ?? null;
  const children: string[] = [...(node[ck] ?? [])];
  if (parent !== null && nodes[parent]) {
    const list: string[] = nodes[parent][ck] ?? [];
    const at = list.indexOf(id);
    const replaced = at >= 0 ? [...list.slice(0, at), ...children, ...list.slice(at + 1)] : [...list, ...children];
    nodes[parent][ck] = [...new Set(replaced)];
  }
  for (const c of children) if (nodes[c]) nodes[c][pk] = parent;
  delete nodes[id];
}

/** Make `ids` a single chain hanging from the anchor, in that order. Other branches are not touched. */
function relink(info: TreeInfo, ids: string[]): void {
  const { nodes, parentKey: pk, childrenKey: ck } = info;
  let cursor: string | null = info.anchor;
  for (const id of ids) {
    if (!nodes[id]) throw new Error('Internal error: missing node while relinking.');
    if (cursor !== null && reaches(info, cursor, id)) {
      throw new Error('This edit would create a loop in the conversation tree.');
    }
    const node = nodes[id];
    const inPlace =
      (node[pk] ?? null) === cursor && (cursor === null || (nodes[cursor]?.[ck] ?? []).includes(id));
    if (!inPlace) {
      detach(info, id);
      node[pk] = cursor;
      if (cursor !== null && nodes[cursor]) {
        const list: string[] = nodes[cursor][ck] ?? [];
        if (!list.includes(id)) list.push(id);
        nodes[cursor][ck] = list;
      }
    }
    cursor = id;
  }
}

function chatGPTRole(role: Role): string | null {
  return role === 'user' || role === 'assistant' || role === 'system' || role === 'tool' ? role : null;
}

function setChatGPTText(node: Record<string, any>, text: string): void {
  const msg = node.message;
  if (!msg) return;
  if (!msg.content || typeof msg.content !== 'object') msg.content = { content_type: 'text', parts: [] };
  const content = msg.content;
  if (typeof content.text === 'string') {
    content.text = text;
    return;
  }
  if (Array.isArray(content.parts)) {
    // Keep non-text parts (images and similar). The viewer shows those as "[image]" placeholders,
    // which the parser adds back when it reads the file, so strip them from the text here.
    const rest = content.parts.filter((p: unknown) => typeof p !== 'string');
    const clean = text
      .replace(/^\[image\](\n\n|$)/, '')
      .replace(/\n\n\[image\]$/, '')
      .replace(/\n\n\[image\](?=\n\n)/g, '');
    content.parts = [clean, ...rest];
    return;
  }
  content.parts = [text];
}

function newChatGPTNode(m: Message, notes: string[]): { id: string; node: Record<string, any> } {
  const id = newNodeId();
  let role = chatGPTRole(m.role);
  if (!role) {
    notes.push(`"${m.role}" messages are saved as assistant messages in this format.`);
    role = 'assistant';
  }
  return {
    id,
    node: {
      id,
      message: {
        id: newNodeId(),
        author: { role, name: null, metadata: {} },
        create_time: Date.now() / 1000,
        update_time: null,
        content: { content_type: 'text', parts: [m.text] },
        status: 'finished_successfully',
        end_turn: null,
        weight: 1,
        metadata: {},
        recipient: 'all',
      },
      parent: null,
      children: [],
    },
  };
}

export function chatGPTEditor(info: TreeInfo): Editor {
  return {
    readOnly: null,
    write(edit) {
      const notes: string[] = [];
      const idx = indexById(edit.original);
      const order: string[] = [];
      const kept = new Map<string, { node: Record<string, any>; m: Message; before: Message }>();

      for (const m of edit.edited) {
        const i = idx.get(m.id);
        if (i === undefined) {
          const created = newChatGPTNode(m, notes);
          info.nodes[created.id] = created.node;
          order.push(created.id);
          continue;
        }
        const ref = info.refs[i];
        if (ref?.kind !== 'node') throw new Error('Internal error: message has no source reference.');
        kept.set(ref.key, { node: ref.node, m, before: edit.original[i] });
        order.push(ref.key);
      }

      for (const ref of info.refs) {
        if (ref.kind === 'node' && !kept.has(ref.key)) removeNode(info, ref.key);
      }
      for (const { node, m, before } of kept.values()) {
        if (m.text !== before.text) setChatGPTText(node, m.text);
        if (m.role !== before.role) {
          const role = chatGPTRole(m.role);
          if (role && node.message) node.message.author = { ...(node.message.author ?? {}), role };
          else notes.push(`"${m.role}" messages are not supported in this format; the role was kept.`);
        }
      }

      relink(info, order);
      info.setCurrent(order.length ? order[order.length - 1] : info.anchor);
      writeTitle(info.title, edit, notes);
      return uniq(notes);
    },
  };
}

/* Qwen / Open WebUI: an assistant node holds reasoning, answer and image parts. */

function thinkingItem(text: string): Record<string, unknown> {
  return { content: text, phase: 'thinking_summary', status: 'finished', extra: null, role: 'assistant' };
}

function imageUrls(node: Record<string, any>): string[] {
  const items: any[] = Array.isArray(node.content_list) ? node.content_list : [];
  return items
    .filter((i) => i?.phase === 'image_gen' && typeof i.content === 'string' && i.content.trim())
    .map((i) => imageUrl(String(i.content)));
}

function writeReasoning(node: Record<string, any>, text: string): void {
  const items: any[] = Array.isArray(node.content_list) ? node.content_list : [];
  const others = items.filter((i) => i?.phase !== 'thinking_summary');
  if (typeof node.reasoning_content === 'string' && node.reasoning_content.trim() !== '') {
    // The parser reads this legacy field as reasoning, so store the text there.
    node.reasoning_content = text;
    node.content_list = others;
    return;
  }
  node.content_list = [thinkingItem(text), ...others];
}

function clearReasoning(node: Record<string, any>): void {
  const items: any[] = Array.isArray(node.content_list) ? node.content_list : [];
  node.content_list = items.filter((i) => i?.phase !== 'thinking_summary');
  if (typeof node.reasoning_content === 'string') node.reasoning_content = '';
}

function writeAnswer(node: Record<string, any>, text: string): void {
  const body = removeGenerated(
    text,
    imageUrls(node).map((u) => `![generated image](${u})`),
  );
  const items: any[] = Array.isArray(node.content_list) ? node.content_list : [];
  const out: any[] = [];
  let placed = false;
  for (const i of items) {
    if (i?.phase === 'answer') {
      // The first answer part takes the whole text; later answer parts are folded into it.
      if (!placed) {
        out.push({ ...i, content: body });
        placed = true;
      }
      continue;
    }
    out.push(i);
  }
  if (!placed) out.push({ content: body, phase: 'answer', status: 'finished', extra: null, role: 'assistant' });
  node.content_list = out;
}

function clearAnswer(node: Record<string, any>): void {
  const items: any[] = Array.isArray(node.content_list) ? node.content_list : [];
  node.content_list = items.filter((i) => i?.phase !== 'answer' && i?.phase !== 'image_gen');
  if (typeof node.content === 'string') node.content = '';
}

function writeSlot(node: Record<string, any>, slot: Slot, text: string): void {
  if (slot === 'user') node.content = removeGenerated(text, attachmentLines(node.files));
  else if (slot === 'whole') node.content = text;
  else if (slot === 'reasoning') writeReasoning(node, text);
  else writeAnswer(node, text);
}

function clearSlot(node: Record<string, any>, slot: Slot): void {
  if (slot === 'user' || slot === 'whole') node.content = '';
  else if (slot === 'reasoning') clearReasoning(node);
  else clearAnswer(node);
}

function normalizeNodeRole(raw: unknown): Role {
  return raw === 'system' || raw === 'tool' ? raw : 'other';
}

function newOpenWebUINode(role: Role, notes: string[]): { node: Record<string, any>; slot: Slot } {
  const id = newNodeId();
  const base = {
    id,
    content: '',
    files: [] as unknown[],
    timestamp: Math.floor(Date.now() / 1000),
    parentId: null,
    childrenIds: [] as string[],
    done: true,
    models: [] as string[],
  };
  if (role === 'user') return { node: { ...base, role: 'user' }, slot: 'user' };
  if (role === 'system' || role === 'tool') return { node: { ...base, role }, slot: 'whole' };
  if (role === 'other') notes.push('"other" messages are saved as assistant messages in this format.');
  const slot: Slot = role === 'reasoning' ? 'reasoning' : 'answer';
  return { node: { ...base, role: 'assistant', reasoning_content: null, content_list: [] }, slot };
}

export function openWebUIEditor(info: TreeInfo): Editor {
  return {
    readOnly: null,
    write(edit) {
      const notes: string[] = [];
      const idx = indexById(edit.original);

      // What each slot of each existing node holds, as last loaded or saved.
      const stored = new Map<string, Partial<Record<Slot, string>>>();
      info.refs.forEach((ref, i) => {
        if (ref.kind !== 'node') return;
        const slots = stored.get(ref.key) ?? {};
        slots[ref.slot] = edit.original[i].text;
        stored.set(ref.key, slots);
      });

      type Unit = { key: string; node: Record<string, any>; isNew: boolean; slots: Partial<Record<Slot, Message>> };
      const units: Unit[] = [];
      const byKey = new Map<string, Unit>();

      for (const m of edit.edited) {
        const i = idx.get(m.id);
        if (i !== undefined) {
          const ref = info.refs[i];
          if (ref?.kind !== 'node') throw new Error('Internal error: message has no source reference.');
          const existing = byKey.get(ref.key);
          const last = units[units.length - 1];
          let unit: Unit;
          if (existing && existing === last) {
            // Reasoning and answer of one node, still next to each other: keep them together.
            unit = existing;
          } else if (existing) {
            // This part of the node now sits apart from its other part (something was inserted
            // between them). It becomes a node of its own, so the edited order reads back exactly.
            const role: Role =
              ref.slot === 'user' ? 'user' : ref.slot === 'whole' ? normalizeNodeRole(ref.node.role) : ref.slot === 'reasoning' ? 'reasoning' : 'assistant';
            const created = newOpenWebUINode(role, notes);
            info.nodes[created.node.id] = created.node;
            unit = { key: created.node.id, node: created.node, isNew: true, slots: {} };
            units.push(unit);
          } else {
            unit = { key: ref.key, node: ref.node, isNew: false, slots: {} };
            byKey.set(ref.key, unit);
            units.push(unit);
          }
          unit.slots[ref.slot] = m;
          if (m.role !== edit.original[i].role) {
            notes.push('Changing a message’s role is not supported in this format; the original role was kept.');
          }
          continue;
        }
        // A new message. An assistant answer that follows new reasoning joins that reasoning node.
        const last = units[units.length - 1];
        if (m.role === 'assistant' && last?.isNew && last.slots.reasoning && !last.slots.answer) {
          last.slots.answer = m;
          continue;
        }
        const created = newOpenWebUINode(m.role, notes);
        info.nodes[created.node.id] = created.node;
        const unit: Unit = { key: created.node.id, node: created.node, isNew: true, slots: { [created.slot]: m } };
        units.push(unit);
        byKey.set(unit.key, unit);
      }

      for (const ref of info.refs) {
        if (ref.kind === 'node' && !byKey.has(ref.key)) removeNode(info, ref.key);
      }

      for (const unit of units) {
        const before = unit.isNew ? {} : stored.get(unit.key) ?? {};
        const slots = new Set<Slot>([...(Object.keys(before) as Slot[]), ...(Object.keys(unit.slots) as Slot[])]);
        for (const slot of slots) {
          const m = unit.slots[slot];
          const was = before[slot];
          if (m) {
            if (was === undefined || m.text !== was) writeSlot(unit.node, slot, m.text);
          } else if (was !== undefined) {
            clearSlot(unit.node, slot);
          }
        }
      }

      const order = units.map((u) => u.key);
      relink(info, order);
      info.setCurrent(order.length ? order[order.length - 1] : info.anchor);
      writeTitle(info.title, edit, notes);
      return uniq(notes);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Markdown transcripts                                                */
/* ------------------------------------------------------------------ */

export interface MdSection {
  /** The original heading line, kept so unchanged turns are written back verbatim. */
  heading: string;
  role: Role;
  /** Meta lines between the heading and the body (a timestamp, say), kept when the body is rewritten. */
  head?: string[];
  /** Every line after the heading, up to the next turn heading. */
  lines: string[];
}

export function turnHeading(role: Role): string {
  if (role === 'user') return '## 👤 User';
  if (role === 'reasoning') return '## 🤖 Model (Reasoning)';
  return '## 🤖 Model';
}

/** ChatGPT Exporter transcripts use "## Prompt:" / "## Response:" turn headings. */
export function exporterTurnHeading(role: Role): string {
  if (role === 'user') return '## Prompt:';
  if (role === 'reasoning') return '## Reasoning:';
  return '## Response:';
}

/** How a markdown transcript writes its turns. */
export interface MdStyle {
  /** Heading line for a newly written turn, or when a message's role changes. */
  turnHeading(role: Role): string;
  /** Lines written after the text of a newly written turn. */
  afterNewTurn: string[];
  /** Note when a role can only be stored as the format's assistant turn. */
  roleNote: string;
}

export const aistudioMdStyle: MdStyle = {
  turnHeading,
  afterNewTurn: ['', '---', ''],
  roleNote: 'System, tool and other messages are saved as Model turns in this format.',
};

export const exporterMdStyle: MdStyle = {
  turnHeading: exporterTurnHeading,
  afterNewTurn: [''],
  roleNote: 'System, tool and other messages are saved as Response turns in this format.',
};

/** Trailing blank lines and rules after a turn's body, so a rewritten turn keeps its separator. */
function tailOf(lines: string[]): string[] {
  let last = lines.length - 1;
  const isTail = (l: string) =>
    l.trim() === '' ||
    /^\s*(-{3,}|\*{3,})\s*$/.test(l) ||
    /^Powered by \[?ChatGPT Exporter/i.test(l);
  while (last >= 0 && isTail(lines[last])) last -= 1;
  return lines.slice(last + 1);
}

/**
 * `eol` is the line ending the file uses (\n or \r\n), so a file keeps its own line endings when written.
 * `style` says how turns are written; it defaults to the AI Studio heading style.
 */
export function markdownEditor(
  header: string[],
  sections: MdSection[],
  refs: Ref[],
  original: string,
  eol: '\n' | '\r\n' = '\n',
  style: MdStyle = aistudioMdStyle,
): Editor {
  let output: string | null = null;
  const withEol = (s: string) => (eol === '\n' ? s : s.replace(/\n/g, eol));
  return {
    readOnly: null,
    serialize() {
      return output ?? original;
    },
    write(edit) {
      const notes: string[] = [];

      if (sections.length === 0) {
        // A plain note has no turn headings: the whole file is its one message.
        if (edit.title !== edit.originalTitle) {
          notes.push('A plain markdown note has no title line, so the title was not saved.');
        }
        output = withEol(`${edit.edited.map((m) => m.text).join('\n\n')}\n`);
        return uniq(notes);
      }

      const hdr = [...header];
      if (edit.title !== edit.originalTitle) {
        const i = hdr.findIndex((l) => /^#\s+/.test(l));
        const title = edit.title.trim();
        if (i >= 0) hdr[i] = /\*\*Title:\*\*/.test(hdr[i]) ? `# **Title:** ${title}` : `# ${title}`;
        else hdr.unshift(`# ${title}`, '');
      }

      const out: string[] = [...hdr];
      const idx = indexById(edit.original);
      for (const m of edit.edited) {
        const i = idx.get(m.id);
        if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'reasoning') {
          notes.push(style.roleNote);
        }
        if (i === undefined) {
          out.push(style.turnHeading(m.role), '', m.text, ...style.afterNewTurn);
          continue;
        }
        const ref = refs[i];
        if (ref?.kind !== 'section') throw new Error('Internal error: message has no source reference.');
        const sec = sections[ref.index];
        const before = edit.original[i];
        if (m.text === before.text && m.role === before.role) {
          out.push(sec.heading, ...sec.lines);
          continue;
        }
        const heading = m.role === before.role ? sec.heading : style.turnHeading(m.role);
        out.push(heading, ...(sec.head ?? []), '', m.text, ...tailOf(sec.lines));
      }
      output = withEol(`${out.join('\n').replace(/\n*$/, '')}\n`);
      return uniq(notes);
    },
  };
}
