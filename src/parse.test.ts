import { describe, expect, it } from 'vitest';
import { parseChatFile, extractText, normalizeRole } from './parse';
import { chatToJson, chatToMarkdown } from './export';

const chatgptExport = JSON.stringify([
  {
    title: 'Hello GPT',
    create_time: 1700000000,
    update_time: 1700000100,
    current_node: 'n3',
    mapping: {
      root: { id: 'root', message: null, parent: null, children: ['n1'] },
      n1: {
        id: 'n1',
        parent: 'root',
        children: ['n2'],
        message: {
          id: 'm1',
          author: { role: 'user' },
          create_time: 1700000001,
          content: { content_type: 'text', parts: ['Hi there'] },
          metadata: {},
        },
      },
      n2: {
        id: 'n2',
        parent: 'n1',
        children: ['n3'],
        message: {
          id: 'm2',
          author: { role: 'assistant' },
          create_time: 1700000002,
          content: { content_type: 'thoughts', thoughts: [{ content: 'secret' }] },
          metadata: {},
        },
      },
      n3: {
        id: 'n3',
        parent: 'n2',
        children: [],
        message: {
          id: 'm3',
          author: { role: 'assistant' },
          create_time: 1700000003,
          content: { content_type: 'text', parts: ['Hello!', { content_type: 'image_asset_pointer' }] },
          metadata: {},
        },
      },
    },
  },
]);

const claudeExport = JSON.stringify([
  {
    uuid: 'abc',
    name: 'Claude chat',
    created_at: '2024-01-02T03:04:05Z',
    updated_at: '2024-01-02T04:00:00Z',
    chat_messages: [
      { uuid: '1', sender: 'human', text: 'What is 2+2?', content: [{ type: 'text', text: 'What is 2+2?' }] },
      {
        uuid: '2',
        sender: 'assistant',
        text: '',
        content: [
          { type: 'thinking', thinking: 'hmm' },
          { type: 'text', text: '4' },
        ],
      },
    ],
  },
]);

describe('parseChatFile', () => {
  it('reads a ChatGPT conversations.json, following the current branch and skipping thoughts', () => {
    const [chat] = parseChatFile('conversations.json', chatgptExport);
    expect(chat.source).toBe('chatgpt');
    expect(chat.title).toBe('Hello GPT');
    expect(chat.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'Hi there'],
      ['assistant', 'Hello!\n\n[image]'],
    ]);
    expect(chat.messages[0].createdAt).toBe(new Date(1700000001000).toISOString());
    expect(chat.dirty).toBe(false);
  });

  it('reads a Claude export and prefers the text field, falling back to content blocks', () => {
    const [chat] = parseChatFile('claude.json', claudeExport);
    expect(chat.source).toBe('claude');
    expect(chat.title).toBe('Claude chat');
    expect(chat.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'What is 2+2?'],
      ['assistant', '4'],
    ]);
  });

  it('reads a generic {title, messages} file and a bare message array', () => {
    const [a] = parseChatFile(
      'g.json',
      JSON.stringify({ title: 'Gen', messages: [{ role: 'human', content: 'yo' }, { role: 'ai', content: [{ type: 'text', text: 'sup' }] }] }),
    );
    expect(a.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(a.messages[1].text).toBe('sup');

    const [b] = parseChatFile('arr.json', JSON.stringify([{ role: 'user', text: 'one' }, { role: 'assistant', text: 'two' }]));
    expect(b.title).toBe('one');
    expect(b.messages).toHaveLength(2);
  });

  it('reads multiple conversations wrapped in {conversations: [...]}', () => {
    const chats = parseChatFile(
      'wrap.json',
      JSON.stringify({ conversations: [{ title: 'A', messages: [{ role: 'user', text: 'a' }] }, { title: 'B', messages: [] }] }),
    );
    expect(chats.map((c) => c.title)).toEqual(['A', 'B']);
  });

  it('reads JSON Lines', () => {
    const jsonl = [JSON.stringify({ role: 'user', text: 'x' }), JSON.stringify({ role: 'assistant', text: 'y' })].join('\n');
    const [c] = parseChatFile('x.jsonl', jsonl);
    expect(c.messages).toHaveLength(2);
  });

  it('throws readable errors for bad input', () => {
    expect(() => parseChatFile('bad.json', '{not json')).toThrow(/bad.json: not valid JSON/);
    expect(() => parseChatFile('empty.json', '{"foo": 1}')).toThrow(/no chats recognised/);
  });
});

describe('helpers', () => {
  it('normalizes roles', () => {
    expect(normalizeRole('Human')).toBe('user');
    expect(normalizeRole('model')).toBe('assistant');
    expect(normalizeRole('function')).toBe('tool');
    expect(normalizeRole(undefined)).toBe('other');
  });

  it('extracts text from mixed shapes', () => {
    expect(extractText([{ type: 'text', text: 'a' }, 'b'])).toBe('a\n\nb');
    expect(extractText({ parts: ['p'] })).toBe('p');
  });
});

describe('export round-trip', () => {
  it('exported JSON can be re-imported with the generic adapter', () => {
    const [chat] = parseChatFile('claude.json', claudeExport);
    const [again] = parseChatFile('re.json', chatToJson(chat));
    expect(again.title).toBe(chat.title);
    expect(again.messages.map((m) => [m.role, m.text])).toEqual(chat.messages.map((m) => [m.role, m.text]));
  });

  it('markdown export contains the title and every message', () => {
    const [chat] = parseChatFile('claude.json', claudeExport);
    const md = chatToMarkdown(chat);
    expect(md.startsWith('# Claude chat')).toBe(true);
    expect(md).toContain('## User');
    expect(md).toContain('What is 2+2?');
    expect(md).toContain('## Assistant');
  });
});

describe('bundled example', () => {
  it('parses examples/sample-generic.json into two chats', async () => {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(new URL('../examples/sample-generic.json', import.meta.url), 'utf8');
    const chats = parseChatFile('sample-generic.json', text);
    expect(chats.map((c) => c.title)).toEqual(['Sample: planning a trip', 'Sample: code question']);
    expect(chats[1].messages[0].text).toBe('How do I reverse a list in Python?');
  });
});
