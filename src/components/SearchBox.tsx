import React, { memo } from 'react';

interface SearchBoxProps {
  showSearch: boolean;
  searchTerm: string;
  replaceTerm: string;
  resultCountText: string;
  findBoxRef: React.RefObject<HTMLDivElement | null>;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  onSearchChange: (value: string) => void;
  onReplaceChange: (value: string) => void;
  onPreviousMatch: () => void;
  onNextMatch: () => void;
  onReplaceCurrent: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
  onClearTerms: () => void;
}

export const SearchBox = memo(function SearchBox({
  showSearch,
  searchTerm,
  replaceTerm,
  resultCountText,
  findBoxRef,
  searchInputRef,
  onSearchChange,
  onReplaceChange,
  onPreviousMatch,
  onNextMatch,
  onReplaceCurrent,
  onReplaceAll,
  onClose,
  onClearTerms,
}: SearchBoxProps) {
  if (!showSearch) return null;

  return (
    <div 
      className="find-box replace-mode"
      ref={findBoxRef}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (searchTerm || replaceTerm) {
            onClearTerms();
          } else {
            onClose();
          }
          return;
        }

        if (e.key === 'Tab') {
          const focusableElements = findBoxRef.current?.querySelectorAll<HTMLElement>('input, button');
          if (!focusableElements || focusableElements.length === 0) return;

          const firstElement = focusableElements[0];
          const lastElement = focusableElements[focusableElements.length - 1];

          if (e.shiftKey && document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          } else if (!e.shiftKey && document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }}
    >
      {/* ROW 1: FIND & NAVIGATION */}
      <div className="find-row">
        <input 
          ref={searchInputRef}
          type="text" 
          className="find-input" 
          placeholder="Find..." 
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (e.shiftKey) onPreviousMatch();
              else onNextMatch();
            }
          }}
        />
        <span className="find-count">{resultCountText}</span>
        
        <button className="find-btn" onClick={onPreviousMatch} title="Previous match (Shift+Enter)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
        </button>
        <button className="find-btn" onClick={onNextMatch} title="Next match (Enter)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
        <button className="find-btn" onClick={onClose} title="Close (Escape)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>

      {/* ROW 2: REPLACE ACTIONS */}
      <div className="replace-row">
        <input 
          type="text" 
          className="find-input" 
          placeholder="Replace with..." 
          value={replaceTerm}
          onChange={(e) => onReplaceChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onReplaceCurrent();
            }
          }}
        />
        <button className="find-btn action" onClick={onReplaceCurrent}>Replace</button>
        <button className="find-btn action" onClick={onReplaceAll}>All</button>
      </div>
    </div>
  );
});
