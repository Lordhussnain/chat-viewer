// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AssetsProvider, IMAGE_TIMEOUT_MS, MarkdownImage } from './assets';
import { imageUrl } from './imageUrl';
import { parseChatFile } from './parse';

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

function mount(src: string, opts: { assets?: Record<string, string>; alt?: string } = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <AssetsProvider value={opts.assets ?? {}}>
        <MarkdownImage src={src} alt={opts.alt ?? 'generated image'} />
      </AssetsProvider>,
    );
  });
  return host;
}

describe('imageUrl', () => {
  it('returns a plain link unchanged', () => {
    expect(imageUrl('https://cdn.example/a.png?key=abc')).toBe('https://cdn.example/a.png?key=abc');
  });

  it('takes the link out of a markdown wrapper', () => {
    const wrapped = '[https://cdn.example/a.png?key=abc](https://cdn.example/a.png?key=abc)';
    expect(imageUrl(wrapped)).toBe('https://cdn.example/a.png?key=abc');
  });

  it('returns other text trimmed', () => {
    expect(imageUrl('  data-only  ')).toBe('data-only');
  });
});

describe('Qwen image links', () => {
  it('builds a working image link from a wrapped address', () => {
    const url = 'https://cdn.qwenlm.ai/output/x/t2i/y/z.png?key=abc';
    const file = {
      id: 'c1',
      title: 'Images',
      created_at: 1_700_000_000,
      chat: {
        history: {
          currentId: 'a1',
          messages: {
            u1: { id: 'u1', role: 'user', content: 'Draw it', parentId: null, childrenIds: ['a1'], timestamp: 1_700_000_001, files: [] },
            a1: {
              id: 'a1',
              role: 'assistant',
              content: '',
              parentId: 'u1',
              childrenIds: [],
              timestamp: 1_700_000_002,
              content_list: [{ phase: 'image_gen', content: `[${url}](${url})` }],
            },
          },
        },
      },
    };
    const [chat] = parseChatFile('qwen.json', JSON.stringify([file]));
    const answer = chat.messages.find((m) => m.role === 'assistant')!;
    expect(answer.text).toBe(`![generated image](${url})`);
  });
});

describe('ChatGPT Exporter image links', () => {
  it('shows a loaded image file matched by the fn parameter of the web link', () => {
    const el = mount('https://chatgpt.com/backend-api/estuary/content?id=1&fn=photo.png&sig=x', {
      assets: { 'photo.png': 'blob:photo' },
      alt: 'photo.png',
    });
    const img = el.querySelector('img');
    expect(img?.getAttribute('src')).toBe('blob:photo');
    expect(el.textContent).not.toContain('Loading image');
    expect(el.textContent).not.toContain('image not loaded');
  });

  it('matches a loaded file by the alt name when the link has no fn parameter', () => {
    const el = mount('https://chatgpt.com/backend-api/estuary/content?id=2', {
      assets: { 'photo.png': 'blob:photo' },
      alt: 'photo.png',
    });
    expect(el.querySelector('img')?.getAttribute('src')).toBe('blob:photo');
  });

  it('loads the web image when no file with that name has been loaded', () => {
    const el = mount('https://chatgpt.com/backend-api/estuary/content?id=3&fn=photo.png', { alt: 'photo.png' });
    expect(el.textContent).toContain('Loading image');
  });
});

describe('web images', () => {
  it('shows the image as loading first, not as an error', () => {
    const el = mount('https://cdn.example/a.png');
    expect(el.textContent).toContain('Loading image');
    expect(el.textContent).not.toContain('Image not available');
  });

  it('shows "Image not available" when the image has not arrived after 30 seconds', () => {
    vi.useFakeTimers();
    const el = mount('https://cdn.example/a.png');
    act(() => {
      vi.advanceTimersByTime(IMAGE_TIMEOUT_MS - 1);
    });
    expect(el.textContent).not.toContain('Image not available');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(el.textContent).toContain('Image not available');
    expect(el.querySelector('img')).toBeNull();
  });

  it('shows "Image not available" as soon as the download fails', () => {
    const el = mount('https://cdn.example/a.png');
    const img = el.querySelector('img')!;
    act(() => {
      img.dispatchEvent(new Event('error'));
    });
    expect(el.textContent).toContain('Image not available');
  });

  it('shows the image once it has loaded', () => {
    vi.useFakeTimers();
    const el = mount('https://cdn.example/a.png');
    const img = el.querySelector('img')!;
    act(() => {
      img.dispatchEvent(new Event('load'));
    });
    act(() => {
      vi.advanceTimersByTime(IMAGE_TIMEOUT_MS + 1000);
    });
    expect(el.textContent).not.toContain('Image not available');
    expect(el.querySelector('img')!.hasAttribute('hidden')).toBe(false);
  });
});
