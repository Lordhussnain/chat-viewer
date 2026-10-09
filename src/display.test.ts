import { describe, expect, it } from 'vitest';
import { DEFAULT_DISPLAY, sanitizeDisplay } from './display';

describe('sanitizeDisplay', () => {
  it('keeps valid stored settings', () => {
    expect(sanitizeDisplay({ textScale: 2, zoom: 1.5, width: 100, pages: 2 })).toEqual({
      textScale: 2,
      zoom: 1.5,
      width: 100,
      pages: 2,
    });
  });

  it('falls back to defaults for unknown or malformed values', () => {
    expect(sanitizeDisplay({ textScale: 3, zoom: 'big', width: 250, pages: 7 })).toEqual(DEFAULT_DISPLAY);
    expect(sanitizeDisplay(null)).toEqual(DEFAULT_DISPLAY);
    expect(sanitizeDisplay('nonsense')).toEqual(DEFAULT_DISPLAY);
  });

  it('accepts numeric strings, as produced by select and range elements', () => {
    expect(sanitizeDisplay({ textScale: '1.25', zoom: '2', width: '60', pages: '2' })).toEqual({
      textScale: 1.25,
      zoom: 2,
      width: 60,
      pages: 2,
    });
  });

  it('keeps slider positions within range', () => {
    expect(sanitizeDisplay({ width: -10 }).width).toBe(DEFAULT_DISPLAY.width);
    expect(sanitizeDisplay({ width: 37.6 }).width).toBe(38);
  });
});
