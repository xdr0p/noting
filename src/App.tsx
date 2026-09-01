import TurndownService from 'turndown';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import SearchAndReplace from '@sereneinserenade/tiptap-search-and-replace';
import React, { useState, useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Italic from '@tiptap/extension-italic';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import { Extension, InputRule } from '@tiptap/core'; 
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open, save } from '@tauri-apps/plugin-dialog'; 
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'; 
import './App.css';
import appIcon from './assets/app-icon.png';


// Custom Italic extension that disables default asterisk/underscore input rules
// so typing math asterisks like 5*2*3 doesn't accidentally format text as italic
const CustomItalic = Italic.extend({
  addInputRules() {
    return [];
  },
});

const SUPERSCRIPT_CHARS = '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾';

const toSuperscript = (value: string) => {
  const map: Record<string, string> = {
    '0': '⁰',
    '1': '¹',
    '2': '²',
    '3': '³',
    '4': '⁴',
    '5': '⁵',
    '6': '⁶',
    '7': '⁷',
    '8': '⁸',
    '9': '⁹',
    '+': '⁺',
    '-': '⁻',
    '(': '⁽',
    ')': '⁾',
  };

  return value
    .split('')
    .map((char) => map[char] ?? char)
    .join('');
};

const fromSuperscript = (value: string) => {
  const map: Record<string, string> = {
    '⁰': '0',
    '¹': '1',
    '²': '2',
    '³': '3',
    '⁴': '4',
    '⁵': '5',
    '⁶': '6',
    '⁷': '7',
    '⁸': '8',
    '⁹': '9',
    '⁺': '+',
    '⁻': '-',
    '⁽': '(',
    '⁾': ')',
  };

  return value
    .split('')
    .map((char) => map[char] ?? char)
    .join('');
};

const makeExponentsPretty = (expression: string) => {
  return expression.replace(/(\d+|\))\s*\^\s*(-?[0-9]+)/g, (_match, base, exponent) => {
    return `${base}${toSuperscript(exponent)}`;
  });
};

const normalizeSuperscriptForMath = (expression: string) => {
  const superscriptRun = new RegExp(`(\\d+|\\))([${SUPERSCRIPT_CHARS}]+)`, 'g');

  return expression.replace(superscriptRun, (_match, base, exponent) => {
    const normalExponent = fromSuperscript(exponent);
    return `${base}**${normalExponent.startsWith('-') ? `(${normalExponent})` : normalExponent}`;
  });
};

const getPreviousLineResult = (doc: any, pos: number): number | null => {
  let prevResult: number | null = null;
  doc.nodesBetween(0, pos, (node: any) => {
    if (node.isTextblock && node.textContent.trim().length > 0) {
      const text = node.textContent.trim();
      const eqMatch = text.match(/=\s*(-?[0-9,]+(?:\.[0-9]+)?)\s*$/);
      if (eqMatch) {
        const val = parseFloat(eqMatch[1].replace(/,/g, ''));
        if (!isNaN(val)) prevResult = val;
      } else {
        const numMatch = text.match(/^(-?[0-9,]+(?:\.[0-9]+)?)$/);
        if (numMatch) {
          const val = parseFloat(numMatch[1].replace(/,/g, ''));
          if (!isNaN(val)) prevResult = val;
        }
      }
    }
  });
  return prevResult;
};

const buildMathExpression = (expression: string, prevResult?: number | null) => {
  let expr = expression.replace(/,/g, '').replace(/\s+/g, '');
  
  if (/ans/i.test(expr)) {
    const valStr = prevResult !== null && prevResult !== undefined ? String(prevResult) : '0';
    expr = expr.replace(/ans/gi, valStr);
  }
  
  if (/^[\+\-\*\/]/.test(expr) && prevResult !== null && prevResult !== undefined) {
    expr = `${prevResult}${expr}`;
  }

  return normalizeSuperscriptForMath(expr)
    .replace(/\^(-?[0-9]+(?:\.[0-9]+)?)/g, (_match, exponent) => {
      return `**${exponent.startsWith('-') ? `(${exponent})` : exponent}`;
    })
    .replace(/\^/g, '**')
    .replace(/[^0-9\+\-\*\/\.\(\)]/g, '');
};

const formatMathExpression = (expression: string) => {
  return makeExponentsPretty(expression.replace(/,/g, '').replace(/\s+/g, ''))
    .replace(/([\+\-\*\/])/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .trim();
};

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
        find: /([⁰¹²³⁴⁵⁶⁷⁸⁹]+)([0-9])$/,
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
        find: /([0-9\)⁰¹²³⁴⁵⁶⁷⁸⁹])([\+\-\*\/])$/,
        handler: ({ state, range, match }) => {
          state.tr.insertText(`${match[1]} ${match[2]} `, range.from, range.to);
        },
      }),
      new InputRule({
        find: /([\+\-\*\/])([0-9])$/,
        handler: ({ state, range, match }) => {
          state.tr.insertText(`${match[1]} ${match[2]}`, range.from, range.to);
        },
      }),
    ];
  },
});

const isMathProblem = (expr: string) => {
  const trimmed = expr.trim();
  if (!trimmed) return false;
  if (/[\+\-\*\/\^]/.test(trimmed)) return true;
  if (/ans/i.test(trimmed)) return true;
  return false;
};

const solveLinearEquation = (eqStr: string): { variable: string; value: number } | null => {
  const parts = eqStr.split('=');
  if (parts.length !== 2) return null;
  const left = parts[0].trim();
  const right = parts[1].trim();

  // Look for single variable letter (x, y, z, etc.)
  const varMatch = (left + ' ' + right).match(/\b([a-zA-Z])\b/);
  if (!varMatch) return null;
  const variable = varMatch[1];

  const evalSide = (exprStr: string, varVal: number) => {
    const clean = buildMathExpression(exprStr.replace(new RegExp(`\\b${variable}\\b`, 'gi'), `(${varVal})`));
    return new Function(`return ${clean}`)();
  };

  try {
    const f = (v: number) => evalSide(left, v) - evalSide(right, v);
    const f0 = f(0);
    const f1 = f(1);
    const slope = f1 - f0;
    if (Math.abs(slope) < 1e-9) return null;
    const sol = -f0 / slope;
    if (!Number.isFinite(sol)) return null;

    // VERIFICATION: Ensure equation is linear and f(sol) is zero
    if (Math.abs(f(sol)) > 1e-4) return null;

    const rounded = Math.round(sol * 10000) / 10000;
    return { variable, value: rounded };
  } catch (e) {
    return null;
  }
};

