import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { parseChatFile } from './parse';

// Two branches off the same user turn: u1 -> a1 (old) and u1 -> u2 -> a2 (current).
const fixture = [
  {
    id: 'c1',
    title: 'Branch test',
    created_at: 1700000000,
    updated_at: 1700000500,
    chat: {
      history: {
        currentId: 'a3',
        messages: {
          u1: {
            id: 'u1', role: 'user', content: 'Explain projectile motion', parentId: null,
            childrenIds: ['a1', 'a2'], timestamp: 1700000001,
            files: [{ name: 'notes.pdf', file_class: 'document', file_type: 'application/pdf' }],
          },
          a1: { id: 'a1', role: 'assistant', content: '', parentId: 'u1', childrenIds: [], content_list: [{ phase: 'answer', content: 'OLD BRANCH' }] },
          a2: {
            id: 'a2', role: 'assistant', content: '', parentId: 'u1', childrenIds: ['u2'], timestamp: 1700000002,
            content_list: [
              { phase: 'thinking_summary', content: '', extra: { summary_title: { content: ['Planning'] }, summary_thought: { content: ['Think about angles.'] } } },
              { phase: 'answer', content: 'It is a **parabola**.' },
            ],
          },
          u2: {
            id: 'u2', role: 'user', content: 'Draw it', parentId: 'a2', childrenIds: ['a3'], timestamp: 1700000003,
            files: [{ name: 'diagram.png', file_class: 'vision', file_type: 'image/png', url: 'https://example.com/d.png' }],
          },
          a3: {
            id: 'a3', role: 'assistant', content: '', parentId: 'u2', childrenIds: [], timestamp: 1700000004,
            content_list: [{ phase: 'image_gen', content: 'https://example.com/out.png' }, { phase: 'answer', content: 'Here it is.' }],
          },
        },
      },
    },
  },
];

describe('Qwen / Open WebUI-style export', () => {
  it('follows the active branch and maps reasoning, answers, attachments and generated images', () => {
    const [chat] = parseChatFile('export.json', JSON.stringify(fixture));
    expect(chat.source).toBe('openwebui');
    expect(chat.title).toBe('Branch test');
    expect(chat.messages.map((m) => m.role)).toEqual(['user', 'reasoning', 'assistant', 'user', 'assistant']);
    expect(chat.messages.some((m) => m.text.includes('OLD BRANCH'))).toBe(false);
    expect(chat.messages[0].text).toBe('📎 notes.pdf\n\nExplain projectile motion');
    expect(chat.messages[1].text).toContain('**Planning**');
    expect(chat.messages[1].text).toContain('Think about angles.');
    expect(chat.messages[2].text).toBe('It is a **parabola**.');
    expect(chat.messages[3].text).toBe('![diagram.png](https://example.com/d.png)\n\nDraw it');
    expect(chat.messages[4].text).toBe('Here it is.\n\n![generated image](https://example.com/out.png)');
    expect(chat.messages[0].createdAt).toBe(new Date(1700000001000).toISOString());
  });

  it('falls back to the flat messages list when there is no history tree', () => {
    const flat = [{ id: 'c2', title: 'Flat', chat: { messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }] } }];
    const [chat] = parseChatFile('flat.json', JSON.stringify(flat));
    expect(chat.messages.map((m) => m.text)).toEqual(['hi', 'hello']);
  });
});

// Runs against the real exports when they are present in the repo root.
const root = new URL('../', import.meta.url);
const realFiles = existsSync(root)
  ? readdirSync(root).filter((n) => /^chat-export-.*\.json$/.test(n))
  : [];

describe.skipIf(realFiles.length === 0)('real chat-export files in the repo', () => {
  it('each file parses into chats with messages and no empty turns', () => {
    for (const f of realFiles) {
      const chats = parseChatFile(f, readFileSync(new URL(f, root), 'utf8'));
      expect(chats.length).toBeGreaterThan(0);
      for (const c of chats) {
        expect(c.title.length).toBeGreaterThan(0);
        expect(c.messages.length).toBeGreaterThan(0);
        expect(c.messages.every((m) => m.text.trim().length > 0)).toBe(true);
      }
    }
  });
});
