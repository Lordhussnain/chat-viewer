/**
 * Display settings for readability: text size and whole-interface zoom.
 *
 * Text size scales the root font size as a percentage of the browser's own default,
 * so a larger default set in the browser is still respected. Zoom sets the --ui-zoom
 * CSS variable, which the .app container uses to scale the whole interface.
 */

export const TEXT_SCALES = [1, 1.25, 1.5, 1.75, 2, 2.5] as const;
export const ZOOM_LEVELS = [1, 1.25, 1.5, 1.75, 2] as const;

export interface DisplaySettings {
  textScale: number;
  zoom: number;
}

export const DEFAULT_DISPLAY: DisplaySettings = { textScale: 1, zoom: 1 };

export const DISPLAY_KEY = 'chat-viewer-display';

/** Coerce arbitrary stored data to a valid setting. Unknown values fall back to the default. */
export function sanitizeDisplay(value: unknown): DisplaySettings {
  const v = (value ?? {}) as Partial<Record<keyof DisplaySettings, unknown>>;
  const textScale = (TEXT_SCALES as readonly number[]).includes(Number(v.textScale))
    ? Number(v.textScale)
    : DEFAULT_DISPLAY.textScale;
  const zoom = (ZOOM_LEVELS as readonly number[]).includes(Number(v.zoom))
    ? Number(v.zoom)
    : DEFAULT_DISPLAY.zoom;
  return { textScale, zoom };
}

export function loadDisplay(): DisplaySettings {
  try {
    const raw = localStorage.getItem(DISPLAY_KEY);
    return raw ? sanitizeDisplay(JSON.parse(raw)) : DEFAULT_DISPLAY;
  } catch {
    return DEFAULT_DISPLAY;
  }
}

export function saveDisplay(settings: DisplaySettings): void {
  try {
    localStorage.setItem(DISPLAY_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable: the choice applies for this session only.
  }
}

/** Apply settings to the document. */
export function applyDisplay(settings: DisplaySettings): void {
  const root = document.documentElement;
  root.style.fontSize = `${settings.textScale * 100}%`;
  root.style.setProperty('--ui-zoom', String(settings.zoom));
}
