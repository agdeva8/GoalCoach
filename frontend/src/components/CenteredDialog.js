import { useEffect, useRef } from "react";
import { X } from "lucide-react";

/**
 * CenteredDialog — reusable warm-themed modal wrapper.
 *
 * Builds on top of the shadcn `Dialog` primitives in `components/ui/dialog.jsx`
 * but layers the warm Sutra theme (accent border, accent-tinted
 * overlay, fade-up animation, generous padding) and standardizes the
 * header / close-button layout every dialog in the app uses. This is
 * the single source of truth for "centered modal" so the Add Goal,
 * Edit Goal, Delete Goal, Add Source, and Delete Source flows all
 * render the same shape.
 *
 * Props:
 *   open        — controlled open state
 *   onClose     — close handler (also fires on Esc + overlay click)
 *   title       — string OR React node shown in the header
 *   subtitle    — optional supporting line below the title
 *   icon        — optional Lucide icon shown left of the title
 *   children    — dialog body content
 *   footer      — optional React node (typically Cancel + primary action)
 *   maxWidth    — Tailwind max-w-* class (default: "max-w-xl")
 *   testId      — data-testid for the root element (default: "centered-dialog")
 *   closeOnBackdrop — when false, overlay clicks are ignored (default: true)
 */
export default function CenteredDialog({
  open,
  onClose,
  title,
  subtitle,
  icon: Icon,
  children,
  footer,
  maxWidth = "max-w-xl",
  testId = "centered-dialog",
  closeOnBackdrop = true,
}) {
  const dialogRef = useRef(null);
  const lastFocusedRef = useRef(null);

  // Esc-to-close — handled here (not via shadcn) so we can layer this
  // on top of whatever primitive the body uses.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock body scroll while the dialog is open so the underlying page
  // doesn't shift. Mirrors the behaviour of the existing SignInModal.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Focus the dialog on open so screen readers announce it and Tab
  // cycles within the body. When the dialog closes, restore focus to
  // the element that opened it so keyboard users don't lose their place.
  useEffect(() => {
    if (open) {
      lastFocusedRef.current = document.activeElement;
      // Defer to next tick — shadcn uses Radix which mounts in a portal
      // on the same frame, so waiting one tick guarantees the ref is live.
      const t = setTimeout(() => dialogRef.current?.focus(), 0);
      return () => clearTimeout(t);
    } else {
      // Restore focus on close. Use a microtask so any close-time
      // re-renders settle first.
      const t = setTimeout(() => {
        const last = lastFocusedRef.current;
        if (last && typeof last.focus === "function" && document.contains(last)) {
          last.focus();
        }
      }, 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      data-testid={testId}
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : undefined}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
    >
      <div
        data-testid={`${testId}-backdrop`}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm gc-fade-in"
        onClick={() => closeOnBackdrop && onClose?.()}
      />
      <div
        ref={dialogRef}
        tabIndex={-1}
        data-testid={`${testId}-content`}
        className={`relative w-full ${maxWidth} bg-[var(--bg-secondary)] border border-[color-mix(in_srgb,var(--border-accent)_30%,transparent)] shadow-2xl gc-fade-up outline-none`}
      >
        {(title || Icon) && (
          <div className="flex items-start gap-3 px-5 py-4 border-b border-[var(--border)]">
            {Icon && <Icon className="w-5 h-5 text-[var(--accent)] mt-0.5 shrink-0" />}
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-base font-semibold tracking-tight text-[var(--text-primary)] leading-snug">
                {title}
              </h2>
              {subtitle && (
                <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                  {subtitle}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              data-testid={`${testId}-close`}
              title="Close"
              aria-label="Close"
              className="h-10 w-10 -mr-2 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {!title && !Icon && (
          <button
            onClick={onClose}
            data-testid={`${testId}-close`}
            title="Close"
            aria-label="Close"
            className="absolute top-2 right-2 h-10 w-10 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] rounded"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        <div className="px-5 py-4 max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-primary)_40%,transparent)]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
