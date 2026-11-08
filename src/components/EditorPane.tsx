import { memo } from 'react';
import { EditorContent, Editor } from '@tiptap/react';

interface EditorPaneProps {
  editor: Editor | null;
  wordWrap: boolean;
  zoomLevel: number;
  onScroll: () => void;
}

export const EditorPane = memo(function EditorPane({
  editor,
  wordWrap,
  zoomLevel,
  onScroll,
}: EditorPaneProps) {
  return (
    <EditorContent 
      editor={editor} 
      className={`editor-container ${!wordWrap ? 'no-wrap' : ''}`} 
      style={{ fontSize: `${1.0 * (zoomLevel / 100)}rem` }} 
      onScroll={onScroll}
    />
  );
});
