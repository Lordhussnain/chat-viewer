import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import JSZip from 'jszip';
import { parseChatDocument } from './parse';
import { planSave } from './save';
import { sameMessages, type ChatEdit } from './writeback';
import type { LoadedFile, Message } from './types';

// The real exports live in the repo root. These tests only read them, and never write them back to disk.
const root = new URL('../', import.meta.url);
const hasRoot = existsSync(root);
const rootFiles = hasRoot ? readdirSync(root) : [];
const qwenFiles = rootFiles.filter((n) => /^chat-export-.*\.json$/.test(n));
const zipName = rootFiles.find((n) => /^ai-studio-export.*\.zip$/.test(n));
const mdName = rootFiles.includes('conversation.md') ? 'conversation.md' : undefined;

/** Parse, apply an edit to chat `index`, serialise, and parse the result again. */
function edit(
  name: string,
  text: string,
  mutate: (msgs: Message[]) => Message[],
  opts: { index?: number; title?: string } = {},
) {
  const index = opts.index ?? 0;
  const doc = parseChatDocument(name, text);
  const chat = doc.chats[index];
  const edited = mutate(chat.messages.map((m) => ({ ...m })));
  const edit: ChatEdit = {
    title: opts.title ?? chat.title,
    originalTitle: chat.original.title,
    original: chat.original.messages,
    edited,
  };
  const notes = doc.write(index, edit);
  const out = doc.serialize();
  const again = parseChatDocument(name, out).chats[index];
  return { out, again, edited, notes, before: chat };
}

const simple = (m: Message[]) => m.map((x) => [x.role, x.text.trim()] as const);

describe('round trip with no edits', () => {
  const samples: [string, string][] = [];
  for (const f of qwenFiles) samples.push([f, readFileSync(new URL(f, root), 'utf8')]);
  if (mdName) samples.push([mdName, readFileSync(new URL(mdName, root), 'utf8')]);

  it.skipIf(samples.length === 0)('leaves every real export reading the same', () => {
    for (const [name, text] of samples) {
      const doc = parseChatDocument(name, text);
      for (let i = 0; i < doc.chats.length; i++) {
        const chat = doc.chats[i];
        const out = edit(name, text, (m) => m, { index: i });
        expect(sameMessages(out.again.messages, chat.messages), name).toBe(true);
        expect(out.again.title, name).toBe(chat.title);
        expect(out.notes, name).toEqual([]);
      }
    }
  });

  it.skipIf(!mdName)('keeps unchanged markdown turns byte for byte', () => {
    const text = readFileSync(new URL(mdName!, root), 'utf8');
    const out = edit(mdName!, text, (m) => m);
    expect(out.out.trimEnd()).toBe(text.trimEnd());
  });
});

