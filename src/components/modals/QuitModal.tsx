import { memo, useRef, useEffect } from 'react';

interface QuitModalProps {
  isOpen: boolean;
  onReviewTabs: () => void;
  onQuitAnyway: () => void;
}

export const QuitModal = memo(function QuitModal({
  isOpen,
  onReviewTabs,
  onQuitAnyway,
}: QuitModalProps) {
  const onCancelRef = useRef(onReviewTabs);
  useEffect(() => { onCancelRef.current = onReviewTabs; }, [onReviewTabs]);

  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const modal = modalRef.current;
    if (!modal) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = modal.querySelectorAll<HTMLElement>(
      'button, input, [tabindex]:not([tabindex="-1"])');
    if (focusables.length > 0) focusables[0].focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancelRef.current();
        return;
      }
      if (e.key === 'Tab') {
        const current = modal.querySelectorAll<HTMLElement>(
          'button, input, [tabindex]:not([tabindex="-1"])');
        if (current.length === 0) return;
        const first = current[0];
        const last = current[current.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      previouslyFocused?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content" ref={modalRef}>
        <h3>Quit App?</h3>
        <p>You have unsaved tabs open. If you quit now, your work will be permanently lost.</p>
        <div className="modal-actions">
          <button className="modal-btn neutral" onClick={onReviewTabs}>Review Tabs</button>
          <button className="modal-btn danger" onClick={onQuitAnyway}>Quit Anyway</button>
        </div>
      </div>
    </div>
  );
});