const MathEngine = Extension.create({
  name: 'mathEngine',
  priority: 1000,

  addInputRules() {
    return [
      new InputRule({
        find: /([0-9a-zA-Z\+\-\*\/\^\.\(\)\s,⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾=]+)=$/,
        handler: ({ state, range, match }) => {
          const expression = match[1]; 
          const leadingSpaces = expression.match(/^\s*/)?.[0] || '';
          const trimmed = expression.trim();
          
          // 1. Solve Equation (e.g., 10 = 3 + x)
          if (trimmed.includes('=')) {
            const sol = solveLinearEquation(trimmed);
            if (sol) {
              state.tr.insertText(`${leadingSpaces}${trimmed}  =>  ${sol.variable} = ${sol.value.toLocaleString()} `, range.from, range.to);
              return;
            }
          }

          // 2. Standalone number: 10= becomes 10 = (formatted with commas if long)
          if (/^\d+(\.\d+)?$/.test(trimmed)) {
            const formatted = Number(trimmed).toLocaleString();
            state.tr.insertText(`${leadingSpaces}${formatted} = `, range.from, range.to);
            return;
          }

          // 3. Standard Math Evaluation (e.g., 50 * 2=)
          const prevResult = getPreviousLineResult(state.doc, range.from);

          try {
            const cleanExpr = buildMathExpression(trimmed, prevResult);
            if (!cleanExpr) return null;
            const result = new Function(`return ${cleanExpr}`)();
            if (!Number.isFinite(result)) return null;

            const rounded = Math.round(result * 10000) / 10000;
            const formattedExpr = formatMathExpression(trimmed);                          
            
            state.tr.insertText(`${leadingSpaces}${formattedExpr} = ${rounded.toLocaleString()} `, range.from, range.to);
          } catch (e) {
            return null; 
          }
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

        const textBeforeCursor = $head.parent.textBetween(0, $head.parentOffset, undefined, ' ');
        const match = textBeforeCursor.match(/([0-9a-zA-Z\+\-\*\/\^\.\(\)\s,⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾=]+)$/);

        if (match && match[1].trim() !== '') {
          const expression = match[1];
          const trimmed = expression.trim();
          const from = $head.pos - expression.length;
          const to = $head.pos;
          const leadingSpaces = expression.match(/^\s*/)?.[0] || '';

          // 1. Solve Equation (e.g. 10 = 3 + x)
          if (trimmed.includes('=')) {
            const sol = solveLinearEquation(trimmed);
            if (sol) {
              this.editor.view.dispatch(
                state.tr.insertText(`${leadingSpaces}${trimmed}  =>  ${sol.variable} = ${sol.value.toLocaleString()} `, from, to)
              );
              return true;
            }
          }

          // 2. Standard Math Evaluation (e.g. 50 * 2) - Enter only intercepts math expressions
          if (isMathProblem(trimmed)) {
            const prevResult = getPreviousLineResult(state.doc, from);

            try {
              const cleanExpr = buildMathExpression(trimmed, prevResult);
              if (!cleanExpr) return false;
              const result = new Function(`return ${cleanExpr}`)();
              
              if (!Number.isFinite(result)) return false;

              const rounded = Math.round(result * 10000) / 10000;
              const formattedExpr = formatMathExpression(trimmed);

              this.editor.view.dispatch(
                state.tr.insertText(`${leadingSpaces}${formattedExpr} = ${rounded.toLocaleString()} `, from, to)
              );
              
              return true;
            } catch (e) {
              return false; 
            }
          }
        }
        
        return false;
      },
    };
  },
});

interface Tab {
  id: string;
  title: string;
  content: string;
  path?: string;
  isDirty?: boolean;
  isPinned?: boolean;
}

let isForceClosing = false;
let globalUnlisten: (() => void) | null = null;

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

const createTabId = () => Math.random().toString(36).substring(2, 9);

const parseFileContent = async (rawText: string): Promise<string> => {
  const parsed = await marked.parse(rawText);
  const rawHtml = typeof parsed === 'string' ? parsed : String(parsed);
  return DOMPurify.sanitize(rawHtml);
};

const titleFromPath = (path: string, fallback = 'Untitled') =>
  (path.split(/[/\\]/).pop() || fallback).replace(/\.[^/.]+$/, '');

const titleFromText = (text: string) => {
  const firstLine = text.split('\n')[0].replace(/<[^>]+>/g, '').trim();
  return firstLine.length > 30 ? `${firstLine.substring(0, 30)}...` : firstLine || 'Untitled';
};

const suggestedFileName = (title: string) =>
  title.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').trim() || 'Untitled';

const isEmptyUntitledTab = (tab: Tab) =>
  !tab.path && (tab.content === '<p></p>' || tab.content === '');

const isBlankUnsavedTab = (tab: Tab) => isEmptyUntitledTab(tab) && !tab.isDirty;

const updatePlaceholderVisibility = (editor: any) => {
  let textBlockCount = 0;
  editor.state.doc.descendants((node: any) => {
    if (node.isTextblock) textBlockCount++;
  });

  // FIXED: Hide the placeholder if there's more than 1 block, OR if there's any actual text.
  const hasText = editor.state.doc.textContent.trim() !== '';
  const shouldHidePlaceholder = textBlockCount > 1 || hasText;
  
  editor.view.dom.classList.toggle('hide-empty-placeholder', shouldHidePlaceholder);
};

const getConstrainedPos = (pos: { x: number; y: number } | null, menuWidth = 160, menuHeight = 180) => {
  if (!pos) return { top: 0, left: 0 };
  const left = Math.min(pos.x, Math.max(10, window.innerWidth - menuWidth - 10));
  const top = Math.min(pos.y, Math.max(10, window.innerHeight - menuHeight - 10));
  return { top, left };
};

function App() {
  const appWindow = getCurrentWindow();
  
  // 1. ALL STATE DECLARED EXACTLY ONCE
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([{ id: '1', title: 'Untitled', content: '', isDirty: false }]);
  const [activeTabId, setActiveTabId] = useState('1');
  const tabsWrapperRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkTabScroll = () => {
    const elem = tabsWrapperRef.current;
    if (!elem) return;
    const hasOverflow = elem.scrollWidth > elem.clientWidth + 2;
    setCanScrollLeft(hasOverflow && elem.scrollLeft > 2);
    setCanScrollRight(hasOverflow && elem.scrollLeft + elem.clientWidth < elem.scrollWidth - 2);
  };

  useEffect(() => {
    checkTabScroll();
    window.addEventListener('resize', checkTabScroll);
    return () => window.removeEventListener('resize', checkTabScroll);
  }, [tabs]);
  const [words, setWords] = useState(0);
  const [chars, setChars] = useState(0);
  const [selectedWords, setSelectedWords] = useState(0); // For the selection count
  const [replaceTerm, setReplaceTerm] = useState('');
  const [recentFiles, setRecentFiles] = useState<string[]>([]); // For recent files
  const [showRecentModal, setShowRecentModal] = useState(false);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [tabToClose, setTabToClose] = useState<string | null>(null);
  const [showQuitPrompt, setShowQuitPrompt] = useState(false);
  const [wordWrap, setWordWrap] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [zoomLevel, setZoomLevel] = useState(100);
  const [showGoToLine, setShowGoToLine] = useState(false);
  const [lineNumber, setLineNumber] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number } | null>(null);
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number, y: number, tabId: string } | null>(null);
  const [activeFormats, setActiveFormats] = useState({ bold: false, italic: false });
  const [showMinimap, setShowMinimap] = useState<boolean>(() => {
    const saved = localStorage.getItem('noting_show_minimap');
    return saved !== null ? JSON.parse(saved) : false; 
  });

  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    // Updates the clock every 1000 milliseconds (1 second)
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem('noting_show_minimap', JSON.stringify(showMinimap));
  }, [showMinimap]);
  const minimapContentRef = useRef<HTMLDivElement>(null);
  const minimapViewportRef = useRef<HTMLDivElement>(null);
  // 1. THE FLOW STATE VARIABLES
  const [isAnimating, setIsAnimating] = useState(false);
  const [animMode, setAnimMode] = useState(0); 

  // NEW: Refs directly attach to the dots so we can move them at 60fps without lagging React
  const dot1Ref = useRef<HTMLSpanElement>(null);
  const dot2Ref = useRef<HTMLSpanElement>(null);
  const dot3Ref = useRef<HTMLSpanElement>(null);
  const animState = useRef({ mode: 0, prevMode: 0, transitionStart: 0 });

  // 2. THE AUTO-DJ (Randomly cycles animations when turned on)
  useEffect(() => {
    if (!isAnimating) {
      setAnimMode(0); // Snap back to triangle when turned off
      return;
    }
    let timeoutId: ReturnType<typeof setTimeout>;
    const triggerNextAnimation = () => {
      setAnimMode(prev => {
        let next;
        do { next = Math.floor(Math.random() * 6) + 1; } while (next === prev);
        return next;
      });
      timeoutId = setTimeout(triggerNextAnimation, Math.random() * 2000 + 3000);
    };
    triggerNextAnimation();
    return () => clearTimeout(timeoutId);
  }, [isAnimating]);

  const isAnimRunningRef = useRef(false);
  const startAnimLoopRef = useRef<() => void>(() => {});

  // 3. THE GENERATIVE MATH ENGINE (Flawless Transitions)
  useEffect(() => {
    // Updates our internal tracker whenever the React state changes
    animState.current.prevMode = animState.current.mode;
    animState.current.mode = animMode;
    animState.current.transitionStart = performance.now() / 1000;
    startAnimLoopRef.current();
  }, [animMode]);

  useEffect(() => {
    let reqId: number | null = null;
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

      // Get where the dots WOULD be on the old path, and where they SHOULD be on the new path
      const prevPos = getPos(prevMode, t);
      const currPos = getPos(mode, t);
      const dots = [dot1Ref.current, dot2Ref.current, dot3Ref.current];

      dots.forEach((dot, i) => {
        if (!dot) return;
        // Mathematically blend their positions together over time
        const x = prevPos[i].x + (currPos[i].x - prevPos[i].x) * ease;
        const y = prevPos[i].y + (currPos[i].y - prevPos[i].y) * ease;
        const r = Math.round(prevPos[i].c[0] + (currPos[i].c[0] - prevPos[i].c[0]) * ease);
        const g = Math.round(prevPos[i].c[1] + (currPos[i].c[1] - prevPos[i].c[1]) * ease);
        const b = Math.round(prevPos[i].c[2] + (currPos[i].c[2] - prevPos[i].c[2]) * ease);

        dot.style.transform = `translate(${x}px, ${y}px)`;
        dot.style.backgroundColor = `rgb(${r},${g},${b})`;
      });

      // Pause loop only when resting at mode 0 and transition is fully complete
      if (mode === 0 && prevMode === 0 && progress >= 1) {
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
  }, []);

  const isProgrammaticChangeRef = useRef(false);

  // 2. THE REF
  const activeTabIdRef = useRef(activeTabId);
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]); 

  const searchInputRef = useRef<HTMLInputElement>(null);
  const findBoxRef = useRef<HTMLDivElement>(null);
  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

  // Update the global dirty check (around line 105)
  const hasDirtyTabsRef = useRef(false);
  useEffect(() => {
    hasDirtyTabsRef.current = tabs.some(t => {
      if (!t.isDirty) return false;
      // If it's dirty but it's a completely untouched new file, safely ignore it
      if (!t.path && (t.content === '<p></p>' || t.content === '')) return false;
      return true;
    });
  }, [tabs]);

  // 2. THE STRICT-MODE SAFE INTERCEPTOR
  useEffect(() => {
    // 1. Kill any existing ghost listeners from Strict Mode immediately
    if (globalUnlisten) {
      globalUnlisten();
      globalUnlisten = null;
    }

    // 2. Attach the one true listener
    appWindow.onCloseRequested((event) => {
      if (isForceClosing) return; // OVERRIDE: Obey the kill switch!

      if (hasDirtyTabsRef.current) {
        event.preventDefault(); // Stop the native OS close
        
        // Pull to front safely
        appWindow.unminimize().catch(() => {});
        appWindow.show().catch(() => {});
        appWindow.setFocus().catch(() => {});
        
        setShowQuitPrompt(true); 
      }
    }).then(unlisten => {
      globalUnlisten = unlisten; // Save it to the global variable
    });

    return () => {
      if (globalUnlisten) {
        globalUnlisten();
        globalUnlisten = null;
      }
    };
  }, []);

  /* --- FEATURE: SESSION RESTORE & RECENT FILES ON BOOT --- */
  useEffect(() => {
    const bootSession = async () => {
      // Load recent files
      const savedRecents = localStorage.getItem('noting_recents');
      if (savedRecents) {
        try { setRecentFiles(JSON.parse(savedRecents)); } catch (e) {}
      }

      const savedActiveId = localStorage.getItem('noting_active_tab_id');
      const savedSession = localStorage.getItem('noting_session');

      if (savedSession) {
        try {
          const parsedSession = JSON.parse(savedSession);
          if (parsedSession.length > 0) {
            const restoredTabs: Tab[] = [];
            for (const item of parsedSession) {
              if (item.path) {
                try {
                  if (item.isDirty && item.content) {
                    restoredTabs.push({
                      id: createTabId(),
                      title: item.title,
                      content: item.content,
                      path: item.path,
                      isDirty: true,
                      isPinned: item.isPinned
                    });
                  } else {
                    const rawText = await readTextFile(item.path);
                    const content = await parseFileContent(rawText);
                    restoredTabs.push({
                      id: createTabId(),
                      title: item.title,
                      content,
                      path: item.path,
                      isDirty: false,
                      isPinned: item.isPinned
                    });
                  }
                } catch (e) {
                  // File deleted or moved — restore as unsaved tab if it had content or was pinned
                  if (item.content || item.isPinned) {
                    restoredTabs.push({
                      id: createTabId(),
                      title: item.title || 'Untitled',
                      content: item.content || '',
                      isDirty: true,
                      isPinned: item.isPinned
                    });
                  }
                }
              } else if (item.isPinned || item.content || item.title) {
                restoredTabs.push({ ...item, id: createTabId() }); 
              }
            }
            if (restoredTabs.length > 0) {
              restoredTabs.sort((a, b) => (a.isPinned === b.isPinned) ? 0 : a.isPinned ? -1 : 1);
              setTabs(restoredTabs);
              const targetActiveId = restoredTabs.find(t => t.id === savedActiveId) ? savedActiveId : restoredTabs[0].id;
              setActiveTabId(targetActiveId || restoredTabs[0].id);
            }
          }
        } catch (e) {
          console.error('Failed to parse session state', e);
        }
      }
    };
    bootSession();
  }, []);

  /* --- FEATURE: SAVE SESSION TO LOCAL STORAGE ON TAB CHANGE --- */
  useEffect(() => {
    const saveSession = () => {
      const sessionData = tabs.map(t => ({ 
        title: t.title, 
        path: t.path, 
        isPinned: t.isPinned,
        isDirty: t.isDirty,
        content: t.content
      }));

      try {
        localStorage.setItem('noting_session', JSON.stringify(sessionData));
        localStorage.setItem('noting_active_tab_id', activeTabId);
      } catch (e) {
        // Fallback for LocalStorage QuotaExceededError
        try {
          const lightweightSession = tabs.map(t => ({
            title: t.title,
            path: t.path,
            isPinned: t.isPinned,
            isDirty: t.isDirty,
            content: t.id === activeTabId || !t.path ? t.content : ''
          }));
          localStorage.setItem('noting_session', JSON.stringify(lightweightSession));
          localStorage.setItem('noting_active_tab_id', activeTabId);
        } catch (err) {
          console.error('Failed to save session state to localStorage', err);
        }
      }
    };

    const timer = setTimeout(saveSession, 300);
    return () => clearTimeout(timer);
  }, [tabs, activeTabId]);

  const forceCloseApp = () => {
    isForceClosing = true; 
    if (globalUnlisten) {
      globalUnlisten(); 
      globalUnlisten = null;
    }
    hasDirtyTabsRef.current = false;
    appWindow.close();
  };

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
      StarterKit.configure({ italic: false }),
      CustomItalic,
      Placeholder.configure({ placeholder: 'Write yo shi twin' }), 
      CharacterCount,
      SearchAndReplace.configure({ searchResultClass: 'search-match' })
    ],

    content: activeTab.content,
    editorProps: { attributes: { class: 'notepad', spellcheck: 'false' } },
    onCreate({ editor }) {
      updatePlaceholderVisibility(editor);
    },
    onTransaction({ editor }) {
      updatePlaceholderVisibility(editor);

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
      setWords(editor.storage.characterCount.words());
      setChars(editor.storage.characterCount.characters());
      
      if (transaction.docChanged && editor.isFocused) {
        if (isProgrammaticChangeRef.current) return;

        const safeTitle = titleFromText(editor.getText());

        setTabs(prev => prev.map(t => {
          if (t.id === activeTabIdRef.current) {
            const isActuallyDirty = !(!t.path && editor.isEmpty);
            const titleToUse = t.path 
              ? titleFromPath(t.path, safeTitle)
              : safeTitle;
            return { ...t, content: newContent, isDirty: isActuallyDirty, title: titleToUse };
          }
          return t;
        }));

        keepCaretAwayFromRightEdge();
      }
    },
    // This tracks the cursor position!
    onSelectionUpdate({ editor }) {
      const { selection } = editor.state;
      const { from, to } = selection;
      
      let currentLine = 0;
      let lastLineStartPos = 0;

      // Scan from the top of the document down to the cursor
      editor.state.doc.nodesBetween(0, from, (node, pos) => {
        if (node.isTextblock) {
          currentLine++;
          // Marks the starting position of this paragraph/list item
          lastLineStartPos = pos + 1; 
        } else if (node.type.name === 'hardBreak') {
          currentLine++;
          // Marks the starting position right after the Shift+Enter
          lastLineStartPos = pos + 1; 
        }
      });

      setCursorPos({
        line: currentLine || 1,
        // Column is simply the cursor's distance from the start of the current line!
        col: Math.max(1, from - lastLineStartPos + 1)
      });

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

  /* --- FEATURE: AUTO-SAVE (Save when app loses focus) --- */
  useEffect(() => {
    const handleAppBlur = async () => {
      const dirtyFileTabs = tabs.filter(t => t.isDirty && t.path);
      if (dirtyFileTabs.length === 0) return;

      for (const tab of dirtyFileTabs) {
        try {
          const htmlToSave = tab.id === activeTabId && editor ? editor.getHTML() : tab.content;
          const markdown = getMarkdown(htmlToSave);
          await writeTextFile(tab.path!, markdown);
        } catch (e) {
          console.error(`Auto-save on blur failed for ${tab.title}`, e);
        }
      }

      setTabs(prev => prev.map(t => (t.isDirty && t.path ? { ...t, isDirty: false } : t)));
    };

    window.addEventListener('blur', handleAppBlur);
    return () => window.removeEventListener('blur', handleAppBlur);
  }, [tabs, activeTabId, editor]);

  const addTab = (title = 'Untitled', content = '', path?: string) => {
    const newId = createTabId();
    setTabs(prev => [...prev, { id: newId, title, content, path, isDirty: false }]);
    setActiveTabId(newId);
    setTimeout(() => {
      document.querySelector('.add-tab-container')?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
      checkTabScroll();
    }, 50);
  };

  /* --- TOGGLE PIN STATUS --- */
  const togglePin = (id: string) => {
    setTabs(prev => {
      const next = prev.map(t => t.id === id ? { ...t, isPinned: !t.isPinned } : t);
      // Automatically sorts tabs so pinned ones stay safely on the left!
      return next.sort((a, b) => (a.isPinned === b.isPinned) ? 0 : a.isPinned ? -1 : 1);
    });
  };

  /* --- TAB DRAG (mouse-based, works in Tauri) --- */
  const handleTabMouseDown = (e: React.MouseEvent, id: string) => {
    if (e.button !== 0) return; // left button only
    // Don't start a drag if they clicked the × button
    if ((e.target as HTMLElement).classList.contains('tab-close')) return;
    e.preventDefault();
    setActiveTabId(id);
    setDraggedTabId(id);
  };

  const handleTabMouseEnter = (id: string) => {
    if (!draggedTabId) return;
    if (id === draggedTabId) {
      setDragOverTabId(null);
    } else {
      setDragOverTabId(id);
    }
  };

  // Global mouseup — finalise or cancel the drag
  useEffect(() => {
    const onMouseUp = () => {
      if (draggedTabId && dragOverTabId && draggedTabId !== dragOverTabId) {
        setTabs(prev => {
          const next = [...prev];
          const from = next.findIndex(t => t.id === draggedTabId);
          const to   = next.findIndex(t => t.id === dragOverTabId);
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          return next;
        });
      }
      setDraggedTabId(null);
      setDragOverTabId(null);
    };
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, [draggedTabId, dragOverTabId]);

  /* --- 1. TAB & APP CLOSING --- */
  // Update the tab close function (around line 275)
  const requestCloseTab = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const tab = tabs.find(t => t.id === id);
    
    if (tab?.isDirty) {
      const isEmptyNewFile = isEmptyUntitledTab(tab);
      if (isEmptyNewFile) {
        executeCloseTab(id); // Safe to close empty, unsaved tabs
      } else {
        setTabToClose(id); // Must prompt to save!
      }
    } else {
      executeCloseTab(id);
    }
  };

  const executeCloseTab = (id: string) => {
    if (tabs.length === 1) {
      const newId = createTabId();
      const freshTab: Tab = { id: newId, title: 'Untitled', content: '', isDirty: false };
      setTabs([freshTab]);
      setActiveTabId(newId);
      setTabToClose(null);
      return;
    }
    const closedIndex = tabs.findIndex(t => t.id === id);
    const newTabs = tabs.filter(t => t.id !== id);
    setTabs(newTabs);

    if (activeTabId === id) {
      const nextIndex = Math.min(closedIndex, newTabs.length - 1);
      setActiveTabId(newTabs[Math.max(0, nextIndex)].id);
    }
    setTabToClose(null); 
  };

  const requestAppClose = () => {
    if (hasDirtyTabsRef.current) {
      setShowQuitPrompt(true);
    } else {
      forceCloseApp();
    }
  };

  const addToRecentFiles = (path: string) => {
    setRecentFiles(prev => {
      const updated = [path, ...prev.filter(p => p !== path)].slice(0, 10);
      localStorage.setItem('noting_recents', JSON.stringify(updated));
      return updated;
    });
  };

  const openFileInTab = async (path: string): Promise<boolean> => {
    const existingTab = tabs.find(t => t.path === path);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      addToRecentFiles(path);
      return true;
    }

    try {
      const rawText = await readTextFile(path);
      const htmlContent = await parseFileContent(rawText);
      const fileName = titleFromPath(path);

      if (isBlankUnsavedTab(activeTab)) {
        setTabs(prev => prev.map(t =>
          t.id === activeTabId
            ? { ...t, title: fileName, content: htmlContent, path, isDirty: false }
            : t
        ));
        isProgrammaticChangeRef.current = true;
        editor?.commands.setContent(htmlContent);
        isProgrammaticChangeRef.current = false;
      } else {
        addTab(fileName, htmlContent, path);
      }

      addToRecentFiles(path);
      return true;
    } catch (e) {
      alert("Could not open file. It may have been moved, deleted, or permission was denied.");
      setRecentFiles(prev => prev.filter(p => p !== path));
      return false;
    }
  };

  const handleOpen = async () => {
    const selected = await open({ 
      multiple: false, 
      filters: [{ name: 'Text', extensions: ['txt', 'md'] }] 
    });
    if (selected && typeof selected === 'string') {
      await openFileInTab(selected);
    }
  };

  const handleSaveFromModal = async () => {
    if (!tabToClose) return;
    const tab = tabs.find(t => t.id === tabToClose);
    if (!tab) return;
    const suggestedName = suggestedFileName(tab.title);
    const path = tab.path || await save({
      defaultPath: suggestedName,
      filters: [{ name: 'Text Files', extensions: ['txt', 'md'] }],
    });
    if (path) {
      await writeTextFile(path, getMarkdown(tab.content));
      executeCloseTab(tabToClose);
      addToRecentFiles(path);
    } else {
      setTabToClose(null);
    }
  };

  const getMarkdown = (html: string): string => {
    return turndownService.turndown(html);
  };

  const handleSave = async () => {
    const suggestedName = suggestedFileName(activeTab.title);
    const path = activeTab.path || await save({
      defaultPath: suggestedName,
      filters: [{ name: 'Text Files', extensions: ['txt', 'md'] }],
    });
    if (path) {
      await writeTextFile(path, getMarkdown(editor?.getHTML() || ''));
      const fileName = titleFromPath(path, suggestedName);
      setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, path, title: fileName, isDirty: false } : t));
      addToRecentFiles(path);
    }
  };

  const handleSaveAs = async () => {
    const suggestedName = suggestedFileName(activeTab.title);
    const path = await save({
      defaultPath: suggestedName,
      filters: [{ name: 'Text Files', extensions: ['txt', 'md'] }],
    });
    if (path) {
      await writeTextFile(path, getMarkdown(editor?.getHTML() || ''));
      const fileName = titleFromPath(path, suggestedName);
      setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, path, title: fileName, isDirty: false } : t));
      addToRecentFiles(path);
    }
  };



  const executeGoToLine = () => {
    const line = parseInt(lineNumber);
    if (editor && !isNaN(line) && line > 0) {
      editor.commands.focus();
      let currentLine = 1;
      let targetPos = 0;
      let found = false;

      editor.state.doc.descendants((node, pos) => {
        if (found) return false;
        // Only count actual paragraphs/blocks that contain text or are empty lines
        if (node.type.isBlock) {
          if (currentLine === line) {
            targetPos = pos;
            found = true;
            return false;
          }
          currentLine++;
        }
      });

      if (found) {
        // Jump to the start of that line (+1 enters the node)
        editor.commands.setTextSelection(targetPos + 1);
        editor.commands.scrollIntoView();
      }
    }
    setShowGoToLine(false);
    setLineNumber('');
  };

  const scrollToCurrentMatch = () => {
    // A tiny delay gives Tiptap time to apply the CSS class before we look for it
    setTimeout(() => {
      const activeMatch = document.querySelector('.search-match-current');
      if (activeMatch) {
        activeMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 10);
  };

  /* --- 1. KEYBOARD & MOUSE SHORTCUTS --- */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        handleSave();
      } else if (e.ctrlKey && e.key === 'o') {
        e.preventDefault();
        handleOpen();
      } 
      // 1. FIXED Ctrl+N: Now safely opens a new tab instead of wiping the current one!
      else if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        addTab();
      } 
      // 2. NEW Ctrl+T: Standard browser shortcut for a new tab
      else if (e.ctrlKey && e.key === 't') {
        e.preventDefault();
        addTab();
      } 
      // 3. NEW Ctrl+W: Safely closes the active tab (will still prompt to save if dirty!)
      else if (e.ctrlKey && e.key === 'w') {
        e.preventDefault();
        // Passes a dummy event so the stopPropagation doesn't crash
        requestCloseTab({ stopPropagation: () => {} } as any, activeTabId);
      } 
      // ... Ctrl+Tab logic continues here ...
      else if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        const currentIndex = tabs.findIndex(t => t.id === activeTabId);
        const nextIndex = e.shiftKey
          ? (currentIndex - 1 + tabs.length) % tabs.length
          : (currentIndex + 1) % tabs.length;
        setActiveTabId(tabs[nextIndex].id);
      } else if (e.ctrlKey && e.key === 'f') {
        e.preventDefault(); 
        setShowSearch(true);
        editor?.chain().setSearchTerm(searchTerm).run();
      } else if (e.ctrlKey && e.key === 'g') {
        e.preventDefault();
        setShowGoToLine(true);
        } else if (e.ctrlKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        setShowMinimap((prev: boolean) => !prev);
        } else if (e.ctrlKey && e.key === 'p') {
        e.preventDefault();
        window.print(); // Triggers the OS "Save as PDF" dialog natively
      } else if (e.key === 'F3' || e.code === 'F3') {
        e.preventDefault();
        if (!showSearch) {
          setShowSearch(true);
          editor?.chain().setSearchTerm(searchTerm).run(); // Brings highlights back!
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
        editor?.chain().setSearchTerm('').run(); // Hides the highlights!
        
        // NEW: Unselects any highlighted text by collapsing the cursor to the end
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
  }, [activeTab, tabs, editor, showSearch, searchTerm]);

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
  const handleEditorScroll = (e?: React.UIEvent<HTMLDivElement>) => {
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
  };

  /* --- FEATURE: DRAGGABLE MINIMAP (No-Teleport Version) --- */
  const handleMinimapMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
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

    if (minimapViewportRef.current) minimapViewportRef.current.classList.add('is-dragging');

    const onMouseMove = (moveEvent: MouseEvent) => updateScroll(moveEvent.clientY);
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (minimapViewportRef.current) minimapViewportRef.current.classList.remove('is-dragging');
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleMinimapTrackMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
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
  };

  // Triggers the scroll math every time you type so the highlight box dynamically resizes!
  useEffect(() => {
    handleEditorScroll();
  }, [activeTab.content, zoomLevel, wordWrap, showMinimap]);

  return (
    <div className={`app-container ${!showMinimap ? 'hide-minimap' : ''}`}>
      
      {/* ROW 1: TABS (0f0f15 background) */}
      <div className="tab-bar" data-tauri-drag-region>
        
        {/* 1. The App Icon */}
        <div className="titlebar-icon" data-tauri-drag-region>
          <img 
            src={appIcon} /* <-- CHANGED: Uses the imported variable */
            alt="app icon" 
            style={{ width: '16px', height: '16px', pointerEvents: 'none' }} 
          />
        </div>

        {/* Scroll Left Button */}
        {(canScrollLeft || canScrollRight) && (
          <button 
            className={`tab-scroll-btn ${!canScrollLeft ? 'disabled' : ''}`}
            onClick={() => {
              tabsWrapperRef.current?.scrollBy({ left: -180, behavior: 'smooth' });
              setTimeout(checkTabScroll, 200);
            }}
            title="Scroll Tabs Left"
            disabled={!canScrollLeft}
          >
            ‹
          </button>
        )}

        {/* 2. Tabs Wrapper */}
        {/* THE CURSOR FIX: We only trigger "is-dragging" if the mouse has actually moved over another tab! */}
        <div 
          className={`tabs-wrapper${draggedTabId ? ' is-dragging' : ''}`}
          ref={tabsWrapperRef}
          data-tauri-drag-region
          onScroll={checkTabScroll}
          onMouseLeave={() => {
            if (draggedTabId) setDragOverTabId(null);
          }}
          onWheel={(e) => {
            if (e.deltaY !== 0) {
              e.currentTarget.scrollLeft += e.deltaY;
              checkTabScroll();
            }
          }}
        >
          {tabs.map(tab => (
            <div 
              key={tab.id} 
              className={`tab ${tab.id === activeTabId ? 'active' : ''} ${tab.id === draggedTabId ? 'dragging' : ''} ${tab.id === dragOverTabId ? 'drag-over' : ''}`}
              onClick={() => !draggedTabId && setActiveTabId(tab.id)}
              onMouseDown={(e) => handleTabMouseDown(e, tab.id)}
              onMouseEnter={() => handleTabMouseEnter(tab.id)}
              // NEW: Right click menu trigger!
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation(); // Stops the global listener
                setTabContextMenu({ x: e.clientX, y: e.clientY, tabId: tab.id });
              }}
            >
              {/* Adds a tiny pin icon if the tab is pinned */}
              <span className="tab-title">
                {tab.isPinned ? <span style={{fontSize: '0.75rem', marginRight: '4px'}}>📌</span> : ''}
                {tab.title}{tab.isDirty ? ' •' : ''}
              </span>
              <button className="tab-close" onClick={(e) => requestCloseTab(e, tab.id)}>×</button>
            </div>
          ))}
          <div className="add-tab-container" data-tauri-drag-region>
            <button className="add-tab-plus" onClick={() => addTab()} title="New Tab">+</button>
          </div>
        </div>

        {/* Scroll Right Button */}
        {(canScrollLeft || canScrollRight) && (
          <button 
            className={`tab-scroll-btn ${!canScrollRight ? 'disabled' : ''}`}
            onClick={() => {
              tabsWrapperRef.current?.scrollBy({ left: 180, behavior: 'smooth' });
              setTimeout(checkTabScroll, 200);
            }}
            title="Scroll Tabs Right"
            disabled={!canScrollRight}
          >
            ›
          </button>
        )}

        {/* 3. Window Controls */}
        <div className="window-controls">
          <button className="control-btn" onClick={() => appWindow.minimize()}>—</button>
          <button className="control-btn" onClick={() => appWindow.toggleMaximize()}>☐</button>
          <button className="control-btn close" onClick={requestAppClose}>✕</button>
        </div>
      </div>

      {/* ROW 2: MENU & TOOLS */}
      <div className="titlebar" data-tauri-drag-region>
        <div className="titlebar-left">
          <button className="menu-btn" onClick={() => addTab()}>New</button>
          <button className="menu-btn" onClick={handleOpen}>Open</button>
          <button className="menu-btn" onClick={() => setShowRecentModal(true)}>Recent</button> {/* <-- NEW BUTTON */}
          <button className="menu-btn" onClick={handleSave}>Save</button>
          <button className="menu-btn" onClick={handleSaveAs}>Save As</button>
          <button className="menu-btn" onClick={() => window.print()}>Export PDF</button>
          
          <div className="toolbar-divider"></div>
          
          {/* NEW: Word Wrap Toggle */}
          <button 
            className={`menu-btn ${wordWrap ? 'is-active' : ''}`} 
            onClick={() => setWordWrap(!wordWrap)}
          >
            Wrap
          </button>

          <button 
            className={`menu-btn ${showMinimap ? 'is-active' : ''}`} 
            onClick={() => setShowMinimap(!showMinimap)}
          >
            Map
          </button>

          <div className="toolbar-divider"></div>

          {/* THE FORMATTING TOOLBAR */}
          {editor && (
            <div className="format-group">
              <button 
                onClick={() => editor.chain().focus().toggleBold().run()} 
                className={`format-btn ${activeFormats.bold ? 'is-active' : ''}`}
                title="Bold (Ctrl+B)"
              >
                B
              </button>
              <button 
                onClick={() => editor.chain().focus().toggleItalic().run()} 
                className={`format-btn ${activeFormats.italic ? 'is-active' : ''}`} 
                style={{ fontStyle: 'italic' }}
                title="Italic (Ctrl+I)"
              >
                I
              </button>
            </div>
          )}
        </div>

        {/* NEW: THE AUTONOMOUS FLOW STATE */}
        <div className="titlebar-right">
          <div 
            className="fun-animation-btn"
            onClick={() => setIsAnimating(!isAnimating)}
            title="Toggle Flow State"
          >
            {/* The refs let our math engine control them instantly */}
            <span className="dot" ref={dot1Ref}></span>
            <span className="dot" ref={dot2Ref}></span>
            <span className="dot" ref={dot3Ref}></span>
          </div>
        </div>
        
      </div>

      {/* ROW 3: MAIN CONTENT (EDITOR & MINIMAP) */}
      <div className="workspace-container">
        {showSearch && (
          <div 
            className="find-box replace-mode"
            ref={findBoxRef}
            onKeyDown={(e) => {
              // THE FOCUS TRAP
              if (e.key === 'Tab') {
                // 1. Grab every single input and button inside the search box
                const focusableElements = findBoxRef.current?.querySelectorAll<HTMLElement>('input, button');
                if (!focusableElements || focusableElements.length === 0) return;

                const firstElement = focusableElements[0];
                const lastElement = focusableElements[focusableElements.length - 1];

                // 2. If holding Shift+Tab on the first element, jump to the end!
                if (e.shiftKey && document.activeElement === firstElement) {
                  e.preventDefault();
                  lastElement.focus();
                } 
                // 3. If holding Tab on the very last element, jump to the beginning!
                else if (!e.shiftKey && document.activeElement === lastElement) {
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
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  editor?.chain().setSearchTerm(e.target.value).run(); 
                  scrollToCurrentMatch();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (e.shiftKey) editor?.chain().previousSearchResult().run();
                    else editor?.chain().nextSearchResult().run();
                    scrollToCurrentMatch();
                  }
                }}
              />
              <span className="find-count">
                {(editor?.storage as any)?.searchAndReplace?.results?.length > 0 
                  ? `${((editor?.storage as any)?.searchAndReplace?.resultIndex || 0) + 1} of ${(editor?.storage as any)?.searchAndReplace?.results?.length}`
                  : '0 of 0'}
              </span>
              
              {/* NEW THICK SVG ICONS */}
              <button className="find-btn" onClick={() => { editor?.chain().previousSearchResult().run(); scrollToCurrentMatch(); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
              </button>
              <button className="find-btn" onClick={() => { editor?.chain().nextSearchResult().run(); scrollToCurrentMatch(); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </button>
              <button className="find-btn" onClick={() => {
                setShowSearch(false);
                setSearchTerm('');
                setReplaceTerm('');
                editor?.chain().setSearchTerm('').run(); 
                editor?.commands.focus();
              }}>
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
                onChange={(e) => {
                  setReplaceTerm(e.target.value);
                  editor?.chain().setReplaceTerm(e.target.value).run();
                }}
                // NEW: Lets you hit Enter to instantly replace the highlighted word!
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const storage = (editor?.storage as any)?.searchAndReplace;
                    const match = storage?.results?.[storage?.resultIndex];
                    if (match) {
                      editor?.chain().focus().insertContentAt({ from: match.from, to: match.to }, replaceTerm).run();
                      editor?.chain().setSearchTerm(searchTerm).run();
                    }
                  }
                }}
              />
              <button className="find-btn action" onClick={() => {
                const storage = (editor?.storage as any)?.searchAndReplace;
                const match = storage?.results?.[storage?.resultIndex];
                if (match) {
                  editor?.chain().focus().insertContentAt({ from: match.from, to: match.to }, replaceTerm).run();
                  editor?.chain().setSearchTerm(searchTerm).run();
                }
              }}>Replace</button>
              
              <button className="find-btn action" onClick={() => {
                editor?.chain().focus().replaceAll().run();
                editor?.chain().setSearchTerm(searchTerm).run();
              }}>All</button>
            </div>
          </div>
        )}
        <EditorContent 
          editor={editor} 
          className={`editor-container ${!wordWrap ? 'no-wrap' : ''}`} 
          style={{ fontSize: `${1.0 * (zoomLevel / 100)}rem` }} 
          onScroll={handleEditorScroll}
        />

        <div className="minimap-container" onMouseDown={handleMinimapTrackMouseDown}>
          <div 
            className="minimap-viewport" 
            ref={minimapViewportRef} 
            onMouseDown={handleMinimapMouseDown}
          >
            <div 
              className="minimap-content" 
              ref={minimapContentRef}
              dangerouslySetInnerHTML={{ __html: activeTab.content }} 
            />
          </div> 
        </div>
      </div>



      {/* 2. UNSAVED TAB MODAL */}
      {tabToClose && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Unsaved Changes</h3>
            <p>Do you want to save "{tabs.find(t => t.id === tabToClose)?.title}"?</p>
            <div className="modal-actions">
              <button className="modal-btn primary" onClick={handleSaveFromModal}>Save</button>
              <button className="modal-btn danger" onClick={() => executeCloseTab(tabToClose)}>Don't Save</button>
              <button className="modal-btn neutral" onClick={() => setTabToClose(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* 3. QUIT APP MODAL */}
      {showQuitPrompt && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Quit App?</h3>
            <p>You have unsaved tabs open. If you quit now, your work will be permanently lost.</p>
            <div className="modal-actions">
              <button className="modal-btn neutral" onClick={() => setShowQuitPrompt(false)}>Review Tabs</button>
              <button className="modal-btn danger" onClick={forceCloseApp}>
                Quit Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. GO TO LINE MODAL */}
      {showGoToLine && (
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
              onChange={(e) => setLineNumber(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && executeGoToLine()}
            />
            <div className="modal-actions">
              <button className="modal-btn neutral" onClick={() => setShowGoToLine(false)}>Cancel</button>
              <button className="modal-btn primary" onClick={executeGoToLine}>Go</button>
            </div>
          </div>
        </div>
      )}

      {/* 5. RECENT FILES MODAL */}
      {showRecentModal && (
        <div className="modal-overlay" onClick={() => setShowRecentModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Recent Files</h3>
            {recentFiles.length === 0 ? (
              <p>No recent files yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px', maxHeight: '250px', overflowY: 'auto', textAlign: 'left' }}>
                {recentFiles.map(path => (
                  <button
                    key={path}
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', color: '#d1d1d6', padding: '10px', borderRadius: '6px', cursor: 'pointer', textAlign: 'left', wordBreak: 'break-all', fontSize: '0.85rem' }}
                    onClick={async () => {
                      await openFileInTab(path);
                      setShowRecentModal(false);
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                    onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                  >
                    {/* Shows just the file name in bold, and the full path smaller below */}
                    <strong style={{ display: 'block', color: '#ffffff', marginBottom: '2px' }}>{path.split(/[/\\]/).pop()}</strong>
                    <span style={{ color: '#8b8ba3', fontSize: '0.75rem' }}>{path}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button className="modal-btn neutral" onClick={() => setShowRecentModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div 
          className="context-menu" 
          style={getConstrainedPos(contextMenu, 160, 200)}
          onClick={() => setContextMenu(null)}
        >
          <button onClick={async () => {
            const selectedText = editor?.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to);
            if (selectedText) {
              await writeText(selectedText);
              editor?.chain().focus().deleteSelection().run();
            }
          }}>Cut</button>
          
          <button onClick={async () => {
            const selectedText = editor?.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to);
            if (selectedText) await writeText(selectedText);
          }}>Copy</button>
          
          <button onClick={async () => {
            const clipboardText = await readText();
            if (clipboardText) editor?.chain().focus().insertContent(clipboardText).run();
          }}>Paste</button>
          
          <div className="toolbar-divider" style={{width: '100%', height: '1px', margin: '4px 0'}}></div>
          <button onClick={() => setShowSearch(true)}>Find (Ctrl+F)</button>
          <button onClick={() => setShowGoToLine(true)}>Go To (Ctrl+G)</button>
        </div>
      )}

      {/* THE NEW TAB RIGHT-CLICK MENU */}
      {tabContextMenu && (
        <div 
          className="context-menu" 
          style={getConstrainedPos(tabContextMenu, 160, 120)}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => {
            togglePin(tabContextMenu.tabId);
            setTabContextMenu(null);
          }}>
            {tabs.find(t => t.id === tabContextMenu.tabId)?.isPinned ? 'Unpin Tab' : 'Pin Tab'}
          </button>
          
          <div className="toolbar-divider" style={{width: '100%', height: '1px', margin: '4px 0'}}></div>
          
          <button onClick={(e) => {
            requestCloseTab(e as any, tabContextMenu.tabId);
            setTabContextMenu(null);
          }}>
            Close Tab
          </button>
        </div>
      )}

      {/* NEW ROW 4: SEPARATED STATUS BAR ROW */}
      <div className="status-bar-row">
        
        {/* NEW: The Clock in the bottom left */}
        <div className="status-bar-left">
          {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>

        <div className="status-bar">
          <span>{zoomLevel}%</span>
          <span className="status-divider">|</span>
          <span>Ln {cursorPos.line}, Col {cursorPos.col}</span>
          <span className="status-divider">|</span>
          <span>
            {selectedWords > 0 ? `${selectedWords} of ` : ''}
            {words} words ({chars} chars)
          </span>
        </div>
      </div>
    </div>
  );
}
export default App;
