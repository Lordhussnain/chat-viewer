import { createContext, useContext, type ReactNode } from 'react';

/** Object URLs for loaded images, keyed by file name (e.g. "image-1.jpg"). */
export const AssetsContext = createContext<Record<string, string>>({});

export function AssetsProvider({ value, children }: { value: Record<string, string>; children: ReactNode }) {
  return <AssetsContext.Provider value={value}>{children}</AssetsContext.Provider>;
}

/** Markdown <img>: resolves relative links like "image-1.jpg" to loaded images. */
export function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const assets = useContext(AssetsContext);
  if (!src) return null;
  if (/^(https?:|data:|blob:)/i.test(src)) return <img src={src} alt={alt ?? ''} className="md-img" />;
  const name = decodeURIComponent(src).split(/[\\/]/).pop() ?? src;
  const url = assets[name];
  if (url) return <img src={url} alt={alt ?? name} className="md-img" loading="lazy" />;
  return (
    <span className="missing-img" title="Load this image file to display it">
      [image not loaded: {name}]
    </span>
  );
}