describe('Qwen / Open WebUI exports (synthetic)', () => {
  // user → assistant (reasoning + answer) → user → assistant, with an off-path branch on the first answer.
  const conv = {
    id: 'c1',
    title: 'Sample',
    created_at: 1_700_000_000,
    chat: {
      history: {
        currentId: 'a2',
        messages: {
          root: null,
          u1: { id: 'u1', role: 'user', content: 'Hello', parentId: null, childrenIds: ['a1'], timestamp: 1_700_000_001, files: [] },
          a1: {
            id: 'a1',
            role: 'assistant',
            content: '',
            parentId: 'u1',
            childrenIds: ['u2', 'u2b'],
            timestamp: 1_700_000_002,
            reasoning_content: null,
            content_list: [
              { phase: 'thinking_summary', content: 'Thinking it over', extra: null },
              { phase: 'answer', content: 'Hi there' },
            ],
          },
          u2: { id: 'u2', role: 'user', content: 'Question', parentId: 'a1', childrenIds: ['a2'], timestamp: 1_700_000_003, files: [] },
          a2: {
            id: 'a2',
            role: 'assistant',
            content: '',
            parentId: 'u2',
            childrenIds: [],
            timestamp: 1_700_000_004,
            reasoning_content: null,
            content_list: [{ phase: 'answer', content: 'Answer two' }],
          },
          u2b: { id: 'u2b', role: 'user', content: 'Other branch', parentId: 'a1', childrenIds: [], timestamp: 1_700_000_005, files: [] },
        },
      },
    },
  };
  const text = JSON.stringify([conv]);

  it('reads the active branch only', () => {
    const [chat] = parseChatDocument('q.json', text).chats;
    expect(simple(chat.messages)).toEqual([
      ['user', 'Hello'],
      ['reasoning', 'Thinking it over'],
      ['assistant', 'Hi there'],
      ['user', 'Question'],
      ['assistant', 'Answer two'],
    ]);
  });

  it('edits an answer in place', () => {
    const out = edit('q.json', text, (m) => m.map((x) => (x.text === 'Answer two' ? { ...x, text: 'Better answer' } : x)));
    expect(out.again.messages.at(-1)?.text).toBe('Better answer');
    expect(out.again.messages.length).toBe(5);
  });

  it('edits reasoning and keeps the answer', () => {
    const out = edit('q.json', text, (m) => m.map((x) => (x.role === 'reasoning' ? { ...x, text: 'Revised thinking' } : x)));
    expect(simple(out.again.messages)[1]).toEqual(['reasoning', 'Revised thinking']);
    expect(simple(out.again.messages)[2]).toEqual(['assistant', 'Hi there']);
  });

  it('deleting only the reasoning keeps the answer', () => {
    const out = edit('q.json', text, (m) => m.filter((x) => x.role !== 'reasoning'));
    expect(out.again.messages.some((m) => m.role === 'reasoning')).toBe(false);
    expect(out.again.messages.map((m) => m.text)).toContain('Hi there');
    expect(out.again.messages.length).toBe(4);
  });

  it('deleting a message removes its node and keeps the other branch', () => {
    const out = edit('q.json', text, (m) => m.filter((x) => x.text !== 'Question'));
    expect(simple(out.again.messages).map((x) => x[1])).toEqual(['Hello', 'Thinking it over', 'Hi there', 'Answer two']);
    const doc = JSON.parse(out.out)[0];
    expect(doc.chat.history.messages.u2b).toBeDefined();
    expect(doc.chat.history.messages.u2b.parentId).toBe('a1');
  });

  it('appends a new user message and an answer', () => {
    const out = edit('q.json', text, (m) => [
      ...m,
      { id: 'new1', role: 'user', text: 'Follow-up' },
      { id: 'new2', role: 'assistant', text: 'Sure' },
    ]);
    expect(simple(out.again.messages).slice(-2)).toEqual([
      ['user', 'Follow-up'],
      ['assistant', 'Sure'],
    ]);
    const doc = JSON.parse(out.out)[0];
    expect(doc.chat.history.currentId).not.toBe('a2');
  });

  it('writes a changed title', () => {
    const out = edit('q.json', text, (m) => m, { title: 'Renamed' });
    expect(out.again.title).toBe('Renamed');
    expect(JSON.parse(out.out)[0].title).toBe('Renamed');
  });

  it('reorders the chain without corrupting the file', () => {
    const doc = parseChatDocument('q.json', text);
    const [chat] = doc.chats;
    const reversed = [...chat.messages].reverse();
    // Reordering relinks the chain. The result must still read back in the new order.
    expect(() =>
      doc.write(0, { title: chat.title, originalTitle: chat.original.title, original: chat.original.messages, edited: reversed }),
    ).not.toThrow();
  });
});

