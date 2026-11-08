import React, { memo } from 'react';

interface ToolbarProps {
  wordWrap: boolean;
  showMinimap: boolean;
  isBoldActive: boolean;
  isItalicActive: boolean;
  dot1Ref: React.RefObject<HTMLSpanElement | null>;
  dot2Ref: React.RefObject<HTMLSpanElement | null>;
  dot3Ref: React.RefObject<HTMLSpanElement | null>;
  onNewTab: () => void;
  onOpen: () => void;
  onShowRecent: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExportPdf: () => void;
  onToggleWordWrap: () => void;
  onToggleMinimap: () => void;
  onToggleBold: () => void;
  onToggleItalic: () => void;
  onToggleAnimation: (e: React.MouseEvent) => void;
}

export const Toolbar = memo(function Toolbar({
  wordWrap,
  showMinimap,
  isBoldActive,
  isItalicActive,
  dot1Ref,
  dot2Ref,
  dot3Ref,
  onNewTab,
  onOpen,
  onShowRecent,
  onSave,
  onSaveAs,
  onExportPdf,
  onToggleWordWrap,
  onToggleMinimap,
  onToggleBold,
  onToggleItalic,
  onToggleAnimation,
}: ToolbarProps) {
  return (
    <div className="titlebar">
      <div className="titlebar-left">
        <button className="menu-btn" onClick={onNewTab}>New</button>
        <button className="menu-btn" onClick={onOpen}>Open</button>
        <button className="menu-btn" onClick={onShowRecent}>Recent</button>
        <button className="menu-btn" onClick={onSave}>Save</button>
        <button className="menu-btn" onClick={onSaveAs}>Save As</button>
        <button className="menu-btn" onClick={onExportPdf}>Export PDF</button>

        <div className="toolbar-divider"></div>

        <button 
          className={`menu-btn ${wordWrap ? 'is-active' : ''}`} 
          onClick={onToggleWordWrap}
        >
          Wrap
        </button>

        <button 
          className={`menu-btn ${showMinimap ? 'is-active' : ''}`} 
          onClick={onToggleMinimap}
        >
          Map
        </button>

        <div className="toolbar-divider"></div>

        <div className="format-group">
          <button 
            onClick={onToggleBold} 
            className={`format-btn ${isBoldActive ? 'is-active' : ''}`}
            title="Bold (Ctrl+B)"
          >
            B
          </button>
          <button 
            onClick={onToggleItalic} 
            className={`format-btn ${isItalicActive ? 'is-active' : ''}`} 
            style={{ fontStyle: 'italic' }}
            title="Italic (Ctrl+I)"
          >
            I
          </button>
        </div>
      </div>

      <div className="titlebar-right">
        <button 
          type="button"
          className="fun-animation-btn"
          onClick={onToggleAnimation}
          onMouseDown={(e) => e.stopPropagation()}
          title="Toggle Flow State"
        >
          <span className="dot" ref={dot1Ref}></span>
          <span className="dot" ref={dot2Ref}></span>
          <span className="dot" ref={dot3Ref}></span>
        </button>
      </div>
    </div>
  );
});
