import TurndownService from 'turndown';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import SearchAndReplace from '@sereneinserenade/tiptap-search-and-replace';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Italic from '@tiptap/extension-italic';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import { Extension, InputRule } from '@tiptap/core'; 
import { Selection } from '@tiptap/pm/state';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open, save } from '@tauri-apps/plugin-dialog'; 
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'; 
import './App.css';
import { Tab, Toast, ContextMenuPos, TabContextMenuPos } from './types';
import { TabBar } from './components/TabBar';
import { Toolbar } from './components/Toolbar';
import { SearchBox } from './components/SearchBox';
import { Minimap } from './components/Minimap';
import { StatusBar } from './components/StatusBar';
import { ToastNotification } from './components/Toast';
import { EditorPane } from './components/EditorPane';
import { UnsavedModal } from './components/modals/UnsavedModal';
import { QuitModal } from './components/modals/QuitModal';
import { GoToLineModal } from './components/modals/GoToLineModal';
import { RecentFilesModal } from './components/modals/RecentFilesModal';
import { ContextMenu } from './components/modals/ContextMenu';
import { TabContextMenu } from './components/modals/TabContextMenu';
import {
  toSuperscript,
  SUPERSCRIPT_CHARS,
  MATH_CLASS_RE,
  MATH_FIND_RE,
  buildMathTransaction,
} from './lib/math';
import {
  titleFromPath,
  titleFromEditor,
  suggestedFileName,
  isEmptyUntitledTab,
  isBlankUnsavedTab,
  isTxtFile,
  textToHtml,
  htmlToText,
  pasteTextToHtml,
} from './lib/text';

// Custom Italic extension that disables default asterisk/underscore input rules
// so typing math asterisks like 5*2*3 doesn't accidentally format text as italic
const CustomItalic = Italic.extend({
  addInputRules() {
    return [];
  },
});

const AutoExponent = Extension.create({
  name: 'autoExponent',

  addInputRules() {
    return [
      new InputRule({
        find: /(\d+|\))\s*\^\s*(-?[0-9]+)$/,
        handler: ({ state, range, match }) => {
          const base = match[1];
          const exponent = match[2];

          state.tr.insertText(`${base}${toSuperscript(exponent)}`, range.from, range.to);
        },
      }),

      new InputRule({
        find: new RegExp('([' + SUPERSCRIPT_CHARS + ']+)([0-9])$'),
        handler: ({ state, range, match }) => {
          const existingExponent = match[1];
          const nextDigit = match[2];

          state.tr.insertText(`${existingExponent}${toSuperscript(nextDigit)}`, range.from, range.to);
        },
      }),
    ];
  },
});

const MathSpacing = Extension.create({
  name: 'mathSpacing',

  addInputRules() {
    return [
      new InputRule({
        find: /([0-9a-zA-Z\)\u00B9\u00B2\u00B3\u2070-\u207F])([\+\-\*/])$/,
        handler: ({ state, range, match }) => {
          state.tr.insertText(`${match[1]} ${match[2]} `, range.from, range.to);
        },
      }),
      new InputRule({
        find: /([\+\-\*/])([0-9a-zA-Z])$/,
        handler: ({ state, range, match }) => {
          state.tr.insertText(`${match[1]} ${match[2]}`, range.from, range.to);
        },
      }),
    ];
  },
});

