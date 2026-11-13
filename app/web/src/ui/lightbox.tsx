import { useEffect, type ReactNode } from 'react';

/**
 * Fixed full-screen scrim: esc / click-outside / close button to dismiss.
 * The one overlay primitive — image lightboxes and the panel-style modals (breakdown, borrow)
 * all sit on it, so dismissal behaves identically everywhere.
 */
export function Overlay({ onClose, className = '', children }: {
  onClose: () => void; className?: string; children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    // The scrim is dark in BOTH themes: `bg-hero` + the phase-3 dark-surface scope (§2),
    // so the chrome inside reads against a dark ground instead of inverting with the theme.
    <div data-surface="dark" className="fixed inset-0 z-[60] flex items-center justify-center bg-hero/80 p-6" onClick={onClose}>
      <div className={className} onClick={(e) => e.stopPropagation()}>{children}</div>
      <button aria-label="close" onClick={onClose}
        className="absolute right-5 top-5 rounded-full bg-paper px-3 py-1 text-[13px] lowercase text-ink hover:opacity-80">
        close ✕
      </button>
    </div>
  );
}

/** Full-size image view with an optional action row underneath. */
export function Lightbox({ src, alt, onClose, children }: {
  src: string; alt: string; onClose: () => void; children?: ReactNode;
}) {
  return (
    <Overlay onClose={onClose} className="flex max-h-full flex-col items-center gap-3">
      <img src={src} alt={alt} className="max-h-[80vh] max-w-full rounded-card object-contain" />
      {children && <div className="flex items-center gap-2">{children}</div>}
    </Overlay>
  );
}
