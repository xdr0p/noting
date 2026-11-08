import { memo } from 'react';

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
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
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
