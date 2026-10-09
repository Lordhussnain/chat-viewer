// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatView } from './components/ChatView';
import { Sidebar } from './components/Sidebar';
import { SplitPanes } from './components/SplitPanes';
import type { Chat } from './types';

// jsdom does not lay out content, so scrollTop never changes on its own. Store it manually.
beforeAll(() => {
  const values = new WeakMap<Element, number>();
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get() {
      return values.get(this) ?? 0;
    },
    set(v: number) {
      values.set(this, v);
    },
  });
});

const chat: Chat = {
  id: 'chat-1',
  fileName: 'a.json',
  source: 'generic',
  title: 'Long chat',
  messages: Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, role: 'user' as const, text: `Message ${i}` })),
  original: { title: 'Long chat', messages: [] },
  dirty: false,
};
chat.original = { title: chat.title, messages: chat.messages };

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(element: React.ReactElement): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(element));
  return host;
}

function unmount() {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
}

afterEach(() => unmount());

const noop = () => {};

describe('chat view keeps its reading position', () => {
  it('restores the scroll offset after the tab is switched away and back', () => {
    const memory = new Map<string, number>();
    const view = (
      <ChatView
        chat={chat}
        onEdit={noop}
        onRevert={noop}
        onRemove={noop}
        onSave={noop}
        save={{ canSave: false, hint: '', target: '' }}
        scrollMemory={memory}
      />
    );

    mount(view);
    const scroller = host!.querySelector('.chat-view') as HTMLElement;
    scroller.scrollTop = 640;
    act(() => {
      scroller.dispatchEvent(new Event('scroll'));
    });
    expect(memory.get('chat-1')).toBe(640);

    // Switching to another tab unmounts this chat...
    unmount();
    // ...and coming back mounts it again with the same memory.
    mount(view);
    const again = host!.querySelector('.chat-view') as HTMLElement;
    expect(again.scrollTop).toBe(640);
  });

  it('starts at the top when the chat has never been scrolled', () => {
    mount(
      <ChatView
        chat={chat}
        onEdit={noop}
        onRevert={noop}
        onRemove={noop}
        onSave={noop}
        save={{ canSave: false, hint: '', target: '' }}
        scrollMemory={new Map()}
      />,
    );
    expect((host!.querySelector('.chat-view') as HTMLElement).scrollTop).toBe(0);
  });
});

describe('sidebar collapse', () => {
  const sidebarProps = {
    chats: [],
    openIds: new Set<string>(),
    activeId: null,
    query: '',
    onQuery: noop,
    onOpen: noop,
    onPickFiles: noop,
    imageCount: 0,
    errors: [],
    onDismissErrors: noop,
    theme: 'light' as const,
    onToggleTheme: noop,
    display: { textScale: 1, zoom: 1, width: 0, pages: 1 as const },
    onDisplayChange: noop,
  };

  it('shows the full sidebar when expanded and a narrow strip when collapsed', () => {
    const onToggle = vi.fn();
    mount(<Sidebar {...sidebarProps} collapsed={false} onToggleCollapsed={onToggle} />);
    expect(host!.querySelector('.sidebar.collapsed')).toBeNull();
    expect(host!.textContent).toContain('Chat Viewer');

    const hide = host!.querySelector('button[aria-label="Hide sidebar"]') as HTMLButtonElement;
    act(() => hide.click());
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('collapsed strip shows only the expand button, and clicking it calls the toggle', () => {
    const onToggle = vi.fn();
    mount(<Sidebar {...sidebarProps} collapsed={true} onToggleCollapsed={onToggle} />);
    expect(host!.querySelector('.sidebar.collapsed')).not.toBeNull();
    expect(host!.textContent).not.toContain('Chat Viewer');

    const show = host!.querySelector('button[aria-label="Show sidebar"]') as HTMLButtonElement;
    act(() => show.click());
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe('width and page layout settings', () => {
  const makeProps = (onDisplayChange: (patch: Record<string, unknown>) => void) => ({
    chats: [],
    openIds: new Set<string>(),
    activeId: null,
    query: '',
    onQuery: noop,
    onOpen: noop,
    onPickFiles: noop,
    imageCount: 0,
    errors: [],
    onDismissErrors: noop,
    theme: 'light' as const,
    onToggleTheme: noop,
    display: { textScale: 1, zoom: 1, width: 0, pages: 1 as const },
    onDisplayChange,
    collapsed: false,
    onToggleCollapsed: noop,
  });

  it('sliding the width range reports the new content width', () => {
    const onChange = vi.fn();
    mount(<Sidebar {...makeProps(onChange)} />);
    const range = host!.querySelector('input[type="range"]') as HTMLInputElement;
    expect(range).not.toBeNull();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(range, '70');
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith({ width: 70 });
  });

  it('switching to two pages also fills the width, and back restores it', () => {
    const onChange = vi.fn();
    mount(<Sidebar {...makeProps(onChange)} />);
    const pages = host!.querySelector('select[aria-label="Pages"]') as HTMLSelectElement;
    act(() => {
      pages.value = '2';
      pages.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith({ pages: 2, width: 100 });
    act(() => {
      pages.value = '1';
      pages.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith({ pages: 1, width: 0 });
  });
});

describe('split panes', () => {
  it('shows both panes and sends clicks to the focused pane', () => {
    const onFocus = vi.fn();
    mount(
      <SplitPanes focus="left" onFocus={onFocus} left={<div>Left content</div>} right={<div>Right content</div>} />,
    );
    const panes = host!.querySelectorAll('.pane');
    expect(panes).toHaveLength(2);
    expect(host!.textContent).toContain('Left content');
    expect(host!.textContent).toContain('Right content');
    expect(panes[0].classList.contains('focused')).toBe(true);

    act(() => panes[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(onFocus).toHaveBeenLastCalledWith('right');
    act(() => panes[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(onFocus).toHaveBeenLastCalledWith('left');
  });
});
