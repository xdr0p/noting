import { memo, useRef, useEffect } from 'react';

interface GoToLineModalProps {
  isOpen: boolean;
  lineNumber: string;
  onLineNumberChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export const GoToLineModal = memo(function GoToLineModal({
  isOpen,
  lineNumber,
  onLineNumberChange,
  onSubmit,
  onCancel,
}: GoToLineModalProps) {
  const onCancelRef = useRef(onCancel);
  useEffect(() => { onCancelRef.current = onCancel; }, [onCancel]);

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
        <h3>Go To Line</h3>
        <p>Enter the line number you want to jump to:</p>
        <input 
          type="number" 
          className="find-input" 
          style={{ width: '100%', marginBottom: '20px' }}
          value={lineNumber}
          onChange={(e) => onLineNumberChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
        />
        <div className="modal-actions">
          <button className="modal-btn neutral" onClick={onCancel}>Cancel</button>
          <button className="modal-btn primary" onClick={onSubmit}>Go</button>
        </div>
      </div>
    </div>
  );
});
