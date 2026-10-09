/**
 * Convert LaTeX written with \( … \) (inline) and \[ … \] (display) into the $…$ and $$…$$
 * forms that remark-math understands.
 *
 * Without this, markdown treats the backslash as an escape, so \[ shows as "[" and \( as "("
 * and the formula is never typeset. Code spans and fenced code blocks are left untouched.
 */
export function normalizeMath(source: string): string {
  // Odd indexes are code (fenced blocks or inline code); even indexes are prose.
  const parts = source.split(/(```[\s\S]*?```|`[^`\n]*`)/);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part
        .replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner: string) => `\n\n$$\n${inner.trim()}\n$$\n\n`)
        .replace(/\\\(([\s\S]*?)\\\)/g, (_m, inner: string) => `$${inner.trim()}$`);
    })
    .join('');
}
