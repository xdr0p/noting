import { memo } from 'react';
import { ContextMenuPos } from '../../types';

interface ContextMenuProps {
  pos: ContextMenuPos | null;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onFind: () => void;
  onGoToLine: () => void;
  onClose: () => void;
}

const getConstrainedPos = (pos: ContextMenuPos | null, menuWidth = 180, menuHeight = 200) => {
  if (!pos) return { top: 0, left: 0 };
  const left = Math.min(Math.max(0, pos.x), Math.max(0, window.innerWidth - menuWidth));
  const top = Math.min(Math.max(0, pos.y), Math.max(0, window.innerHeight - menuHeight));
  return { top, left };
};

export const ContextMenu = memo(function ContextMenu({
  pos,
  onCut,
  onCopy,
  onPaste,
  onFind,
  onGoToLine,
  onClose,
}: ContextMenuProps) {
  if (!pos) return null;

  return (
    <div 
      className="context-menu" 
      style={getConstrainedPos(pos, 180, 200)}
      onClick={onClose}
    >
      <button onClick={onCut}>Cut</button>
      <button onClick={onCopy}>Copy</button>
      <button onClick={onPaste}>Paste</button>
      
      <div className="toolbar-divider" style={{ width: '100%', height: '1px', margin: '4px 0' }}></div>
      <button onClick={onFind}>Find (Ctrl+F)</button>
      <button onClick={onGoToLine}>Go To (Ctrl+G)</button>
    </div>
  );
});
