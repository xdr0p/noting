import React, { memo } from 'react';

interface MinimapProps {
  content: string;
  minimapViewportRef: React.RefObject<HTMLDivElement | null>;
  minimapContentRef: React.RefObject<HTMLDivElement | null>;
  onTrackMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  onViewportMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
}

export const Minimap = memo(function Minimap({
  content,
  minimapViewportRef,
  minimapContentRef,
  onTrackMouseDown,
  onViewportMouseDown,
}: MinimapProps) {
  return (
    <div className="minimap-container" onMouseDown={onTrackMouseDown}>
      <div 
        className="minimap-viewport" 
        ref={minimapViewportRef} 
        onMouseDown={onViewportMouseDown}
      >
        <div 
          className="minimap-content" 
          ref={minimapContentRef}
          dangerouslySetInnerHTML={{ __html: content }} 
        />
      </div> 
    </div>
  );
});
