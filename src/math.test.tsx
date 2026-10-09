import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { normalizeMath } from './math';
import { Markdown } from './components/MessageCard';

describe('normalizeMath', () => {
  it('turns \\( … \\) into inline $ … $', () => {
    expect(normalizeMath('where \\(v_i\\) is the speed')).toBe('where $v_i$ is the speed');
  });

  it('turns \\[ … \\] into a $$ block on its own lines', () => {
    const out = normalizeMath('Thus:\n\n\\[\nv_{ix} = v_i \\cos \\theta\n\\]\n\nNext');
    expect(out).toContain('$$\nv_{ix} = v_i \\cos \\theta\n$$');
    expect(out).not.toContain('\\[');
  });

  it('leaves code spans and fenced code untouched', () => {
    const src = 'use `\\(x\\)` here\n\n```\n\\[ keep \\]\n```\n\nbut \\(y\\) is math';
    const out = normalizeMath(src);
    expect(out).toContain('`\\(x\\)`');
    expect(out).toContain('\\[ keep \\]');
    expect(out).toContain('but $y$ is math');
  });

  it('leaves text without LaTeX delimiters unchanged', () => {
    const s = 'Plain text with [a link](https://x.y) and $5';
    expect(normalizeMath(s)).toBe(s);
  });
});

describe('Markdown rendering of \\( \\) and \\[ \\]', () => {
  const answer = [
    'Horizontal component',
    '',
    '\\[',
    'v_{ix} = v_i \\cos \\theta',
    '\\]',
    '',
    'Where:',
    '',
    '- \\(v_{ix}\\) is the initial horizontal velocity.',
    '',
    'SI unit of velocity:',
    '',
    '\\[',
    '\\boxed{\\text{m s}^{-1}}',
    '\\]',
  ].join('\n');

  it('typesets the formulas with KaTeX and does not show raw brackets', () => {
    const html = renderToStaticMarkup(<Markdown>{answer}</Markdown>);
    expect(html).toContain('katex');
    expect(html).toContain('katex-display');
    expect(html).not.toContain('\\(');
    expect(html).not.toContain('\\[');
    // Outside KaTeX's hidden accessibility annotation, the formula is not shown as raw TeX.
    const visible = html.replace(/<annotation[\s\S]*?<\/annotation>/g, '');
    expect(visible).not.toContain('v_{ix}');
  });
});

import { existsSync, readFileSync } from 'node:fs';
import { parseChatFile } from './parse';

const realExport = new URL('../chat-export-1791517087603.json', import.meta.url);
describe.skipIf(!existsSync(realExport))('real export math', () => {
  it('leaves no unconverted LaTeX delimiters outside code', () => {
    const [chat] = parseChatFile('chat-export-1791517087603.json', readFileSync(realExport, 'utf8'));
    let converted = 0;
    for (const m of chat.messages) {
      const out = normalizeMath(m.text);
      converted += (m.text.match(/\\[[(]/g) ?? []).length - (out.match(/\\[[(]/g) ?? []).length;
      // Any remaining delimiter must sit inside a code span or fence.
      const stripped = out.replace(/```[\s\S]*?```|`[^`\n]*`/g, '');
      expect(stripped).not.toMatch(/\\[[(]/);
    }
    expect(converted).toBeGreaterThan(0);
  });
});
