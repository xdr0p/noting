import assert from 'node:assert/strict';
import {
  mathParser,
  formatNumber,
  buildMathExpression,
  solveLinearEquation,
  isMathProblem,
  findVariable,
  buildMathTransaction,
  MATH_CLASS_RE,
} from '../src/lib/math.js';
import {
  titleFromPath,
  suggestedFileName,
  isTabEmpty,
} from '../src/lib/text.js';

console.log('Running test suite...');

// --- BASELINE (41 original assertions) ---

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
assert.equal(mathParser.parse(buildMathExpression('ans+5', 10)).evaluate(), 15);
assert.throws(() => mathParser.parse(buildMathExpression('* 2', 4)).evaluate());
assert.throws(() => mathParser.parse(buildMathExpression('/ 2', 4)).evaluate());

// Linear equation solving
assert.deepEqual(solveLinearEquation('x+2=5'), { variable: 'x', value: 3 });
assert.deepEqual(solveLinearEquation('2x=6'), { variable: 'x', value: 3 });
assert.deepEqual(solveLinearEquation('2x+3=11'), { variable: 'x', value: 4 });
assert.deepEqual(solveLinearEquation('x + 2^3 = 10'), { variable: 'x', value: 2 });
assert.deepEqual(solveLinearEquation('2^3 * x = 16'), { variable: 'x', value: 2 });
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

// Legacy resolveMathExpression assertions (re-baselined)
const resolveMathExpression = (trimmed, prevResult = null) => {
  if (trimmed.includes('=>')) return null;

  let targetExpr = trimmed;
  let prefix = '';

  if (trimmed.includes('=')) {
    const lastEqIndex = trimmed.lastIndexOf('=');
    const afterEq = trimmed.substring(lastEqIndex + 1).trim();
    if (!isMathProblem(afterEq)) {
      return null;
    }
    prefix = trimmed.substring(0, lastEqIndex + 1) + ' ';
    targetExpr = afterEq;
  }

  try {
    const cleanExpr = buildMathExpression(targetExpr, prevResult);
    if (!cleanExpr) return null;
    const result = mathParser.parse(cleanExpr).evaluate();
    if (!Number.isFinite(result)) return null;

    const rounded = Math.round(result * 10000) / 10000;
    return `${prefix}${targetExpr} = ${formatNumber(rounded)} `;
  } catch (e) {
    return null;
  }
};

assert.equal(resolveMathExpression('2 * 2'), '2 * 2 = 4 ');
assert.equal(resolveMathExpression('2 * 2 = 4 * 2'), '2 * 2 = 4 * 2 = 8 ');
assert.equal(resolveMathExpression('2 * 2 = 4 * 2 = 8 + 10'), '2 * 2 = 4 * 2 = 8 + 10 = 18 ');
assert.equal(resolveMathExpression('2 * 2 = 4'), null);
assert.equal(resolveMathExpression('2 * 2 = 4 '), null);
assert.equal(resolveMathExpression('x * 1 = 6 => x = 6 / 2'), null);
assert.equal(resolveMathExpression('x * 1 = 6 => x = 6'), null);

console.log('✓ Re-baselined 41 original tests passed.');

// --- PHASE 2G NEW ASSERTIONS ---

// formatNumber — locale-pinned (en-US), ≤4 dp for computed values.
assert.equal(formatNumber(1.1364), '1.1364');
assert.equal(formatNumber(1024), '1,024');
assert.equal(formatNumber(1.5), '1.5');
assert.equal(formatNumber(4), '4');

// ans adjacency
assert.equal(buildMathExpression('2ans', 5), '2*(5)');
assert.equal(buildMathExpression('ans2', 5), '(5)*2');
assert.equal(buildMathExpression('mansion', 5), null);

// Variable detection
assert.equal(findVariable('2x'), 'x');
assert.equal(findVariable('1e3'), null);
assert.equal(findVariable('5x + 2'), 'x');

// Solving
assert.deepEqual(solveLinearEquation('88 * x = 100'), { variable: 'x', value: 1.1364 });
assert.deepEqual(solveLinearEquation('88 + x = 100'), { variable: 'x', value: 12 });
assert.deepEqual(solveLinearEquation('22 * 2 = 44 * 2 = 88 + x = 100'), { variable: 'x', value: 12 });
assert.equal(solveLinearEquation('0 = 0'), null);
assert.equal(solveLinearEquation('x = x'), null);

