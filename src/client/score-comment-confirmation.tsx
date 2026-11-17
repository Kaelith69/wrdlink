import { useEffect, useRef } from 'react';

type Props = {
  open: boolean;
  title: string;
  preview: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ScoreCommentConfirmation({
  open,
  title,
  preview,
  busy,
  onCancel,
  onConfirm,
}: Props) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    if (!open) return;

    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    cancelRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
      )];
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="hint-confirmation-backdrop score-comment-confirmation">
      <section
        ref={dialogRef}
        className="hint-confirmation score-comment-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="score-comment-title"
        aria-describedby="score-comment-explanation"
      >
        <span className="help-kicker">REDDIT COMMENT PREVIEW</span>
        <h2 id="score-comment-title">{title}</h2>
        <p id="score-comment-explanation">
          This will publish the exact text below as a public Reddit comment under your Reddit username.
          {title.toLowerCase().includes('personal') ? ' Your personal message will appear as a top level comment.' : ' Your score will appear as a reply to the pinned WRDLINK score thread.'}
        </p>
        <pre className="score-comment-preview">{preview}</pre>
        <div className="hint-confirm-actions score-comment-actions">
          <button
            ref={cancelRef}
            className="secondary-button"
            type="button"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className="ink-button"
            type="button"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Submitting…' : 'Confirm and comment as me'}
          </button>
        </div>
      </section>
    </div>
  );
}
