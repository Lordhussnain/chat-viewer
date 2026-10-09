/**
 * Display settings for readability: text size, whole-interface zoom, content width and page layout.
 *
 * Text size scales the root font size as a percentage of the browser's own default,
 * so a larger default set in the browser is still respected. Zoom sets the --ui-zoom
 * CSS variable, which the .app container uses to scale the whole interface. Width grows
 * the content column from the comfortable reading width to the full pane (--content-grow),
 * and pages chooses between a one-column and a two-column (two-page) layout.
 */

export const TEXT_SCALES = [1, 1.25, 1.5, 1.75, 2, 2.5] as const;
export const ZOOM_LEVELS = [1, 1.25, 1.5, 1.75, 2] as const;

/** Slider positions for the content width, 0 (comfortable) to 100 (full screen). */
export const WIDTH_MIN = 0;
export const WIDTH_MAX = 100;

export interface DisplaySettings {
  textScale: number;
  zoom: number;
  /** Content width: 0 = comfortable reading width, 100 = the whole pane. */
  width: number;
  /** How many pages the content flows across: 1 or 2. */
  pages: 1 | 2;
}

export const DEFAULT_DISPLAY: DisplaySettings = { textScale: 1, zoom: 1, width: WIDTH_MIN, pages: 1 };

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
  const w = Number(v.width);
  const width = Number.isFinite(w) && w >= WIDTH_MIN && w <= WIDTH_MAX ? Math.round(w) : DEFAULT_DISPLAY.width;
  const p = Number(v.pages);
  const pages: 1 | 2 = p === 2 ? 2 : p === 1 ? 1 : DEFAULT_DISPLAY.pages;
  return { textScale, zoom, width, pages };
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
  root.style.setProperty('--content-grow', String(settings.width / 100));
  root.dataset.pages = String(settings.pages);
}
