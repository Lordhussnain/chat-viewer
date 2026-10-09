import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AssetsProvider } from './assets';
import { MessageCard } from './components/MessageCard';
import type { Message } from './types';

const noop = () => {};
function render(message: Message, assets: Record<string, string> = {}) {
  return renderToStaticMarkup(
    <AssetsProvider value={assets}>
      <MessageCard
        message={message}
        index={0}
        total={1}
        editing={false}
        onStartEdit={noop}
        onCancelEdit={noop}
        onSave={noop}
        onDelete={noop}
        onMove={noop}
        onInsertAfter={noop}
      />
    </AssetsProvider>,
  );
}

describe('MessageCard rendering', () => {
  it('shows an attached image using the loaded object URL', () => {
    const html = render(
      { id: '1', role: 'user', text: '![image-1.jpg](image-1.jpg)' },
      { 'image-1.jpg': 'blob:http://x/abc' },
    );
    expect(html).toContain('<img src="blob:http://x/abc"');
    expect(html).toContain('class="md-img"');
  });

  it('shows a placeholder when the image file has not been loaded', () => {
    const html = render({ id: '1', role: 'user', text: '![image-9.jpg](image-9.jpg)' });
    expect(html).toContain('image not loaded: image-9.jpg');
  });

  it('renders LaTeX with KaTeX', () => {
    const html = render({ id: '1', role: 'assistant', text: 'Energy is $E = mc^2$.' });
    expect(html).toContain('katex');
  });

  it('wraps model reasoning in a collapsible block', () => {
    const html = render({ id: '1', role: 'reasoning', text: '**Thinking** hard' });
    expect(html).toContain('<details');
    expect(html).toContain('Model reasoning');
    expect(html).toContain('<strong>Thinking</strong>');
  });
});
