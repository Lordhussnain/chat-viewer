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

/**
 * The file name an image link refers to, for matching against loaded images.
 * Web links may carry the name in their `fn` query parameter (ChatGPT Exporter) or use it as alt text.
 */
function imageName(src: string, alt?: string): string | undefined {
  if (!/^https?:/i.test(src)) {
    try {
      return decodeURIComponent(src).split(/[\\/]/).pop() ?? src;
    } catch {
      return src.split(/[\\/]/).pop() ?? src;
    }
  }
  try {
    const fn = new URL(src).searchParams.get('fn');
    if (fn) return fn;
  } catch {
    // not a parseable URL; fall through to the alt text
  }
  if (alt && /\.[a-z0-9]+$/i.test(alt.trim())) return alt.trim();
  return undefined;
}

/** Markdown <img>: resolves image links to loaded images by file name, then to the web. */
export function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const assets = useContext(AssetsContext);
  if (!src) return null;
  if (/^(data:|blob:)/i.test(src)) return <img src={src} alt={alt ?? ''} className="md-img" />;
  // A loaded file with the same name wins: web links in exports can expire, and names are
  // how the app matches images across everything loaded in the session.
  const name = imageName(src, alt);
  const url = name ? assets[name] : undefined;
  if (url) return <img src={url} alt={alt ?? name} className="md-img" loading="lazy" />;
  if (/^https?:/i.test(src)) return <RemoteImage src={src} alt={alt ?? ''} />;
  return (
    <span className="missing-img" title="Load this image file to display it">
      [image not loaded: {name}]
    </span>
  );
}
