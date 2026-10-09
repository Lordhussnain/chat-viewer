import { useRef, useState, type ReactNode } from 'react';

interface Props {
  left: ReactNode;
  right: ReactNode;
  /** Which pane tab and sidebar clicks go to. */
  focus: 'left' | 'right';
  onFocus: (side: 'left' | 'right') => void;
}

/**
 * Side-by-side panes with a draggable divider. The divider can be dragged to give one pane
 * (almost) the whole screen, and double-clicked to return to an even split.
 */
export function SplitPanes({ left, right, focus, onFocus }: Props) {
  const splitRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(0.5);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const rect = splitRef.current?.getBoundingClientRect();
      if (!rect) return;
      const r = (ev.clientX - rect.left) / rect.width;
      setRatio(Math.min(0.85, Math.max(0.15, r)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="split" ref={splitRef}>
      <div
        className={`pane ${focus === 'left' ? 'focused' : ''}`}
        style={{ flexGrow: ratio, flexBasis: 0 }}
        onMouseDown={() => onFocus('left')}
      >
        {left}
      </div>
      <div
        className="split-divider"
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize · double-click for an even split"
        onPointerDown={startDrag}
        onDoubleClick={() => setRatio(0.5)}
      />
      <div
        className={`pane ${focus === 'right' ? 'focused' : ''}`}
        style={{ flexGrow: 1 - ratio, flexBasis: 0 }}
        onMouseDown={() => onFocus('right')}
      >
        {right}
      </div>
    </div>
  );
}
