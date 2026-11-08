import { Parser } from 'expr-eval';
import assert from 'node:assert/strict';

const mathParser = new Parser();

// 1. Math Functions
const SUPERSCRIPT_CHARS = '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾';
const SUPERSCRIPT_MAP = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁺': '+', '⁻': '-', '⁽': '(', '⁾': ')',
};
const fromSuperscript = (str) => str.split('').map(c => SUPERSCRIPT_MAP[c] || c).join('');

const normalizeSuperscriptForMath = (expression) => {
  const superscriptRun = /(\d+|\))([⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾]+)/g;
  return expression.replace(superscriptRun, (_match, base, exponent) => {
    const normalExponent = fromSuperscript(exponent);
    return `${base}^${normalExponent.startsWith('-') ? `(${normalExponent})` : normalExponent}`;
  });
};

const buildMathExpression = (expression, prevResult) => {
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
      return `^${exponent.startsWith('-') ? `(${exponent})` : exponent}`;
    })
    .replace(/\*\*/g, '^')
    .replace(/\)\s*\(/g, ')*(')
    .replace(/(\d)\s*\(/g, '$1*(')
    .replace(/\)\s*(\d)/g, ')*$1')
    .replace(/[^0-9\+\-\*\/\.\(\)\^]/g, '');
};

const solveLinearEquation = (eqStr) => {
  const parts = eqStr.split('=');
  if (parts.length !== 2) return null;
  const left = parts[0].trim();
  const right = parts[1].trim();

  const cleanForVar = (left + ' ' + right).replace(/ans/gi, '0');
  const varMatch = cleanForVar.match(/(?:^|[^a-zA-Z])([a-zA-Z])(?:[^a-zA-Z]|$)/);
  if (!varMatch) return null;
  const variable = varMatch[1];

  const evalSide = (exprStr, varVal) => {
    const withImplicit = exprStr
      .replace(new RegExp(`(\\d)\\s*${variable}\\b`, 'gi'), `$1*(${varVal})`)
      .replace(new RegExp(`\\b${variable}\\b`, 'gi'), `(${varVal})`);
    const clean = buildMathExpression(withImplicit);
    return mathParser.parse(clean).evaluate();
  };

  try {
    const f = (v) => evalSide(left, v) - evalSide(right, v);
    const f0 = f(0);
    const f1 = f(1);
    const slope = f1 - f0;
    if (Math.abs(slope) < 1e-9) return null;
    const sol = -f0 / slope;
    if (!Number.isFinite(sol)) return null;

    if (Math.abs(f(sol)) > 1e-4) return null;

    const rounded = Math.round(sol * 10000) / 10000;
    return { variable, value: rounded };
  } catch (e) {
    return null;
  }
};

// 2. Utility Functions
const titleFromPath = (path, fallback = 'Untitled') =>
  (path.split(/[/\\]/).pop() || fallback).replace(/\.[^/.]+$/, '');

const suggestedFileName = (title) =>
  title.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').trim() || 'Untitled';

const isTabEmpty = (tab, activeEditor, activeId) => {
  if (tab.path) return false;
  if (tab.id === activeId && activeEditor) return activeEditor.isEmpty;
  return tab.content === '' || tab.content === '<p></p>'
    || tab.content === '<p><br></p>'
    || tab.content === '<p><br class="ProseMirror-trailingBreak"></p>';
};

// Tests
console.log('Running test suite...');

// Math evaluations
assert.equal(mathParser.parse(buildMathExpression('2+2')).evaluate(), 4);
assert.equal(mathParser.parse(buildMathExpression('2+3*4')).evaluate(), 14);
assert.equal(mathParser.parse(buildMathExpression('2^3')).evaluate(), 8);
assert.equal(mathParser.parse(buildMathExpression('2³')).evaluate(), 8);
assert.equal(mathParser.parse(buildMathExpression('2**3')).evaluate(), 8);
assert.equal(mathParser.parse(buildMathExpression('2^-3')).evaluate(), 0.125);
assert.equal(mathParser.parse(buildMathExpression('2^(-3)')).evaluate(), 0.125);
assert.equal(mathParser.parse(buildMathExpression('(2+3)^2')).evaluate(), 25);
assert.equal(mathParser.parse(buildMathExpression('2^3^2')).evaluate(), 512);
assert.equal(mathParser.parse(buildMathExpression('2^1/2')).evaluate(), 1);
assert.equal(mathParser.parse(buildMathExpression('-5*-2')).evaluate(), 10);
assert.equal(mathParser.parse(buildMathExpression('2(3)')).evaluate(), 6);
assert.equal(mathParser.parse(buildMathExpression('(2)(3)')).evaluate(), 6);
assert.equal(mathParser.parse(buildMathExpression('(2)3')).evaluate(), 6);
assert.equal(mathParser.parse(buildMathExpression('ans+1', 4)).evaluate(), 5);
assert.equal(mathParser.parse(buildMathExpression('+5', 10)).evaluate(), 15);

// Linear equation solving
assert.deepEqual(solveLinearEquation('x+2=5'), { variable: 'x', value: 3 });
assert.deepEqual(solveLinearEquation('2x=6'), { variable: 'x', value: 3 });
assert.deepEqual(solveLinearEquation('2x+3=11'), { variable: 'x', value: 4 });
assert.deepEqual(solveLinearEquation('x + 2^3 = 10'), { variable: 'x', value: 2 });
assert.deepEqual(solveLinearEquation('2^3 * x = 16'), { variable: 'x', value: 2 });
// Non-linear equations rejected
assert.equal(solveLinearEquation('x^2=9'), null);
assert.equal(solveLinearEquation('x^3=27'), null);

// File & string utilities
assert.equal(titleFromPath('/home/user/docs/notes.md'), 'notes');
assert.equal(titleFromPath('C:\\Users\\user\\Documents\\todo.txt'), 'todo');
assert.equal(suggestedFileName('My: <Special> File?*'), 'My Special File');
assert.equal(suggestedFileName('Normal Document'), 'Normal Document');

// isTabEmpty
assert.equal(isTabEmpty({ id: '1', title: 'Untitled', content: '<p></p>' }), true);
assert.equal(isTabEmpty({ id: '1', title: 'Untitled', content: '<p><br></p>' }), true);
assert.equal(isTabEmpty({ id: '1', title: 'Untitled', content: '<p><br class="ProseMirror-trailingBreak"></p>' }), true);
assert.equal(isTabEmpty({ id: '1', title: 'File', content: '', path: '/path/to/file' }), false);
assert.equal(isTabEmpty({ id: '1', title: 'Untitled', content: '<p>Content</p>' }), false);

// Already solved equations containing '=' must not evaluate as standard math
const shouldEvaluateMath = (trimmed) => {
  if (trimmed.includes('=')) return false;
  return true;
};
assert.equal(shouldEvaluateMath('2 * 2 = 4'), false);
assert.equal(shouldEvaluateMath('2 * 2'), true);

console.log('✓ All 29 tests passed successfully.');