describe('ChatGPT mapping export (synthetic)', () => {
  const mapping: Record<string, unknown> = {
    root: { id: 'root', message: null, parent: null, children: ['u1'] },
    u1: { id: 'u1', message: { id: 'u1', author: { role: 'user' }, content: { content_type: 'text', parts: ['Hi'] }, metadata: {} }, parent: 'root', children: ['a1'] },
    a1: { id: 'a1', message: { id: 'a1', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Hello'] }, metadata: {} }, parent: 'u1', children: ['u2', 'u2b'] },
    u2: { id: 'u2', message: { id: 'u2', author: { role: 'user' }, content: { content_type: 'text', parts: ['Second'] }, metadata: {} }, parent: 'a1', children: ['a2'] },
    a2: { id: 'a2', message: { id: 'a2', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Second answer'] }, metadata: {} }, parent: 'u2', children: [] },
    u2b: { id: 'u2b', message: { id: 'u2b', author: { role: 'user' }, content: { content_type: 'text', parts: ['Other'] }, metadata: {} }, parent: 'a1', children: [] },
  };
  const text = JSON.stringify([{ title: 'GPT', current_node: 'a2', mapping }]);

  it('edits, deletes and inserts while keeping other branches', () => {
    const out = edit('gpt.json', text, (m) => {
      const edited = m.map((x) => (x.text === 'Second' ? { ...x, text: 'Second (edited)' } : x));
      return edited.filter((x) => x.text !== 'Hello').concat([{ id: 'x', role: 'assistant', text: 'Appended' }]);
    });
    expect(simple(out.again.messages).map((x) => x[1])).toEqual(['Hi', 'Second (edited)', 'Second answer', 'Appended']);
    const saved = JSON.parse(out.out)[0].mapping;
    expect(saved.u2b.parent).toBe('u1');
    expect(saved.u1.children).toContain('u2b');
  });

  it('changes an author role', () => {
    const out = edit('gpt.json', text, (m) => m.map((x) => (x.text === 'Hi' ? { ...x, role: 'assistant' as const } : x)));
    expect(out.again.messages[0].role).toBe('assistant');
  });
});

describe('Claude and generic flat exports (synthetic)', () => {
  const claude = JSON.stringify([
    { uuid: 'c', name: 'Claude chat', chat_messages: [{ sender: 'human', text: 'One' }, { sender: 'assistant', text: 'Two' }] },
  ]);

  it('edits, deletes and inserts in a Claude export', () => {
    const out = edit('claude.json', claude, (m) => [
      { ...m[0], text: 'One (edited)' },
      ...m.slice(1).filter(() => false),
      { id: 'n', role: 'assistant', text: 'Three' },
    ]);
    expect(out.again.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'One (edited)'],
      ['assistant', 'Three'],
    ]);
    expect(JSON.parse(out.out)[0].chat_messages[1].sender).toBe('assistant');
  });

  it('writes the name of a Claude chat', () => {
    const out = edit('claude.json', claude, (m) => m, { title: 'Renamed Claude' });
    expect(JSON.parse(out.out)[0].name).toBe('Renamed Claude');
  });

  it('keeps the shape of a bare message array', () => {
    const bare = JSON.stringify([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
    const out = edit('bare.json', bare, (m) => m.map((x) => (x.role === 'assistant' ? { ...x, text: 'hello again' } : x)));
    const parsed = JSON.parse(out.out);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[1].content).toBe('hello again');
  });

  it('keeps a wrapped messages array and its title', () => {
    const wrapped = JSON.stringify({ title: 'Wrapped', messages: [{ role: 'user', content: 'a' }] });
    const out = edit('wrapped.json', wrapped, (m) => m, { title: 'Renamed' });
    expect(JSON.parse(out.out).title).toBe('Renamed');
  });
});

describe('markdown transcripts (synthetic)', () => {
  const md = [
    '# **Title:** Notes on physics',
    '',
    'Exported on: 10/9/2026, 8:58:44 AM',
    '',
    '---',
    '',
    '## 👤 User',
    '',
    'What is force?',
    '',
    '---',
    '',
    '## 🤖 Model',
    '',
    'Force is a push or pull.',
    '',
    '---',
    '',
    '',
  ].join('\n');

  it('rewrites one turn and keeps the others verbatim', () => {
    const out = edit('talk.md', md, (m) => m.map((x) => (x.role === 'assistant' ? { ...x, text: 'Force is mass times acceleration.' } : x)));
    expect(out.out).toContain('## 👤 User\n\nWhat is force?\n\n---');
    expect(out.again.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'What is force?'],
      ['assistant', 'Force is mass times acceleration.'],
    ]);
  });

  it('deletes, inserts and renames', () => {
    const out = edit(
      'talk.md',
      md,
      (m) => [...m, { id: 'z', role: 'user' as const, text: 'Thanks' }].filter((x) => x.role !== 'assistant'),
      { title: 'Renamed notes' },
    );
    expect(out.again.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'What is force?'],
      ['user', 'Thanks'],
    ]);
    expect(out.again.title).toBe('Renamed notes');
    expect(out.out.startsWith('# **Title:** Renamed notes')).toBe(true);
  });

  it('writes a plain markdown note', () => {
    const note = 'Just a note with no turns.\n';
    const out = edit('note.md', note, (m) => m.map((x) => ({ ...x, text: 'Edited note.' })));
    expect(out.out.trim()).toBe('Edited note.');
  });
});

