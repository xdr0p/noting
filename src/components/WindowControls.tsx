import { memo } from 'react';

interface WindowControlsProps {
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
}

export const WindowControls = memo(function WindowControls({
  onMinimize,
  onMaximize,
  onClose,
}: WindowControlsProps) {
  return (
    <div className="window-controls">
      <button className="control-btn" onClick={onMinimize} title="Minimize">—</button>
      <button className="control-btn" onClick={onMaximize} title="Maximize">☐</button>
      <button className="control-btn close" onClick={onClose} title="Close">✕</button>
    </div>
  );
});