const MathEngine = Extension.create({
  name: 'mathEngine',
  priority: 1000,

  addInputRules() {
    return [
      new InputRule({
        find: MATH_FIND_RE,
        handler: ({ state, range }) => {
          const $head = state.doc.resolve(range.to);
          const textBeforeCursorInBlock = $head.parent.textBetween(0, $head.parentOffset, '\n', '\n');
          const lastNewline = textBeforeCursorInBlock.lastIndexOf('\n');
          const currentLineText = lastNewline !== -1 ? textBeforeCursorInBlock.slice(lastNewline + 1) : textBeforeCursorInBlock;

          if (currentLineText.includes('=>')) return null;

          const lineMatch = currentLineText.match(MATH_FIND_RE);
          if (!lineMatch) return null;

          const from = $head.pos - lineMatch[0].length;
          const to = range.to;
          return buildMathTransaction(state, lineMatch[0], from, to);
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      'Enter': () => {
        const { state } = this.editor;
        const { selection } = state;
        const { $head } = selection;

        if (!$head) return false;

        const textBeforeCursorInBlock = $head.parent.textBetween(0, $head.parentOffset, '\n', '\n');
        const lastNewline = textBeforeCursorInBlock.lastIndexOf('\n');
        const currentLineText = lastNewline !== -1 ? textBeforeCursorInBlock.slice(lastNewline + 1) : textBeforeCursorInBlock;

        if (currentLineText.includes('=>')) return false;

        const match = currentLineText.match(MATH_CLASS_RE);
        if (!match || match[1].trim() === '') return false;

        const from = $head.pos - match[1].length;
        const to = $head.pos;

        const tr = buildMathTransaction(state, match[1], from, to);
        if (tr) {
          this.editor.view.dispatch(tr);
          return true;
        }
        return false;
      },
    };
  },
});

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

const getMarkdown = (html: string): string => {
  return turndownService.turndown(html);
};

const PURIFY_CONFIG = {
  ALLOWED_TAGS: ['p','br','h1','h2','h3','h4','h5','h6',
                 'strong','em','s','del','u','code','pre','blockquote',
                 'ul','ol','li','hr','a','sup','sub','span'],
  ALLOWED_ATTR: ['href','target','rel','class'],
  FORBID_TAGS:  ['script','style','iframe','object','embed','form','input','button','svg','math'],
  FORBID_ATTR:  ['style'],
};

const createTabId = () => crypto.randomUUID();

const parseFileContent = async (rawText: string): Promise<string> => {
  const parsed = await marked.parse(rawText);
  const rawHtml = typeof parsed === 'string' ? parsed : String(parsed);
  return DOMPurify.sanitize(rawHtml, PURIFY_CONFIG);
};

const updatePlaceholderVisibility = (editor: any) => {
  const shouldHide = editor.state.doc.childCount > 1
    || (editor.state.doc.firstChild?.content.size ?? 0) > 0;
  editor.view.dom.classList.toggle('hide-empty-placeholder', shouldHide);
};

function App() {
  const appWindow = useMemo(() => getCurrentWindow(), []);
  const isForceClosingRef = useRef(false);

  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, type: 'info' | 'error' | 'success' = 'info') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ id: String(Date.now()), message, type });
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
    }, 4000);
  }, []);

  const dragRef = useRef<{ onMove: (e: MouseEvent) => void; onUp: () => void } | null>(null);

  useEffect(() => () => {
    if (dragRef.current) {
      window.removeEventListener('mousemove', dragRef.current.onMove);
      window.removeEventListener('mouseup', dragRef.current.onUp);
      dragRef.current = null;
    }
  }, []);
  
  // 1. ALL STATE DECLARED EXACTLY ONCE
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([{ id: '1', title: 'Untitled', content: '', isDirty: false }]);
  const [activeTabId, setActiveTabId] = useState('1');

  // contentMapRef is the live, synchronous source of truth for tab content.
  // The tabs state array is eventually consistent via the 250ms debounce (3.5).
  const contentMapRef = useRef<Map<string, string>>(new Map());

  // Seed on mount and when new tabs appear (additive only)
  useEffect(() => {
    for (const t of tabs) {
      if (!contentMapRef.current.has(t.id)) {
        contentMapRef.current.set(t.id, t.content);
      }
    }
    // Prune closed tabs
    const live = new Set(tabs.map(t => t.id));
    for (const k of contentMapRef.current.keys()) {
      if (!live.has(k)) contentMapRef.current.delete(k);
    }
  }, [tabs]);

  const tabsRef = useRef(tabs);
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);

  const activeTabIdRef = useRef(activeTabId);
  useEffect(() => { activeTabIdRef.current = activeTabId; }, [activeTabId]);

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

  const [minimapContent, setMinimapContent] = useState<string>(tabs[0].content);
  const titleRafRef = useRef<number | null>(null);
  const minimapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (titleRafRef.current !== null) cancelAnimationFrame(titleRafRef.current);
    if (minimapTimerRef.current !== null) clearTimeout(minimapTimerRef.current);
  }, []);

  const editorRef = useRef<any>(null);

  const getActiveTab = useCallback(
    () => tabsRef.current.find(t => t.id === activeTabIdRef.current) || tabsRef.current[0],
    []
  );

  const checkTabDirty = useCallback((tab: Tab) => {
    if (!tab.isDirty) return false;
    if (isEmptyUntitledTab(tab, editorRef.current, activeTabIdRef.current)) return false;
    return true;
  }, []);

  const getTabContent = useCallback((tab: Tab): string => {
    if (tab.id === activeTabIdRef.current && editorRef.current) {
      return editorRef.current.getHTML();
    }
    return contentMapRef.current.get(tab.id) ?? tab.content;
  }, []);

  const sessionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedSetTabsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quotaToastShownRef = useRef(false);

  const flushDebouncedTabs = useCallback(() => {
    if (debouncedSetTabsTimer.current) {
      clearTimeout(debouncedSetTabsTimer.current);
      debouncedSetTabsTimer.current = null;
      const currentEditor = editorRef.current;
      const currentTabId = activeTabIdRef.current;
      if (currentEditor && currentTabId) {
        const safeTitle = titleFromEditor(currentEditor);
        const latestContent = contentMapRef.current.get(currentTabId) ?? currentEditor.getHTML();
        const next = tabsRef.current.map(t => {
          if (t.id === currentTabId) {
            const isActuallyDirty = !(!t.path && currentEditor.isEmpty);
            const titleToUse = t.path ? titleFromPath(t.path, safeTitle) : safeTitle;
            return { ...t, content: latestContent, isDirty: isActuallyDirty, title: titleToUse };
          }
          return t;
        });
        tabsRef.current = next;
        setTabs(next);
      }
    }
  }, []);

  useEffect(() => () => {
    if (debouncedSetTabsTimer.current) {
      clearTimeout(debouncedSetTabsTimer.current);
    }
  }, []);

  const switchTab = useCallback((newId: string) => {
    if (newId === activeTabIdRef.current) return;
    if (titleRafRef.current !== null) {
      cancelAnimationFrame(titleRafRef.current);
      titleRafRef.current = null;
    }
    if (minimapTimerRef.current !== null) {
      clearTimeout(minimapTimerRef.current);
      minimapTimerRef.current = null;
    }
    flushDebouncedTabs();
    activeTabIdRef.current = newId;
    setActiveTabId(newId);
    setMinimapContent(contentMapRef.current.get(newId) ?? '');
  }, [flushDebouncedTabs]);

  const flushSessionSave = useCallback(() => {
    flushDebouncedTabs();
    if (sessionTimer.current) {
      clearTimeout(sessionTimer.current);
      sessionTimer.current = null;
    }
    try {
      const currentTabs = tabsRef.current;
      const payload = {
        tabs: currentTabs.map(t => ({
          id: t.id,
          title: t.title,
          path: t.path,
          isPinned: t.isPinned,
          isDirty: !!t.isDirty,
          content: (t.path && !t.isDirty) ? '' : getTabContent(t),
        })),
        activeTabIndex: Math.max(0, currentTabs.findIndex(t => t.id === activeTabIdRef.current)),
      };
      localStorage.setItem('noting_session', JSON.stringify(payload));
      localStorage.setItem('noting_active_tab_id', activeTabIdRef.current);
      quotaToastShownRef.current = false;
    } catch (e: any) {
      if (e?.name === 'QuotaExceededError' && !quotaToastShownRef.current) {
        quotaToastShownRef.current = true;
        showToast('Session buffer full — save your files.', 'error');
      }
      console.error('Failed to flush session to localStorage', e);
    }
  }, [getTabContent, flushDebouncedTabs, showToast]);

  useEffect(() => {
    if (sessionTimer.current) clearTimeout(sessionTimer.current);
    sessionTimer.current = setTimeout(flushSessionSave, 800);
    return () => {
      if (sessionTimer.current) clearTimeout(sessionTimer.current);
    };
  }, [tabs, flushSessionSave]);

  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;
    appWindow.onFocusChanged(({ payload: focused }) => {
      if (focused) return;

      // 1. Session buffer flush FIRST (crash-safe)
      flushSessionSave();

      // 2. Auto-save ALL dirty path-tabs to disk
      const dirtyPathTabs = tabsRef.current.filter(t => t.isDirty && t.path);
      if (dirtyPathTabs.length === 0) return;

      const writes = dirtyPathTabs.map(tab => {
        const html = getTabContent(tab);
        const payload = isTxtFile(tab.path) ? htmlToText(html) : getMarkdown(html);
        return writeTextFile(tab.path!, payload)
          .then(() => ({ tab, writtenHtml: html, ok: true as const }))
          .catch(err => ({ tab, writtenHtml: html, ok: false as const, err }));
      });

      Promise.allSettled(writes).then(results => {
        const successes = results
          .filter(r => r.status === 'fulfilled' && r.value.ok)
          .map(r => (r as PromiseFulfilledResult<{ tab: Tab; writtenHtml: string; ok: true }>).value);
        if (successes.length > 0) {
          const next = tabsRef.current.map(t => {
            const match = successes.find(s => s.tab.id === t.id);
            if (match && getTabContent(t) === match.writtenHtml) {
              return { ...t, isDirty: false };
            }
            return t;
          });
          tabsRef.current = next;
          setTabs(next);
        }
      });
    }).then(fn => {
      if (cancelled) {
        fn();
        return;
      }
      unlistenFn = fn;
    });

    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, [appWindow, flushSessionSave, getTabContent]);

  const tabsWrapperRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkTabScroll = useCallback(() => {
    const elem = tabsWrapperRef.current;
    if (!elem) return;
    const hasOverflow = elem.scrollWidth > elem.clientWidth + 2;
    setCanScrollLeft(hasOverflow && elem.scrollLeft > 2);
    setCanScrollRight(hasOverflow && elem.scrollLeft + elem.clientWidth < elem.scrollWidth - 2);
  }, []);

  useEffect(() => {
    checkTabScroll();
    window.addEventListener('resize', checkTabScroll);
    return () => window.removeEventListener('resize', checkTabScroll);
  }, [tabs]);
  const [words, setWords] = useState(0);
  const [chars, setChars] = useState(0);
  const [selectedWords, setSelectedWords] = useState(0); // For the selection count
  const [replaceTerm, setReplaceTerm] = useState('');
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const recentFilesRef = useRef<string[]>(recentFiles);
  useEffect(() => { recentFilesRef.current = recentFiles; }, [recentFiles]);
  const [showRecentModal, setShowRecentModal] = useState(false);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [tabToClose, setTabToClose] = useState<string | null>(null);
  const [showQuitPrompt, setShowQuitPrompt] = useState(false);
  const [wordWrap, setWordWrap] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('noting_word_wrap');
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('noting_word_wrap', JSON.stringify(wordWrap));
    } catch (e) {
      console.error('Failed to save word-wrap preference', e);
    }
  }, [wordWrap]);

  useEffect(() => {
    const handleScroll = () => {
      setContextMenu(null);
      setTabContextMenu(null);
    };
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, []);

  const [showSearch, setShowSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [zoomLevel, setZoomLevel] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('noting_zoom_level');
      if (saved !== null) {
        const n = Number(JSON.parse(saved));
        return Number.isFinite(n) ? Math.max(20, Math.min(300, n)) : 100;
      }
      return 100;
    } catch {
      return 100;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('noting_zoom_level', JSON.stringify(zoomLevel));
    } catch (e) {
      console.error('Failed to save zoom level', e);
    }
  }, [zoomLevel]);
  const [showGoToLine, setShowGoToLine] = useState(false);
  const [lineNumber, setLineNumber] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuPos | null>(null);
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuPos | null>(null);
  const [activeFormats, setActiveFormats] = useState({ bold: false, italic: false });
  const [showMinimap, setShowMinimap] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('noting_show_minimap');
      return saved !== null ? JSON.parse(saved) : false;
    } catch {
      try { localStorage.removeItem('noting_show_minimap'); } catch {}
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('noting_show_minimap', JSON.stringify(showMinimap));
    } catch (e) {
      console.error('Failed to save minimap preference to localStorage', e);
    }
  }, [showMinimap]);
  const minimapContentRef = useRef<HTMLDivElement>(null);
  const minimapViewportRef = useRef<HTMLDivElement>(null);
  // 1. THE FLOW STATE VARIABLES
  const [isAnimating, setIsAnimating] = useState(false);

  // Refs directly attach to the dots so we can move them at 60fps without lagging React
  const dot1Ref = useRef<HTMLSpanElement>(null);
  const dot2Ref = useRef<HTMLSpanElement>(null);
  const dot3Ref = useRef<HTMLSpanElement>(null);
  const animState = useRef({ mode: 0, prevMode: 0, transitionStart: 0 });

  const isAnimRunningRef = useRef(false);
  const startAnimLoopRef = useRef<() => void>(() => {});

  // 2. THE AUTO-DJ (Randomly cycles animations when turned on without forcing React re-renders)
  useEffect(() => {
    if (!isAnimating) {
      animState.current.prevMode = animState.current.mode;
      animState.current.mode = 0;
      animState.current.transitionStart = performance.now() / 1000;
      return;
    }
    let timeoutId: ReturnType<typeof setTimeout>;
    const triggerNextAnimation = () => {
      const prev = animState.current.mode;
      let next = Math.floor(Math.random() * 6) + 1;
      if (next === prev) {
        next = (prev % 6) + 1;
      }
      animState.current.prevMode = prev;
      animState.current.mode = next;
      animState.current.transitionStart = performance.now() / 1000;
      startAnimLoopRef.current();

      timeoutId = setTimeout(triggerNextAnimation, Math.random() * 2000 + 3000);
    };
    triggerNextAnimation();
    return () => clearTimeout(timeoutId);
  }, [isAnimating]);

  useEffect(() => {
    // animState.current is the source of truth for the current mode.
    // The auto-DJ effect owns writes to prevMode/mode/transitionStart directly in the ref
    // to prevent continuous full-app re-renders during animations.
    // This loop only reads animState.current.
    if (!isAnimating) {
      const resting = [
        { x: 0, y: -4, c: [82, 82, 91] },
        { x: -5, y: 4, c: [82, 82, 91] },
        { x: 5, y: 4, c: [82, 82, 91] }
      ];
      const dots = [dot1Ref.current, dot2Ref.current, dot3Ref.current];
      dots.forEach((dot, i) => {
        if (!dot) return;
        dot.style.transform = `translate3d(${resting[i].x}px, ${resting[i].y}px, 0)`;
        dot.style.backgroundColor = `rgb(${resting[i].c[0]},${resting[i].c[1]},${resting[i].c[2]})`;
      });
      isAnimRunningRef.current = false;
      return;
    }

    let reqId: number | null = null;
    const lastStyles = [
      { transform: '', bg: '' },
      { transform: '', bg: '' },
      { transform: '', bg: '' }
    ];

    const render = (time: number) => {
      const t = time / 1000;
      const { mode, prevMode, transitionStart } = animState.current;

      // Creates a seamless 1.5-second glide between the old animation path and the new one
      let progress = (t - transitionStart) / 1.5; 
      if (progress > 1) progress = 1;
      
      // Smooth cubic easing
      const ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      // The mathematical paths for all 5 modes
      const getPos = (m: number, timeT: number) => {
        const offsets = [0, -0.6, -1.2]; // Staggers the dots
        switch(m) {
          case 1: // Wave
            return [0, 1, 2].map(i => ({
              x: (i - 1) * 7, y: Math.sin(timeT * 5 + offsets[i] * 2) * 6, c: [160, 160, 171]
            }));
          case 2: // Orbit Triangle
            return [0, 1, 2].map(i => {
              const angle = timeT * 3 + (i * Math.PI * 2 / 3);
              return { x: Math.cos(angle) * 5, y: Math.sin(angle) * 5, c: [209, 209, 214] };
            });
          case 3: // Infinity Loop
            return [0, 1, 2].map(i => {
              const angle = timeT * 3 + offsets[i] * 1.5;
              return { x: Math.cos(angle) * 10, y: Math.sin(angle * 2) * 5, c: [255, 255, 255] };
            });
          case 4: // Tight Vortex
            return [0, 1, 2].map(i => {
              const angle = timeT * 5 + offsets[i] * 2;
              return { x: Math.cos(angle) * 4, y: Math.sin(angle) * 4, c: [255, 255, 255] };
            });
          case 5:
            return [0, 1, 2].map(i => {
              // Smooth breathing multiplier from 0 to 1
              const breathe = (Math.sin(timeT * 3) + 1) / 2;
              // Radius expands from 2px out to 7px
              const radius = 2 + (breathe * 5);
              // Slow, constant rotation
              const angle = (i * Math.PI * 2) / 3 + (timeT * 1.5);
              
              return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, c: [255, 255, 255] };
            });

            case 6: 
            return [0, 1, 2].map(i => {
              // 1. Space the 3 dots exactly 120 degrees apart on the timeline
              const t = (timeT * 2.2) + (i * Math.PI * 2) / 3;
              
              // 2. Drive them along a mathematically perfect Figure-8 path
              const x = Math.cos(t) * 7;
              const y = Math.sin(t * 2) * 3.5; 
              
              return { x, y, c: [255, 255, 255] };
            });
          // ----------------------------------

          default: // 0 = Resting Triangle
            return [
              { x: 0, y: -4, c: [82, 82, 91] }, { x: -5, y: 4, c: [82, 82, 91] }, { x: 5, y: 4, c: [82, 82, 91] }
            ];
        }
      };

      // If transition complete (progress >= 1), skip calculating prevPos
      const currPos = getPos(mode, t);
      const prevPos = progress >= 1 ? currPos : getPos(prevMode, t);
      const dots = [dot1Ref.current, dot2Ref.current, dot3Ref.current];

      dots.forEach((dot, i) => {
        if (!dot) return;
        let x: number, y: number, r: number, g: number, b: number;
        if (progress >= 1) {
          x = currPos[i].x;
          y = currPos[i].y;
          r = currPos[i].c[0];
          g = currPos[i].c[1];
          b = currPos[i].c[2];
        } else {
          x = prevPos[i].x + (currPos[i].x - prevPos[i].x) * ease;
          y = prevPos[i].y + (currPos[i].y - prevPos[i].y) * ease;
          r = Math.round(prevPos[i].c[0] + (currPos[i].c[0] - prevPos[i].c[0]) * ease);
          g = Math.round(prevPos[i].c[1] + (currPos[i].c[1] - prevPos[i].c[1]) * ease);
          b = Math.round(prevPos[i].c[2] + (currPos[i].c[2] - prevPos[i].c[2]) * ease);
        }

        const transform = `translate3d(${x}px, ${y}px, 0)`;
        const bg = `rgb(${r},${g},${b})`;

        if (lastStyles[i].transform !== transform) {
          dot.style.transform = transform;
          lastStyles[i].transform = transform;
        }
        if (lastStyles[i].bg !== bg) {
          dot.style.backgroundColor = bg;
          lastStyles[i].bg = bg;
        }
      });

      // Pause loop only when resting at mode 0 and transition is fully complete
      if (mode === 0 && progress >= 1) {
        animState.current.prevMode = 0;
        isAnimRunningRef.current = false;
        reqId = null;
        return;
      }

      reqId = requestAnimationFrame(render);
    };

    startAnimLoopRef.current = () => {
      if (!isAnimRunningRef.current) {
        isAnimRunningRef.current = true;
        reqId = requestAnimationFrame(render);
      }
    };

    isAnimRunningRef.current = true;
    reqId = requestAnimationFrame(render);

    return () => {
      if (reqId !== null) cancelAnimationFrame(reqId);
      isAnimRunningRef.current = false;
    };
  }, [isAnimating]);

  const isProgrammaticChangeRef = useRef(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const findBoxRef = useRef<HTMLDivElement>(null);

  // 2. THE STRICT-MODE SAFE INTERCEPTOR
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    appWindow.onCloseRequested((event) => {
      flushSessionSave(); // flush first, unconditionally
      if (isForceClosingRef.current) return;

      if (tabsRef.current.some(checkTabDirty)) {
        event.preventDefault(); // Stop the native OS close
        
        // Pull to front safely
        appWindow.unminimize().catch(() => {});
        appWindow.show().catch(() => {});
        appWindow.setFocus().catch(() => {});
        
        setShowQuitPrompt(true); 
      }
    }).then(fn => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [flushSessionSave, appWindow, checkTabDirty]);

  /* --- FEATURE: SESSION RESTORE & RECENT FILES ON BOOT --- */
  useEffect(() => {
    let cancelled = false;
    const bootSession = async () => {
      // Load recent files
      const savedRecents = localStorage.getItem('noting_recents');
      if (savedRecents) {
        try {
          const parsed = JSON.parse(savedRecents);
          if (Array.isArray(parsed)) {
            recentFilesRef.current = parsed;
            setRecentFiles(parsed);
          }
        } catch (e) {
          try { localStorage.removeItem('noting_recents'); } catch {}
        }
      }

      const savedActiveId = localStorage.getItem('noting_active_tab_id');
      const savedSession = localStorage.getItem('noting_session');

      if (savedSession) {
        try {
          const parsedSession = JSON.parse(savedSession);
          const sessionList = Array.isArray(parsedSession) ? parsedSession : (parsedSession?.tabs ?? []);
          if (sessionList.length > 0) {
            const restoredTabs: Tab[] = [];
            for (const item of sessionList) {
              const tabId = (item.id && typeof item.id === 'string') ? item.id : createTabId();
              if (item.path) {
                if (item.isDirty && item.content) {
                  // User's unsaved edits — do NOT read from disk
                  restoredTabs.push({
                    id: tabId,
                    title: item.title || 'Untitled',
                    content: DOMPurify.sanitize(item.content, PURIFY_CONFIG),
                    path: item.path,
                    isDirty: true,
                    isPinned: item.isPinned,
                  });
                } else {
                  try {
                    const rawText = await readTextFile(item.path);
                    const content = isTxtFile(item.path)
                      ? textToHtml(rawText)
                      : await parseFileContent(rawText);
                    restoredTabs.push({
                      id: tabId,
                      title: item.title,
                      content,
                      path: item.path,
                      isDirty: false,
                      isPinned: item.isPinned,
                    });
                  } catch (e) {
                    // File gone. If we have saved dirty content, preserve it.
                    if (item.content) {
                      restoredTabs.push({
                        id: tabId,
                        title: item.title || 'Untitled',
                        content: DOMPurify.sanitize(item.content, PURIFY_CONFIG),
                        path: item.path,
                        isDirty: true,
                        isPinned: item.isPinned,
                      });
                    }
                  }
                }
              } else if (item.isPinned || item.content) {
                restoredTabs.push({
                  id: tabId,
                  title: item.title || 'Untitled',
                  content: item.content ? DOMPurify.sanitize(item.content, PURIFY_CONFIG) : '',
                  isDirty: !!item.isDirty,
                  isPinned: item.isPinned,
                });
              }
            }
            if (cancelled) return;
            if (restoredTabs.length > 0) {
              restoredTabs.sort((a, b) => (a.isPinned === b.isPinned) ? 0 : a.isPinned ? -1 : 1);
              tabsRef.current = restoredTabs;
              setTabs(restoredTabs);
              const savedActiveIndex = Array.isArray(parsedSession) ? 0 : (parsedSession?.activeTabIndex ?? 0);
              const targetActiveId = restoredTabs.find(t => t.id === savedActiveId)?.id
                ?? restoredTabs[Math.min(savedActiveIndex, restoredTabs.length - 1)].id;
              activeTabIdRef.current = targetActiveId;
              setActiveTabId(targetActiveId);
              const activeRestoredTab = restoredTabs.find(t => t.id === targetActiveId) ?? restoredTabs[0];
              setMinimapContent(activeRestoredTab.content);
            }
          }
        } catch (e) {
          try { localStorage.removeItem('noting_session'); } catch {}
          console.error('Failed to parse session state', e);
        }
      }
    };
    bootSession();
    return () => { cancelled = true; };
  }, []);

  const forceCloseApp = useCallback(() => {
    flushSessionSave(); // belt: onCloseRequested's flush is suspenders.
    // Redundancy is intentional — forceCloseApp covers paths where
    // onCloseRequested is bypassed; onCloseRequested covers OS close-button
    // paths where forceCloseApp isn't the entry point.
    isForceClosingRef.current = true;
    appWindow.close();
  }, [flushSessionSave, appWindow]);

  const caretFrameRef = useRef<number | null>(null);

  const keepCaretAwayFromRightEdgeNow = () => {
    const editorElem = document.querySelector('.editor-container.no-wrap') as HTMLDivElement | null;
    if (!editorElem || !editor) return;

    try {
      const { from } = editor.state.selection;
      const caretRect = editor.view.coordsAtPos(from);
      const editorRect = editorElem.getBoundingClientRect();
      
      const editorContentRight = editorRect.left + editorElem.clientWidth;
      const maxCaretRight = editorContentRight - 20; 
      
      // Push the scrollbar right ONLY if the map is actively covering the visible cursor
      if (caretRect.right > maxCaretRight) {
        editorElem.scrollLeft += (caretRect.right - maxCaretRight);
      }
    } catch (e) {
      // Ignore safely if the editor is still booting up
    }
  };
  const keepCaretAwayFromRightEdge = () => {
    if (caretFrameRef.current !== null) cancelAnimationFrame(caretFrameRef.current);
    caretFrameRef.current = requestAnimationFrame(() => {
      caretFrameRef.current = null;
      keepCaretAwayFromRightEdgeNow();
    });
  };

  // 3. THE EDITOR DEFINITION
  const editor = useEditor({
    extensions: [
      AutoExponent,
      MathSpacing,
      MathEngine,
      StarterKit.configure({
        italic: false,
        link: {
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { rel: 'noopener noreferrer' },
        },
      }),
      CustomItalic,
      Placeholder.configure({ placeholder: 'Start writing...' }), 
      CharacterCount,
      SearchAndReplace.configure({ searchResultClass: 'search-match' })
    ],

    content: activeTab.content,
    editorProps: {
      attributes: { class: 'notepad', spellcheck: 'false' },
      handleClick: (_view, _pos, event) => {
        const a = (event.target as HTMLElement).closest('a[href]');
        if (!a) return false;
        event.preventDefault();
        const href = a.getAttribute('href');
        if (href?.startsWith('https://') || href?.startsWith('http://') || href?.startsWith('mailto:')) {
          import('@tauri-apps/plugin-opener').then(m => m.openUrl(href).catch(() => {}));
        }
        return true;
      },
    },
    onCreate({ editor }) {
      updatePlaceholderVisibility(editor);
    },
    onTransaction({ editor, transaction }) {
      if (transaction.docChanged) {
        updatePlaceholderVisibility(editor);
      }

      setActiveFormats(prev => {
        const isBold = editor.isActive('bold');
        const isItalic = editor.isActive('italic');
        // This prevents the app from lagging by only updating if a change ACTUALLY happened
        if (prev.bold === isBold && prev.italic === isItalic) return prev; 
        return { bold: isBold, italic: isItalic };
      });
    },
    onUpdate({ editor, transaction }) {
      const newContent = editor.getHTML();
      const currentTabId = activeTabIdRef.current;
      contentMapRef.current.set(currentTabId, newContent);
      setWords(editor.storage.characterCount.words());
      setChars(editor.storage.characterCount.characters());

      // Minimap throttle (100ms leading-schedule)
      if (minimapTimerRef.current === null) {
        minimapTimerRef.current = setTimeout(() => {
          minimapTimerRef.current = null;
          if (activeTabIdRef.current === currentTabId) {
            setMinimapContent(contentMapRef.current.get(currentTabId) ?? newContent);
          }
        }, 100);
      }

      // Real-time title rAF (unattached untitled tabs only)
      if (titleRafRef.current !== null) cancelAnimationFrame(titleRafRef.current);
      titleRafRef.current = requestAnimationFrame(() => {
        titleRafRef.current = null;
        if (activeTabIdRef.current !== currentTabId) return;
        const cur = tabsRef.current.find(t => t.id === currentTabId);
        if (!cur || cur.path) return;
        const newTitle = titleFromEditor(editor);
        if (cur.title !== newTitle) {
          const next = tabsRef.current.map(t => t.id === currentTabId ? { ...t, title: newTitle } : t);
          tabsRef.current = next;
          setTabs(next);
        }
      });
      
      if (transaction.docChanged && editor.isFocused) {
        if (isProgrammaticChangeRef.current) return;

        keepCaretAwayFromRightEdge();

        if (debouncedSetTabsTimer.current) {
          clearTimeout(debouncedSetTabsTimer.current);
        }

        debouncedSetTabsTimer.current = setTimeout(() => {
          debouncedSetTabsTimer.current = null;
          if (activeTabIdRef.current !== currentTabId) return;
          const currentEditor = editorRef.current;
          if (!currentEditor) return;
          const safeTitle = titleFromEditor(currentEditor);
          const latestContent = contentMapRef.current.get(currentTabId) ?? newContent;

          const next = tabsRef.current.map(t => {
            if (t.id === currentTabId) {
              const isActuallyDirty = !(!t.path && currentEditor.isEmpty);
              const titleToUse = t.path 
                ? titleFromPath(t.path, safeTitle)
                : safeTitle;
              return { ...t, content: latestContent, isDirty: isActuallyDirty, title: titleToUse };
            }
            return t;
          });
          tabsRef.current = next;
          setTabs(next);
        }, 250);
      }
    },
    // This tracks the cursor position!
    onSelectionUpdate({ editor }) {
      const { $head, from, to } = editor.state.selection;

      // Line = top-level block index. O(1). A list counts as one block.
      // Top-level block counting matches Go To Line block semantics and avoids
      // an O(n) document walk per keystroke.
      const line = $head.index(0) + 1;
      const col = $head.parentOffset + 1;

      setCursorPos(prev => (prev.line === line && prev.col === col ? prev : { line, col }));

      // Selection word count logic
      if (from !== to) {
        const text = editor.state.doc.textBetween(from, to, ' ');
        const count = text.trim().split(/\s+/).filter(w => w.length > 0).length;
        setSelectedWords(count);
      } else {
        setSelectedWords(0);
      }

      keepCaretAwayFromRightEdge();
    }
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (showSearch) {
      setTimeout(() => searchInputRef.current?.focus(), 10);
    }
  }, [showSearch]);

  useEffect(() => {
    if (editor && activeTab) {
      if (editor.getHTML() !== activeTab.content) {
        isProgrammaticChangeRef.current = true;
        editor.commands.setContent(activeTab.content);
        isProgrammaticChangeRef.current = false;
      }
      
      // NEW: Instantly grab keyboard focus whenever the tab changes!
      editor.commands.focus(); 
    }
  }, [activeTabId, editor]);

  useEffect(() => {
    document.querySelector('.tab.active')?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    checkTabScroll();
  }, [activeTabId]);


  useEffect(() => {
    const editorElem = document.querySelector('.editor-container') as HTMLDivElement | null;
    if (!editorElem) return;

    // 1. THE SNAPSHOT: Right before the map opens, are you actively looking at your cursor?
    let caretWasVisible = false;
    if (showMinimap && editorElem.classList.contains('no-wrap') && editor) {
       try {
          const { from } = editor.state.selection;
          const caretRect = editor.view.coordsAtPos(from);
          const editorRect = editorElem.getBoundingClientRect();
          
          // If the cursor is physically inside the screen bounds, you are actively looking at it
          if (caretRect.right <= editorRect.right && caretRect.left >= editorRect.left) {
            caretWasVisible = true;
          }
       } catch(e) {}
    }

    // THE MAGIC FIX: ResizeObserver passively watches the container.
    const resizeObserver = new ResizeObserver(() => {
      // 1. Update the minimap math
      handleEditorScroll();
      
      // 2. THE SNOWPLOW: Only push the scrollbar if you were actively looking at the cursor!
      // If you were scrolled away reading the left side, leave the scrollbar in peace!
      if (showMinimap && editorElem.classList.contains('no-wrap') && caretWasVisible) {
         keepCaretAwayFromRightEdgeNow();
      }
    });

    resizeObserver.observe(editorElem);

    return () => resizeObserver.disconnect();
  }, [showMinimap, wordWrap, zoomLevel, editor]);

  const addTab = useCallback((title = 'Untitled', content = '', path?: string) => {
    flushDebouncedTabs();
    const newId = createTabId();
    const next = [...tabsRef.current, { id: newId, title, content, path, isDirty: false }];
    tabsRef.current = next;
    setTabs(next);
    activeTabIdRef.current = newId;
    setActiveTabId(newId);
    contentMapRef.current.set(newId, content);
    setMinimapContent(content);
    setTimeout(() => {
      document.querySelector('.add-tab-container')?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
      checkTabScroll();
    }, 50);
  }, [flushDebouncedTabs, checkTabScroll]);

  /* --- TOGGLE PIN STATUS --- */
  const togglePin = useCallback((id: string) => {
    const next = tabsRef.current.map(t => t.id === id ? { ...t, isPinned: !t.isPinned } : t);
    next.sort((a, b) => (a.isPinned === b.isPinned) ? 0 : a.isPinned ? -1 : 1);
    tabsRef.current = next;
    setTabs(next);
  }, []);

  /* --- TAB DRAG (mouse-based, works in Tauri) --- */
  const handleTabMouseDown = useCallback((e: React.MouseEvent, id: string) => {
    if (e.button !== 0) return; // left button only
    // Don't start a drag if they clicked the × button
    if ((e.target as HTMLElement).classList.contains('tab-close')) return;
    e.preventDefault();
    switchTab(id);
    setDraggedTabId(id);
  }, [switchTab]);

  const handleTabMouseEnter = useCallback((id: string) => {
    if (!draggedTabId) return;
    if (id === draggedTabId) {
      setDragOverTabId(null);
    } else {
      setDragOverTabId(id);
    }
  }, [draggedTabId]);

  // Global mouseup — finalise or cancel the drag
  useEffect(() => {
    const onMouseUp = () => {
      try {
        if (draggedTabId && dragOverTabId && draggedTabId !== dragOverTabId) {
          const tabs = tabsRef.current;
          const from = tabs.findIndex(t => t.id === draggedTabId);
          const to   = tabs.findIndex(t => t.id === dragOverTabId);
          if (from === -1 || to === -1) return;
          if (tabs[from].isPinned !== tabs[to].isPinned) return;
          const next = [...tabs];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          tabsRef.current = next;
          setTabs(next);
        }
      } finally {
        setDraggedTabId(null);
        setDragOverTabId(null);
      }
    };
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, [draggedTabId, dragOverTabId]);

  /* --- 1. TAB & APP CLOSING --- */
  const executeCloseTab = useCallback((id: string) => {
    flushDebouncedTabs();
    if (tabsRef.current.length <= 1) {
      const newId = createTabId();
      activeTabIdRef.current = newId;
      setActiveTabId(newId);
      const next = [{ id: newId, title: 'Untitled', content: '', isDirty: false }];
      tabsRef.current = next;
      setTabs(next);
      setTabToClose(null);
      setMinimapContent('');
      return;
    }
    const closedIndex = tabsRef.current.findIndex(t => t.id === id);
    const nextTabs = tabsRef.current.filter(t => t.id !== id);
    if (activeTabIdRef.current === id) {
      const nextIndex = Math.min(closedIndex, nextTabs.length - 1);
      const nextActiveId = nextTabs[Math.max(0, nextIndex)].id;
      activeTabIdRef.current = nextActiveId;
      setActiveTabId(nextActiveId);
      setMinimapContent(contentMapRef.current.get(nextActiveId) ?? '');
    }
    tabsRef.current = nextTabs;
    setTabs(nextTabs);
    setTabToClose(null); 
  }, [flushDebouncedTabs]);

  const requestCloseTab = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    flushDebouncedTabs();
    const tab = tabsRef.current.find(t => t.id === id);
    if (tab && checkTabDirty(tab)) {
      setTabToClose(id);
    } else {
      executeCloseTab(id);
    }
  }, [executeCloseTab, checkTabDirty, flushDebouncedTabs]);

  const requestAppClose = useCallback(() => {
    flushDebouncedTabs();
    if (tabsRef.current.some(checkTabDirty)) {
      setShowQuitPrompt(true);
    } else {
      forceCloseApp();
    }
  }, [checkTabDirty, forceCloseApp, flushDebouncedTabs]);

  const addToRecentFiles = useCallback((path: string) => {
    const updated = [path, ...recentFilesRef.current.filter(p => p !== path)].slice(0, 10);
    recentFilesRef.current = updated;
    setRecentFiles(updated);
    try {
      localStorage.setItem('noting_recents', JSON.stringify(updated));
    } catch (e) {
      console.error('Failed to save recents to localStorage', e);
    }
  }, []);

  const openFileInTab = useCallback(async (path: string): Promise<boolean> => {
    const existingTab = tabsRef.current.find(t => t.path === path);
    if (existingTab) {
      switchTab(existingTab.id);
      addToRecentFiles(path);
      return true;
    }

    try {
      const rawText = await readTextFile(path);
      const htmlContent = isTxtFile(path) ? textToHtml(rawText) : await parseFileContent(rawText);
      const fileName = titleFromPath(path);

      if (isBlankUnsavedTab(getActiveTab(), editorRef.current, activeTabIdRef.current)) {
        const currentActiveId = activeTabIdRef.current;
        const next = tabsRef.current.map(t =>
          t.id === currentActiveId
            ? { ...t, title: fileName, content: htmlContent, path, isDirty: false }
            : t
        );
        tabsRef.current = next;
        setTabs(next);
        contentMapRef.current.set(currentActiveId, htmlContent);
        isProgrammaticChangeRef.current = true;
        editorRef.current?.commands.setContent(htmlContent);
        isProgrammaticChangeRef.current = false;
        setMinimapContent(htmlContent);
      } else {
        addTab(fileName, htmlContent, path);
      }

      addToRecentFiles(path);
      return true;
    } catch (e) {
      console.error('Could not open file:', e);
      showToast("Could not open file. It may have been moved, deleted, or permission was denied.", "error");
      const updated = recentFilesRef.current.filter(p => p !== path);
      recentFilesRef.current = updated;
      setRecentFiles(updated);
      try { localStorage.setItem('noting_recents', JSON.stringify(updated)); } catch {}
      return false;
    }
  }, [addTab, addToRecentFiles, getActiveTab, showToast, switchTab]);

  const handleOpen = useCallback(async () => {
    try {
      const selected = await open({ 
        multiple: false, 
        filters: [{ name: 'Text', extensions: ['txt', 'md'] }] 
      });
      if (selected && typeof selected === 'string') {
        await openFileInTab(selected);
      }
    } catch (e) {
      console.error('Error opening file dialog:', e);
      showToast('Could not open file.', 'error');
    }
  }, [openFileInTab, showToast]);

  const handleSaveFromModal = useCallback(async () => {
    flushDebouncedTabs();
    if (!editorRef.current || !tabToClose) return;
    const tab = tabsRef.current.find(t => t.id === tabToClose);
    if (!tab) return;
    const suggestedName = suggestedFileName(tab.title);
    try {
      const path = tab.path || await save({
        defaultPath: suggestedName,
        filters: [{ name: 'Text Files', extensions: ['txt', 'md'] }],
      });
      if (path) {
        const htmlToSave = getTabContent(tab);
        const payload = isTxtFile(path) ? htmlToText(htmlToSave) : getMarkdown(htmlToSave);
        await writeTextFile(path, payload);
        executeCloseTab(tabToClose);
        addToRecentFiles(path);
      } else {
        setTabToClose(null);
      }
    } catch (e) {
      console.error('Save from modal failed:', e);
      showToast('Failed to save file.', 'error');
      setTabToClose(null);
    }
  }, [tabToClose, executeCloseTab, addToRecentFiles, showToast, flushDebouncedTabs, getTabContent]);

  const handleSave = useCallback(async () => {
    flushDebouncedTabs();
    if (!editorRef.current) return;
    const currentTab = getActiveTab();
    const suggestedName = suggestedFileName(currentTab.title);
    try {
      const path = currentTab.path || await save({
        defaultPath: suggestedName,
        filters: [{ name: 'Text Files', extensions: ['txt', 'md'] }],
      });
      if (path) {
        const payload = isTxtFile(path) ? htmlToText(editorRef.current.getHTML()) : getMarkdown(editorRef.current.getHTML());
        await writeTextFile(path, payload);
        const fileName = titleFromPath(path, suggestedName);
        const currentId = activeTabIdRef.current;
        const next = tabsRef.current.map(t => t.id === currentId ? { ...t, path, title: fileName, isDirty: false } : t);
        tabsRef.current = next;
        setTabs(next);
        addToRecentFiles(path);
      }
    } catch (e) {
      console.error('Save failed:', e);
      showToast('Failed to save file.', 'error');
    }
  }, [addToRecentFiles, getActiveTab, showToast, flushDebouncedTabs]);

  const handleSaveAs = useCallback(async () => {
    flushDebouncedTabs();
    if (!editorRef.current) return;
    const currentTab = getActiveTab();
    const suggestedName = suggestedFileName(currentTab.title);
    try {
      const path = await save({
        defaultPath: suggestedName,
        filters: [{ name: 'Text Files', extensions: ['txt', 'md'] }],
      });
      if (path) {
        const payload = isTxtFile(path) ? htmlToText(editorRef.current.getHTML()) : getMarkdown(editorRef.current.getHTML());
        await writeTextFile(path, payload);
        const fileName = titleFromPath(path, suggestedName);
        const currentId = activeTabIdRef.current;
        const next = tabsRef.current.map(t => t.id === currentId ? { ...t, path, title: fileName, isDirty: false } : t);
        tabsRef.current = next;
        setTabs(next);
        addToRecentFiles(path);
      }
    } catch (e) {
      console.error('Save As failed:', e);
      showToast('Failed to save file.', 'error');
    }
  }, [addToRecentFiles, getActiveTab, showToast, flushDebouncedTabs]);

    const executeGoToLine = () => {
    const line = parseInt(lineNumber);
    if (!editor || isNaN(line) || line < 1) {
      setShowGoToLine(false);
      setLineNumber('');
      return;
    }
    const target = line - 1;

    let targetPos: number | null = null;
    editor.state.doc.forEach((_node, offset, index) => {
      if (index === target && targetPos === null) targetPos = offset;
    });

    if (targetPos !== null) {
      // doc.forEach walks top-level blocks. Find a text position *inside* the block.
      // For a container like bulletList, offset+1 is the container boundary (an invalid
      // textSelection endpoint that throws RangeError). findFrom walks forward into
      // the first listItem > paragraph; Selection.near($pos) is the fallback.
      const $pos = editor.state.doc.resolve(targetPos);
      const sel = Selection.findFrom($pos, 1, true) || Selection.near($pos);
      if (sel) {
        editor.view.dispatch(editor.state.tr.setSelection(sel).scrollIntoView());
      }
    }

    setShowGoToLine(false);
    setLineNumber('');
  };

  const scrollToCurrentMatch = useCallback(() => {
    // A tiny delay gives Tiptap time to apply the CSS class before we look for it
    setTimeout(() => {
      const activeMatch = document.querySelector('.search-match-current');
      if (activeMatch) {
        activeMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 10);
  }, []);

  /* --- 1. KEYBOARD & MOUSE SHORTCUTS --- */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const keyLower = e.key.toLowerCase();
      if (e.ctrlKey && keyLower === 's' && !e.shiftKey) {
        e.preventDefault();
        handleSave();
      } else if (e.ctrlKey && keyLower === 's' && e.shiftKey) {
        e.preventDefault();
        handleSaveAs();
      } else if (e.ctrlKey && keyLower === 'o') {
        e.preventDefault();
        handleOpen();
      } else if (e.ctrlKey && keyLower === 'n') {
        e.preventDefault();
        addTab();
      } else if (e.ctrlKey && keyLower === 't') {
        e.preventDefault();
        addTab();
      } else if (e.ctrlKey && keyLower === 'w') {
        e.preventDefault();
        requestCloseTab({ stopPropagation: () => {} } as any, activeTabIdRef.current);
      } else if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        const currentTabs = tabsRef.current;
        const currentActiveId = activeTabIdRef.current;
        const currentIndex = currentTabs.findIndex(t => t.id === currentActiveId);
        const nextIndex = e.shiftKey
          ? (currentIndex - 1 + currentTabs.length) % currentTabs.length
          : (currentIndex + 1) % currentTabs.length;
        switchTab(currentTabs[nextIndex].id);
      } else if (e.ctrlKey && keyLower === 'f') {
        e.preventDefault(); 
        setShowSearch(true);
        editor?.chain().setSearchTerm(searchTerm).run();
      } else if (e.ctrlKey && keyLower === 'g') {
        e.preventDefault();
        setShowGoToLine(true);
      } else if (e.ctrlKey && keyLower === 'm') {
        e.preventDefault();
        setShowMinimap((prev: boolean) => !prev);
      } else if (e.ctrlKey && keyLower === 'p') {
        e.preventDefault();
        window.print();
      } else if (e.key === 'F3' || e.code === 'F3') {
        e.preventDefault();
        if (!showSearch) {
          setShowSearch(true);
          editor?.chain().setSearchTerm(searchTerm).run();
        } else {
          if (e.shiftKey) {
            editor?.chain().previousSearchResult().run();
          } else {
            editor?.chain().nextSearchResult().run();
          }
          scrollToCurrentMatch();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (draggedTabId) {
          setDraggedTabId(null);
          setDragOverTabId(null);
          return;
        }
        setShowSearch(false);
        editor?.chain().setSearchTerm('').run();
        if (editor && !editor.state.selection.empty) {
          editor.commands.setTextSelection(editor.state.selection.to);
        }
        editor?.commands.focus();
      } else if (e.key === 'F5') {
        e.preventDefault();
        const now = new Date();
        const timeDateStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + now.toLocaleDateString();
        editor?.commands.insertContent(timeDateStr);
      } else if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        setZoomLevel(z => Math.min(z + 10, 300));
      } else if (e.ctrlKey && e.key === '-') {
        e.preventDefault();
        setZoomLevel(z => Math.max(z - 10, 20));
      } else if (e.ctrlKey && e.key === '0') {
        e.preventDefault();
        setZoomLevel(100);
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        if (e.deltaY < 0) setZoomLevel(z => Math.min(z + 10, 300));
        else setZoomLevel(z => Math.max(z - 10, 20));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('wheel', handleWheel);
    };
  }, [
    editor,
    showSearch,
    searchTerm,
    draggedTabId,
    handleSave,
    handleSaveAs,
    handleOpen,
    addTab,
    requestCloseTab,
    switchTab,
    scrollToCurrentMatch,
  ]);

  /* --- 2. CONTEXT MENU LISTENER --- */
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // Prevent the text editor's context menu from popping up if we right-click the top bar
      const target = e.target as HTMLElement;
      if (target.closest('.tab-bar')) return; 

      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY });
    };

    // Close all menus when clicking anywhere
    const handleClick = () => {
      setContextMenu(null);
      setTabContextMenu(null); 
    };

    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('click', handleClick);
    return () => {
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('click', handleClick);
    };
  }, []);

  /* --- FEATURE: MINIMAP SCROLL SYNC (Real-Time & Scale-Corrected) --- */
  const handleEditorScroll = useCallback((e?: React.UIEvent<HTMLDivElement>) => {
    const editorElem = (e?.currentTarget as HTMLDivElement) || (document.querySelector('.editor-container') as HTMLDivElement);
    if (!editorElem || !minimapContentRef.current || !minimapViewportRef.current) return;

    // 1. Get the exact width of the actual text editor so we can mirror it perfectly
    const notepadElem = editorElem.querySelector('.notepad') as HTMLDivElement;
    const actualWidth = notepadElem
      ? (!wordWrap ? notepadElem.scrollWidth : notepadElem.clientWidth)
      : editorElem.clientWidth;

    const { scrollTop, scrollHeight, clientHeight } = editorElem;
    const containerHeight = editorElem.offsetHeight;
    const scrollableEditor = Math.max(0, scrollHeight - clientHeight);
    
    // Ignore tiny pixel jumps
    const hasScrollableContent = scrollableEditor > 5; 

    // 2. Dynamic Scale Engine: Calculates exactly how much to shrink the text 
    // to fit perfectly into your 60px minimap track
    const scale = actualWidth > 0 ? 60 / actualWidth : 0.1;

    // 3. Force the minimap text box to wrap EXACTLY where the main editor wraps
    minimapContentRef.current.style.width = `${actualWidth}px`;
    minimapContentRef.current.style.fontSize = `${1.0 * (zoomLevel / 100)}rem`;

    // 4. Calculate the Viewport Box size and position
    const viewportHeight = Math.max(40, Math.min(containerHeight, clientHeight * scale));
    const scrollPercent = hasScrollableContent ? scrollTop / scrollableEditor : 0;
    
    if (!hasScrollableContent && scrollTop !== 0) editorElem.scrollTop = 0;

    const viewportTop = scrollPercent * (containerHeight - viewportHeight);
    minimapViewportRef.current.style.height = `${viewportHeight}px`;
    minimapViewportRef.current.style.transform = `translateY(${viewportTop}px)`;

    // 5. Flawless Absolute Tracking Math
    // Keeps the miniature text perfectly anchored and scaled inside the moving viewport box
    const miniDocHeight = scrollHeight * scale;
    const trackHeight = containerHeight;
    let contentAbsoluteVisualTop = 0;
    
    // If the miniature document is taller than the screen, it needs to slowly scroll up
    if (miniDocHeight > trackHeight) {
      const maxMiniScroll = miniDocHeight - trackHeight;
      contentAbsoluteVisualTop = -scrollPercent * maxMiniScroll;
    }

    // Offset the content based on where the viewport box is currently sitting
    const contentVisualTopRelativeToViewport = contentAbsoluteVisualTop - viewportTop;
    
    // Divide by scale because CSS applies the translateY *before* the scale multiplier
    const translateY = contentVisualTopRelativeToViewport / scale;

    minimapContentRef.current.style.transform = `scale(${scale}) translateY(${translateY}px)`;
  }, [wordWrap, zoomLevel]);

  /* --- FEATURE: DRAGGABLE MINIMAP (No-Teleport Version) --- */
  const handleMinimapMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const editorElem = document.querySelector('.editor-container') as HTMLDivElement;
    const containerElem = minimapViewportRef.current?.parentElement;
    if (!editorElem || !containerElem || !minimapViewportRef.current) return;

    const containerRect = containerElem.getBoundingClientRect();
    const viewportRect = minimapViewportRef.current.getBoundingClientRect();
    
    // NEW: Calculate exactly where inside the box you grabbed (the offset)
    const grabOffset = e.clientY - viewportRect.top;

    const scrollableEditor = editorElem.scrollHeight - editorElem.clientHeight;
    
    // FIXED: Changed threshold to <= 5. This prevents you from dragging the box 
    // when the document is empty.
    if (scrollableEditor <= 5) {
      editorElem.scrollTop = 0;
      handleEditorScroll();
      return;
    }

    const updateScroll = (currentY: number) => {
      // Calculate where the TOP of the box should be based on mouse + grab offset
      const targetTop = (currentY - containerRect.top) - grabOffset;
      
      // Calculate available space the box can move (track height minus box height)
      const travelRange = containerRect.height - viewportRect.height;
      
      // Map that position to a 0-1 percentage
      const targetPercent = travelRange > 0 
        ? Math.max(0, Math.min(1, targetTop / travelRange)) 
        : 0;
      
      // Apply to editor
      editorElem.scrollTop = targetPercent * scrollableEditor;
    };

    if (dragRef.current) {
      window.removeEventListener('mousemove', dragRef.current.onMove);
      window.removeEventListener('mouseup', dragRef.current.onUp);
      dragRef.current = null;
    }

    if (minimapViewportRef.current) minimapViewportRef.current.classList.add('is-dragging');

    const onMouseMove = (moveEvent: MouseEvent) => updateScroll(moveEvent.clientY);
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      dragRef.current = null;
      if (minimapViewportRef.current) minimapViewportRef.current.classList.remove('is-dragging');
    };

    dragRef.current = { onMove: onMouseMove, onUp: onMouseUp };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [handleEditorScroll]);

  const handleMinimapTrackMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const editorElem = document.querySelector('.editor-container') as HTMLDivElement;
    if (!editorElem) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const clickPercent = Math.max(0, Math.min(1, clickY / rect.height));
    const scrollable = editorElem.scrollHeight - editorElem.clientHeight;
    if (scrollable > 0) {
      editorElem.scrollTop = clickPercent * scrollable;
    }
  }, []);

  // Triggers the scroll math every time you type so the highlight box dynamically resizes!
  useEffect(() => {
    handleEditorScroll();
  }, [minimapContent, zoomLevel, wordWrap, showMinimap, handleEditorScroll]);

  const handleScrollTabsLeft = useCallback(() => {
    tabsWrapperRef.current?.scrollBy({ left: -180, behavior: 'smooth' });
    setTimeout(checkTabScroll, 200);
  }, [checkTabScroll]);

  const handleScrollTabsRight = useCallback(() => {
    tabsWrapperRef.current?.scrollBy({ left: 180, behavior: 'smooth' });
    setTimeout(checkTabScroll, 200);
  }, [checkTabScroll]);

  const handleTabContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setTabContextMenu({ x: e.clientX, y: e.clientY, tabId });
  }, []);

  const handleTabMouseLeave = useCallback(() => {
    if (draggedTabId) setDragOverTabId(null);
  }, [draggedTabId]);

  const handleReplaceCurrent = useCallback(() => {
    const storage = (editorRef.current?.storage as any)?.searchAndReplace;
    const match = storage?.results?.[storage?.resultIndex];
    if (match && editorRef.current) {
      editorRef.current.chain().focus().insertContentAt({ from: match.from, to: match.to }, { type: 'text', text: replaceTerm }).run();
      editorRef.current.chain().setSearchTerm(searchTerm).run();
      scrollToCurrentMatch();
    }
  }, [searchTerm, replaceTerm, scrollToCurrentMatch]);

  const handleReplaceAll = useCallback(() => {
    if (editorRef.current) {
      editorRef.current.chain().focus().replaceAll().run();
      editorRef.current.chain().setSearchTerm(searchTerm).run();
      scrollToCurrentMatch();
    }
  }, [searchTerm, scrollToCurrentMatch]);

  const handleAddTab = useCallback(() => {
    addTab();
  }, [addTab]);

  const handleMinimize = useCallback(() => {
    appWindow.minimize();
  }, [appWindow]);

  const handleMaximize = useCallback(() => {
    appWindow.toggleMaximize();
  }, [appWindow]);

  const handleShowRecent = useCallback(() => {
    setShowRecentModal(true);
  }, []);

  const handleExportPdf = useCallback(() => {
    window.print();
  }, []);

  const handleToggleWordWrap = useCallback(() => {
    setWordWrap(prev => !prev);
  }, []);

  const handleToggleMinimap = useCallback(() => {
    setShowMinimap(prev => !prev);
  }, []);

  const handleToggleBold = useCallback(() => {
    editor?.chain().focus().toggleBold().run();
  }, [editor]);

  const handleToggleItalic = useCallback(() => {
    editor?.chain().focus().toggleItalic().run();
  }, [editor]);

  const handleToggleAnimation = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsAnimating(prev => !prev);
  }, []);

  const handleSearchChange = useCallback((val: string) => {
    setSearchTerm(val);
    editor?.chain().setSearchTerm(val).run();
    scrollToCurrentMatch();
  }, [editor, scrollToCurrentMatch]);

  const handleReplaceChange = useCallback((val: string) => {
    setReplaceTerm(val);
    editor?.chain().setReplaceTerm(val).run();
  }, [editor]);

  const handlePreviousMatch = useCallback(() => {
    editor?.chain().previousSearchResult().run();
    scrollToCurrentMatch();
  }, [editor, scrollToCurrentMatch]);

  const handleNextMatch = useCallback(() => {
    editor?.chain().nextSearchResult().run();
    scrollToCurrentMatch();
  }, [editor, scrollToCurrentMatch]);

  const handleCloseSearch = useCallback(() => {
    setShowSearch(false);
    setSearchTerm('');
    setReplaceTerm('');
    editor?.chain().setSearchTerm('').run();
    editor?.commands.focus();
  }, [editor]);

  const handleClearTerms = useCallback(() => {
    setSearchTerm('');
    setReplaceTerm('');
    editor?.chain().setSearchTerm('').run();
  }, [editor]);

  return (
    <div className={`app-container ${!showMinimap ? 'hide-minimap' : ''} ${!wordWrap ? 'no-wrap' : ''}`}>
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        draggedTabId={draggedTabId}
        dragOverTabId={dragOverTabId}
        canScrollLeft={canScrollLeft}
        canScrollRight={canScrollRight}
        tabsWrapperRef={tabsWrapperRef}
        onScrollCheck={checkTabScroll}
        onScrollLeft={handleScrollTabsLeft}
        onScrollRight={handleScrollTabsRight}
        onSelectTab={switchTab}
        onTabMouseDown={handleTabMouseDown}
        onTabMouseEnter={handleTabMouseEnter}
        onTabMouseLeave={handleTabMouseLeave}
        onTabContextMenu={handleTabContextMenu}
        onCloseTab={requestCloseTab}
        onAddTab={handleAddTab}
        onMinimize={handleMinimize}
        onMaximize={handleMaximize}
        onCloseApp={requestAppClose}
      />

      <Toolbar
        wordWrap={wordWrap}
        showMinimap={showMinimap}
        isBoldActive={activeFormats.bold}
        isItalicActive={activeFormats.italic}
        dot1Ref={dot1Ref}
        dot2Ref={dot2Ref}
        dot3Ref={dot3Ref}
        onNewTab={handleAddTab}
        onOpen={handleOpen}
        onShowRecent={handleShowRecent}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onExportPdf={handleExportPdf}
        onToggleWordWrap={handleToggleWordWrap}
        onToggleMinimap={handleToggleMinimap}
        onToggleBold={handleToggleBold}
        onToggleItalic={handleToggleItalic}
        onToggleAnimation={handleToggleAnimation}
      />

      <div className="workspace-container">
        <SearchBox
          showSearch={showSearch}
          searchTerm={searchTerm}
          replaceTerm={replaceTerm}
          resultCountText={
            (editor?.storage as any)?.searchAndReplace?.results?.length > 0
              ? `${((editor?.storage as any)?.searchAndReplace?.resultIndex || 0) + 1} of ${(editor?.storage as any)?.searchAndReplace?.results?.length}`
              : '0 of 0'
          }
          findBoxRef={findBoxRef}
          searchInputRef={searchInputRef}
          onSearchChange={handleSearchChange}
          onReplaceChange={handleReplaceChange}
          onPreviousMatch={handlePreviousMatch}
          onNextMatch={handleNextMatch}
          onReplaceCurrent={handleReplaceCurrent}
          onReplaceAll={handleReplaceAll}
          onClose={handleCloseSearch}
          onClearTerms={handleClearTerms}
        />

        <EditorPane
          editor={editor}
          wordWrap={wordWrap}
          zoomLevel={zoomLevel}
          onScroll={handleEditorScroll}
        />

        <Minimap
          content={minimapContent}
          minimapViewportRef={minimapViewportRef}
          minimapContentRef={minimapContentRef}
          onTrackMouseDown={handleMinimapTrackMouseDown}
          onViewportMouseDown={handleMinimapMouseDown}
        />
      </div>

      <UnsavedModal
        isOpen={Boolean(tabToClose)}
        tabTitle={tabs.find(t => t.id === tabToClose)?.title || ''}
        onSave={handleSaveFromModal}
        onDontSave={() => tabToClose && executeCloseTab(tabToClose)}
        onCancel={() => setTabToClose(null)}
      />

      <QuitModal
        isOpen={showQuitPrompt}
        onReviewTabs={() => setShowQuitPrompt(false)}
        onQuitAnyway={forceCloseApp}
      />

      <GoToLineModal
        isOpen={showGoToLine}
        lineNumber={lineNumber}
        onLineNumberChange={setLineNumber}
        onSubmit={executeGoToLine}
        onCancel={() => {
          setShowGoToLine(false);
          setLineNumber('');
        }}
      />

      <RecentFilesModal
        isOpen={showRecentModal}
        recentFiles={recentFiles}
        onOpenFile={async (path) => {
          try {
            const success = await openFileInTab(path);
            if (success) setShowRecentModal(false);
          } catch (e) {
            showToast("Could not open file.", "error");
            const updated = recentFilesRef.current.filter(p => p !== path);
            recentFilesRef.current = updated;
            setRecentFiles(updated);
            try { localStorage.setItem('noting_recents', JSON.stringify(updated)); } catch {}
          }
        }}
        onClose={() => setShowRecentModal(false)}
      />

      <ContextMenu
        pos={contextMenu}
        onCut={async () => {
          const selectedText = editor?.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '\n\n', '\n');
          if (selectedText) {
            await writeText(selectedText);
            editor?.chain().focus().deleteSelection().run();
          }
        }}
        onCopy={async () => {
          const selectedText = editor?.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '\n\n', '\n');
          if (selectedText) await writeText(selectedText);
        }}
        onPaste={async () => {
          const raw = await readText();
          if (raw && editor) {
            const text = raw.replace(/\r\n/g, '\n');
            if (text.includes('\n')) {
              editor.chain().focus().insertContent(pasteTextToHtml(text)).run();
            } else {
              editor.chain().focus().insertContent({ type: 'text', text }).run();
            }
          }
        }}
        onFind={() => setShowSearch(true)}
        onGoToLine={() => setShowGoToLine(true)}
        onClose={() => setContextMenu(null)}
      />

      <TabContextMenu
        pos={tabContextMenu}
        isPinned={Boolean(tabs.find(t => t.id === tabContextMenu?.tabId)?.isPinned)}
        onTogglePin={() => {
          if (tabContextMenu) togglePin(tabContextMenu.tabId);
        }}
        onCloseTab={(e) => {
          if (tabContextMenu) requestCloseTab(e, tabContextMenu.tabId);
        }}
        onCloseMenu={() => setTabContextMenu(null)}
      />

      <StatusBar
        zoomLevel={zoomLevel}
        cursorLine={cursorPos.line}
        cursorCol={cursorPos.col}
        selectedWords={selectedWords}
        words={words}
        chars={chars}
      />

      <ToastNotification toast={toast} />
    </div>
  );
}
export default App;