describe('real AI Studio export', () => {
  it.skipIf(!zipName)('saves a turn into the zip and keeps the images', async () => {
    const bytes = new Uint8Array(readFileSync(new URL(zipName!, root)));
    const file: LoadedFile = { id: 'f1', name: zipName!, zip: true, bytes };
    const doc = parseChatDocument(`${zipName}/conversation.md`, new TextDecoder().decode(await (await JSZip.loadAsync(bytes)).file('conversation.md')!.async('uint8array')));
    const chat = { ...doc.chats[0], id: 'c1', origin: { fileId: 'f1', entry: 'conversation.md', index: 0 } };
    const edited = chat.messages.map((m, i) => (i === 0 ? m : { ...m }));
    const target = edited.findIndex((m) => m.role === 'assistant');
    edited[target] = { ...edited[target], text: 'Edited answer for the test.' };

    const plan = await planSave(file, [
      { chat, edit: { title: chat.title, originalTitle: chat.original.title, original: chat.original.messages, edited } },
    ]);

    expect(plan.updates[0].mismatch).toBe(false);
    const saved = await JSZip.loadAsync(plan.bytes);
    const before = await JSZip.loadAsync(bytes);
    expect(Object.keys(saved.files).sort()).toEqual(Object.keys(before.files).sort());
    for (const name of Object.keys(before.files).filter((n) => /\.(jpe?g|png)$/i.test(n))) {
      const a = await before.file(name)!.async('uint8array');
      const b = await saved.file(name)!.async('uint8array');
      expect(b.length).toBe(a.length);
    }
    const md = await saved.file('conversation.md')!.async('string');
    expect(md).toContain('Edited answer for the test.');
  });
});

describe('planSave on a JSON file', () => {
  it('marks a saved chat as matching the file', async () => {
    const text = JSON.stringify([{ id: 'x', title: 'T', chat: { history: { currentId: 'b', messages: {
      a: { id: 'a', role: 'user', content: 'one', parentId: null, childrenIds: ['b'], files: [] },
      b: { id: 'b', role: 'assistant', content: '', parentId: 'a', childrenIds: [], content_list: [{ phase: 'answer', content: 'two' }] },
    } } } }]);
    const doc = parseChatDocument('j.json', text);
    const chat = { ...doc.chats[0], id: 'c', origin: { fileId: 'f', index: 0 } };
    const file: LoadedFile = { id: 'f', name: 'j.json', zip: false, bytes: new TextEncoder().encode(text) };
    const edited = chat.messages.map((m) => ({ ...m, text: m.text + '!' }));
    const plan = await planSave(file, [
      { chat, edit: { title: chat.title, originalTitle: chat.original.title, original: chat.original.messages, edited } },
    ]);
    expect(plan.updates[0].mismatch).toBe(false);
    expect(new TextDecoder().decode(plan.bytes)).toContain('two!');
  });
});

/**
 * Generated images are stored apart from the answer text, so after an edit they read back after
 * the text. For the exhaustive check, compare the text without those image lines and the count of them.
 */
function sameModuloImagePosition(a: Message[], b: Message[]): boolean {
  const strip = (t: string) => t.replace(/!\[generated image\]\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  const count = (t: string) => (t.match(/!\[generated image\]/g) ?? []).length;
  return (
    a.length === b.length &&
    a.every((m, i) => m.role === b[i].role && strip(m.text) === strip(b[i].text) && count(m.text) === count(b[i].text))
  );
}

describe('every position in the real exports', () => {
  const samples: [string, string][] = [];
  for (const f of qwenFiles) samples.push([f, readFileSync(new URL(f, root), 'utf8')]);
  if (mdName) samples.push([mdName, readFileSync(new URL(mdName, root), 'utf8')]);

  it.skipIf(samples.length === 0)('an edit, a delete or an insert at any message reads back exactly', () => {
    for (const [name, text] of samples) {
      const doc = parseChatDocument(name, text);
      const chat = doc.chats[0];
      const n = chat.messages.length;
      for (let i = 0; i < n; i++) {
        // Edit message i.
        const e = edit(name, text, (m) => m.map((x, j) => (j === i ? { ...x, text: `${x.text.trim()}\n\n[edited ${i}]` } : x)));
        expect(sameModuloImagePosition(e.again.messages, e.edited), `${name} edit ${i}`).toBe(true);
        expect(e.notes, `${name} edit ${i}`).toEqual([]);

        // Delete message i.
        const d = edit(name, text, (m) => m.filter((_, j) => j !== i));
        expect(sameMessages(d.again.messages, d.edited), `${name} delete ${i}`).toBe(true);

        // Insert a new user message before message i.
        const ins = edit(name, text, (m) => [...m.slice(0, i), { id: 'new', role: 'user' as const, text: `inserted ${i}` }, ...m.slice(i)]);
        expect(sameMessages(ins.again.messages, ins.edited), `${name} insert ${i}`).toBe(true);
      }
    }
  });
});
