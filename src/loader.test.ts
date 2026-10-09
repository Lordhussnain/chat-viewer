import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { loadFiles } from './loader';
import { parseMarkdownChat } from './parse';

const md = `# **Title:** Physics notes

**Token Size:** 10 tokens

Exported on: 10/9/2026, 8:58:44 AM

---

## 👤 User

**Image Attachment:**

 File Name: image-1.jpg

 Image: ![image-1.jpg](image-1.jpg)

## 👤 User

make notes for these

## 🤖 Model (Reasoning)

**Thinking** about the page.

## 🤖 Model

# CHAPTER 1

## TOPIC 1: Intro

Energy is $E = mc^2$.

---
`;

describe('markdown transcripts', () => {
  it('splits turns by heading, classifies reasoning, and keeps image links', () => {
    const [chat] = parseMarkdownChat('notes.md', md);
    expect(chat.source).toBe('aistudio');
    expect(chat.title).toBe('Physics notes');
    expect(chat.updatedAt).toBeDefined();
    expect(chat.messages.map((m) => m.role)).toEqual(['user', 'user', 'reasoning', 'assistant']);
    expect(chat.messages[0].text).toBe('![image-1.jpg](image-1.jpg)');
    expect(chat.messages[1].text).toBe('make notes for these');
    // Ordinary "## Topic" headings inside a model answer stay in its text.
    expect(chat.messages[3].text).toContain('## TOPIC 1: Intro');
    expect(chat.messages[3].text).not.toMatch(/-{3,}$/);
  });

  it('treats a markdown file with no turn headings as a single note', () => {
    const [chat] = parseMarkdownChat('plain.md', '# Shopping\n\n- eggs\n- milk\n');
    expect(chat.source).toBe('markdown');
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0].role).toBe('other');
  });
});

describe('loadFiles', () => {
  it('reads a zip export: transcript plus images, and ignores other files', async () => {
    const zip = new JSZip();
    zip.file('conversation.md', md);
    zip.file('image-1.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    zip.file('notes/readme.txt', 'ignored');
    const buf = await zip.generateAsync({ type: 'uint8array' });
    const file = new File([buf as unknown as BlobPart], 'export.zip', { type: 'application/zip' });

    const result = await loadFiles([file]);
    expect(result.errors).toEqual([]);
    expect(result.chats).toHaveLength(1);
    expect(result.chats[0].fileName).toBe('export.zip/conversation.md');
    expect(Object.keys(result.images)).toEqual(['image-1.jpg']);
  });

  it('collects standalone image files and reports bad files without stopping', async () => {
    const img = new File([new Uint8Array([1, 2, 3])], 'image-2.png', { type: 'image/png' });
    const bad = new File(['{nope'], 'bad.json', { type: 'application/json' });
    const result = await loadFiles([img, bad]);
    expect(Object.keys(result.images)).toEqual(['image-2.png']);
    expect(result.chats).toEqual([]);
    expect(result.errors[0]).toMatch(/bad.json: not valid JSON/);
  });
});
