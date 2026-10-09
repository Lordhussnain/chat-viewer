import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/** How long a web image may take to arrive before it is shown as not available. */
export const IMAGE_TIMEOUT_MS = 30_000;

/** Object URLs for loaded images, keyed by file name (e.g. "image-1.jpg"). */
export const AssetsContext = createContext<Record<string, string>>({});

export function AssetsProvider({ value, children }: { value: Record<string, string>; children: ReactNode }) {
  return <AssetsContext.Provider value={value}>{children}</AssetsContext.Provider>;
}

/**
 * A web image (for example a generated image in a Qwen export). The browser downloads it; if it fails,
 * or has not arrived after IMAGE_TIMEOUT_MS, the place shows "Image not available" instead.
 */
function RemoteImage({ src, alt }: { src: string; alt: string }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');

  useEffect(() => {
    setState('loading');
    const timer = window.setTimeout(() => {
      setState((current) => (current === 'loaded' ? current : 'failed'));
    }, IMAGE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [src]);

  if (state === 'failed') {
    return (
      <span className="missing-img" title={src}>
        Image not available
      </span>
    );
  }
  return (
    <>
      {state === 'loading' && <span className="img-loading">Loading image…</span>}
      <img
        src={src}
        alt={alt}
        className="md-img"
        hidden={state !== 'loaded'}
        onLoad={() => setState('loaded')}
        onError={() => setState('failed')}
      />
    </>
  );
}

/** Markdown <img>: resolves relative links like "image-1.jpg" to loaded images. */
export function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const assets = useContext(AssetsContext);
  if (!src) return null;
  if (/^https?:/i.test(src)) return <RemoteImage src={src} alt={alt ?? ''} />;
  if (/^(data:|blob:)/i.test(src)) return <img src={src} alt={alt ?? ''} className="md-img" />;
  const name = decodeURIComponent(src).split(/[\\/]/).pop() ?? src;
  const url = assets[name];
  if (url) return <img src={url} alt={alt ?? name} className="md-img" loading="lazy" />;
  return (
    <span className="missing-img" title="Load this image file to display it">
      [image not loaded: {name}]
    </span>
  );
}
