import React, { memo } from 'react';
import { TabContextMenuPos } from '../../types';

interface TabContextMenuProps {
  pos: TabContextMenuPos | null;
  isPinned: boolean;
  onTogglePin: () => void;
  onCloseTab: (e: React.MouseEvent) => void;
  onCloseMenu: () => void;
}

const getConstrainedPos = (pos: TabContextMenuPos | null, menuWidth = 180, menuHeight = 120) => {
  if (!pos) return { top: 0, left: 0 };
  const left = Math.min(Math.max(0, pos.x), Math.max(0, window.innerWidth - menuWidth));
  const top = Math.min(Math.max(0, pos.y), Math.max(0, window.innerHeight - menuHeight));
  return { top, left };
};

export const TabContextMenu = memo(function TabContextMenu({
  pos,
  isPinned,
  onTogglePin,
  onCloseTab,
  onCloseMenu,
}: TabContextMenuProps) {
  if (!pos) return null;

  return (
    <div 
      className="context-menu" 
      style={getConstrainedPos(pos, 180, 120)}
      onClick={(e) => e.stopPropagation()}
    >
      <button onClick={() => {
        onTogglePin();
        onCloseMenu();
      }}>
        {isPinned ? 'Unpin Tab' : 'Pin Tab'}
      </button>
      
      <div className="toolbar-divider" style={{ width: '100%', height: '1px', margin: '4px 0' }}></div>
      
      <button onClick={(e) => {
        onCloseTab(e);
        onCloseMenu();
      }}>
        Close Tab
      </button>
    </div>
  );
});
