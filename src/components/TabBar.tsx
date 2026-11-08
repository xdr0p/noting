import React, { memo } from 'react';
import appIcon from '../assets/app-icon.png';
import { Tab } from '../types';
import { WindowControls } from './WindowControls';

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  draggedTabId: string | null;
  dragOverTabId: string | null;
  canScrollLeft: boolean;
  canScrollRight: boolean;
  tabsWrapperRef: React.RefObject<HTMLDivElement | null>;
  onScrollCheck: () => void;
  onScrollLeft: () => void;
  onScrollRight: () => void;
  onSelectTab: (id: string) => void;
  onTabMouseDown: (e: React.MouseEvent, id: string) => void;
  onTabMouseEnter: (id: string) => void;
  onTabMouseLeave: () => void;
  onTabContextMenu: (e: React.MouseEvent, tabId: string) => void;
  onCloseTab: (e: React.MouseEvent, id: string) => void;
  onAddTab: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
  onCloseApp: () => void;
}

export const TabBar = memo(function TabBar({
  tabs,
  activeTabId,
  draggedTabId,
  dragOverTabId,
  canScrollLeft,
  canScrollRight,
  tabsWrapperRef,
  onScrollCheck,
  onScrollLeft,
  onScrollRight,
  onSelectTab,
  onTabMouseDown,
  onTabMouseEnter,
  onTabMouseLeave,
  onTabContextMenu,
  onCloseTab,
  onAddTab,
  onMinimize,
  onMaximize,
  onCloseApp,
}: TabBarProps) {
  return (
    <div className="tab-bar" data-tauri-drag-region>
      {/* 1. App Icon */}
      <div className="titlebar-icon" data-tauri-drag-region>
        <img 
          src={appIcon} 
          alt="app icon" 
          style={{ width: '16px', height: '16px', pointerEvents: 'none' }} 
        />
      </div>

      {/* Scroll Left Button */}
      {(canScrollLeft || canScrollRight) && (
        <button 
          className={`tab-scroll-btn ${!canScrollLeft ? 'disabled' : ''}`}
          onClick={onScrollLeft}
          title="Scroll Tabs Left"
          disabled={!canScrollLeft}
        >
          ‹
        </button>
      )}

      {/* 2. Tabs Wrapper */}
      <div 
        className={`tabs-wrapper${draggedTabId ? ' is-dragging' : ''}`}
        ref={tabsWrapperRef}
        data-tauri-drag-region
        onScroll={onScrollCheck}
        onMouseLeave={onTabMouseLeave}
        onWheel={(e) => {
          if (e.deltaY !== 0) {
            e.currentTarget.scrollLeft += e.deltaY;
            onScrollCheck();
          }
        }}
      >
        {tabs.map(tab => (
          <div 
            key={tab.id} 
            className={`tab ${tab.id === activeTabId ? 'active' : ''} ${tab.id === draggedTabId ? 'dragging' : ''} ${tab.id === dragOverTabId ? 'drag-over' : ''}`}
            onClick={() => !draggedTabId && onSelectTab(tab.id)}
            onMouseDown={(e) => onTabMouseDown(e, tab.id)}
            onMouseEnter={() => onTabMouseEnter(tab.id)}
            onMouseLeave={onTabMouseLeave}
            onContextMenu={(e) => onTabContextMenu(e, tab.id)}
          >
            <span className="tab-title">
              {tab.isPinned ? <span style={{ fontSize: '0.75rem', marginRight: '4px' }}>📌</span> : ''}
              {tab.title}{tab.isDirty ? ' •' : ''}
            </span>
            <button className="tab-close" onClick={(e) => onCloseTab(e, tab.id)}>×</button>
          </div>
        ))}
        <div className="add-tab-container" data-tauri-drag-region>
          <button className="add-tab-plus" onClick={onAddTab} title="New Tab">+</button>
        </div>
      </div>

      {/* Scroll Right Button */}
      {(canScrollLeft || canScrollRight) && (
        <button 
          className={`tab-scroll-btn ${!canScrollRight ? 'disabled' : ''}`}
          onClick={onScrollRight}
          title="Scroll Tabs Right"
          disabled={!canScrollRight}
        >
          ›
        </button>
      )}

      {/* 3. Window Controls */}
      <WindowControls 
        onMinimize={onMinimize} 
        onMaximize={onMaximize} 
        onClose={onCloseApp} 
      />
    </div>
  );
});
