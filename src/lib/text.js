// @ts-check

/**
 * @typedef {Object} Tab
 * @property {string} id
 * @property {string} title
 * @property {string} content
 * @property {string} [path]
 * @property {boolean} [isDirty]
 * @property {boolean} [isPinned]
 */

/**
 * @param {string} path
 * @param {string} [fallback='Untitled']
 * @returns {string}
 */
export const titleFromPath = (path, fallback = 'Untitled') =>
  (path.split(/[/\\]/).pop() || fallback).replace(/\.[^/.]+$/, '');

/**
 * @param {string} text
 * @returns {string}
 */
export const titleFromText = (text) => {
  const firstLine = text.split('\n')[0].replace(/<[^>]+>/g, '').trim();
  return firstLine.length > 30 ? `${firstLine.substring(0, 30)}...` : firstLine || 'Untitled';
};

/**
 * @param {any} editor
 * @returns {string}
 */
export const titleFromEditor = (editor) =>
  titleFromText(editor?.state?.doc?.firstChild?.textContent ?? '');

/**
 * @param {string} title
 * @returns {string}
 */
export const suggestedFileName = (title) =>
  title.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').trim() || 'Untitled';

/**
 * @param {Tab} tab
 * @param {any} [activeEditor]
 * @param {string} [activeId]
 * @returns {boolean}
 */
export const isTabEmpty = (tab, activeEditor, activeId) => {
  if (tab.path) return false;
  if (tab.id === activeId && activeEditor) return activeEditor.isEmpty;
  return tab.content === '' || tab.content === '<p></p>'
    || tab.content === '<p><br></p>'
    || tab.content === '<p><br class="ProseMirror-trailingBreak"></p>';
};

/**
 * @param {Tab} tab
 * @param {any} [activeEditor]
 * @param {string} [activeId]
 * @returns {boolean}
 */
export const isEmptyUntitledTab = (tab, activeEditor, activeId) =>
  !tab.path && isTabEmpty(tab, activeEditor, activeId);

/**
 * @param {Tab} tab
 * @param {any} [activeEditor]
 * @param {string} [activeId]
 * @returns {boolean}
 */
export const isBlankUnsavedTab = (tab, activeEditor, activeId) =>
  isEmptyUntitledTab(tab, activeEditor, activeId) && !tab.isDirty;

/**
 * @param {string|null|undefined} path
 * @returns {boolean}
 */
export const isTxtFile = (path) => (path ?? '').toLowerCase().endsWith('.txt');

/**
 * @param {string} text
 * @returns {string}
 */
export const textToHtml = (text) => {
  if (text.length === 0) return '<p></p>';
  return text.replace(/\r\n/g, '\n').split('\n').map(line => {
    if (line === '') return '<p></p>';
    const escaped = line
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const preserved = escaped
      .replace(/^( )+/, m => '\u00A0'.repeat(m.length))
      .replace(/( )+$/, m => '\u00A0'.repeat(m.length))
      .replace(/( ){2,}/g, m => '\u00A0'.repeat(m.length));
    return `<p>${preserved}</p>`;
  }).join('');
};

/**
 * @param {string} html
 * @returns {string}
 */
export const htmlToText = (html) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.body.children)
    .map(el => el.textContent || '')
    .join('\n')
    .replace(/\u00A0/g, ' ');
};

/**
 * @param {string} text
 * @returns {string}
 */
export const pasteTextToHtml = (text) => {
  if (text.length === 0) return '';
  return text.replace(/\r\n/g, '\n').split('\n').map(line => {
    const escaped = line
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<p>${escaped || '<br>'}</p>`;
  }).join('');
};