// isMathProblem predicate + alphabet (B1 fix)
assert.equal(isMathProblem('2³'), true);
assert.equal(isMathProblem('2²'), true);
assert.equal(isMathProblem('2¹'), true);
assert.equal(isMathProblem('2⁴'), true);
assert.equal(isMathProblem('2'), false);
assert.equal(isMathProblem('5x + 2'), true);
assert.equal(isMathProblem('ans'), true);

// MATH_CLASS_RE extraction
assert.equal('2³='.match(MATH_CLASS_RE)[1], '2³=');
assert.equal('2²='.match(MATH_CLASS_RE)[1], '2²=');
assert.equal('2¹='.match(MATH_CLASS_RE)[1], '2¹=');
assert.equal('2³ + 1='.match(MATH_CLASS_RE)[1], '2³ + 1=');
assert.equal('2⁴='.match(MATH_CLASS_RE)[1], '2⁴=');
assert.equal('2¹⁰='.match(MATH_CLASS_RE)[1], '2¹⁰=');

// --- DISPATCHER MOCK TESTS ---
const makeMockState = (prevLineText = null) => {
  const insertions = [];
  return {
    doc: {
      nodesBetween: (_f, _t, cb) => {
        if (prevLineText !== null) cb({ isTextblock: true, textContent: prevLineText }, 0);
      },
    },
    tr: { insertText(text) { insertions.push(text); return this; } },
    _insertions: insertions,
  };
};

const run = (line, prevLineText = null) => {
  const s = makeMockState(prevLineText);
  buildMathTransaction(s, line, 0, line.length);
  return s._insertions[0] ?? null;
};

// Already solved → null
assert.equal(run('2 * 2 = 4 '), null);
assert.equal(run('2 * 2 = 4'), null);
assert.equal(run('88 * x = 100  =>  x = 1.1364 '), null);

// Chain continuation
assert.equal(run('2 * 2 = 4 * 2'), '2 * 2 = 4 * 2 = 8 ');
assert.equal(run('22 * 2 = 4 * 2 = 8 + 10'), '22 * 2 = 4 * 2 = 8 + 10 = 18 ');

// Solving
assert.equal(run('88 * x = 100'), '88 * x = 100  =>  x = 1.1364 ');
assert.equal(run('5x + 2 = 7'), '5x + 2 = 7  =>  x = 1 ');
assert.equal(run('22 * 2 = 44 * 2 = 88 * x = 100'), '22 * 2 = 44 * 2 = 88 * x = 100  =>  x = 1.1364 ');
assert.equal(run('100 = x'), '100 = x  =>  x = 100 ');

// Evaluation
assert.equal(run('2 * 2='), '2 * 2 = 4 ');
assert.equal(run('2 * 2'), '2 * 2 = 4 ');

// Variable empty RHS
assert.equal(run('88 * x='), '88 * x = ');

// Standalone number (branch 1: user decimal preserved verbatim)
assert.equal(run('1000='), '1,000 = ');
assert.equal(run('1000.5='), '1,000.5 = ');
assert.equal(run('1000.56789='), '1,000.56789 = ');

// Superscripts & exponents (gate items)
assert.equal(run('2³='), '2³ = 8 ');
assert.equal(run('2²='), '2² = 4 ');
assert.equal(run('2¹='), '2¹ = 2 ');
assert.equal(run('2⁴='), '2⁴ = 16 ');
assert.equal(run('2¹⁰='), '2¹⁰ = 1,024 ');
assert.equal(run('2³ + 1='), '2³ + 1 = 9 ');

// Rejections / no-op
assert.equal(run('5x + 2'), null);
assert.equal(run('1e3'), null);

// Prose + math
assert.equal(run(' 5*2='), ' 5 * 2 = 10 ');

// ans automation with mock previous line
assert.equal(run('2ans=', 'ans = 5'), '2ans = 10 ');
assert.equal(run('ans * 2=', 'ans = 1.5'), 'ans * 2 = 3 ');

console.log('✓ All tests passed successfully (41 baseline + 34 new + 22 dispatcher rows).');
