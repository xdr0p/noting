import { memo } from 'react';

interface UnsavedModalProps {
  isOpen: boolean;
  tabTitle: string;
  onSave: () => void;
  onDontSave: () => void;
  onCancel: () => void;
}

export const UnsavedModal = memo(function UnsavedModal({
  isOpen,
  tabTitle,
  onSave,
  onDontSave,
  onCancel,
}: UnsavedModalProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h3>Unsaved Changes</h3>
        <p>Do you want to save "{tabTitle}"?</p>
        <div className="modal-actions">
          <button className="modal-btn primary" onClick={onSave}>Save</button>
          <button className="modal-btn danger" onClick={onDontSave}>Don't Save</button>
          <button className="modal-btn neutral" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
});
