import { memo } from 'react';

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
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h3>Go To Line</h3>
        <p>Enter the line number you want to jump to:</p>
        <input 
          type="number" 
          className="find-input" 
          style={{ width: '100%', marginBottom: '20px' }}
          value={lineNumber}
          autoFocus
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
