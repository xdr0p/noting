export interface Tab {
  // INVARIANT: Always sanitized HTML. Only from parseFileContent() (sanitized)
  // or editor.getHTML() (ProseMirror schema-trusted). Never raw marked output.
  id: string;
  title: string;
  content: string;
  path?: string;
  isDirty?: boolean;
  isPinned?: boolean;
}

export interface Toast {
  id: string;
  message: string;
  type?: 'info' | 'error' | 'success';
}

export interface ContextMenuPos {
  x: number;
  y: number;
}

export interface TabContextMenuPos {
  x: number;
  y: number;
  tabId: string;
}
