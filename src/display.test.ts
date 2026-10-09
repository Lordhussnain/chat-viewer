import { describe, expect, it } from 'vitest';
import { DEFAULT_DISPLAY, sanitizeDisplay } from './display';

describe('sanitizeDisplay', () => {
  it('keeps valid stored settings', () => {
    expect(sanitizeDisplay({ textScale: 2, zoom: 1.5 })).toEqual({ textScale: 2, zoom: 1.5 });
  });

  it('falls back to defaults for unknown or malformed values', () => {
    expect(sanitizeDisplay({ textScale: 3, zoom: 'big' })).toEqual(DEFAULT_DISPLAY);
    expect(sanitizeDisplay(null)).toEqual(DEFAULT_DISPLAY);
    expect(sanitizeDisplay('nonsense')).toEqual(DEFAULT_DISPLAY);
  });

  it('accepts numeric strings, as produced by select elements', () => {
    expect(sanitizeDisplay({ textScale: '1.25', zoom: '2' })).toEqual({ textScale: 1.25, zoom: 2 });
  });
});
