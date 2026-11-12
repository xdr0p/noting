// @ts-check
import { Parser } from 'expr-eval';

export const mathParser = new Parser();

export const SUPERSCRIPT_CHARS = '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾';

/** @type {Record<string, string>} */
const SUPERSCRIPT_MAP = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁺': '+', '⁻': '-', '⁽': '(', '⁾': ')',
};

/** @type {Record<string, string>} */
const TO_SUPERSCRIPT_MAP = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '(': '⁽', ')': '⁾',
};

/**
 * @param {string|number} value
 * @returns {string}
 */
export const toSuperscript = (value) =>
  String(value).split('').map((char) => TO_SUPERSCRIPT_MAP[char] ?? char).join('');

/**
 * @param {string} value
 * @returns {string}
 */
export const fromSuperscript = (value) =>
  String(value).split('').map((char) => SUPERSCRIPT_MAP[char] ?? char).join('');

/**
 * @param {string} expression
 * @returns {string}
 */
export const makeExponentsPretty = (expression) =>
  expression.replace(/(\d+|\))\s*\^\s*(-?[0-9]+)/g, (_match, base, exponent) =>
    `${base}${toSuperscript(exponent)}`);

/**
 * @param {string} expression
 * @returns {string}
 */
export const normalizeSuperscriptForMath = (expression) => {
  const superscriptRun = new RegExp(`(\\d+|\\))([${SUPERSCRIPT_CHARS}]+)`, 'g');
  return expression.replace(superscriptRun, (_match, base, exponent) => {
    const normalExponent = fromSuperscript(exponent);
    return `${base}^${normalExponent.startsWith('-') ? `(${normalExponent})` : normalExponent}`;
  });
};

/**
 * Locale-pinned: getPreviousLineResult parses this output back (dot-decimal required).
 * @param {number} n
 * @returns {string}
 */
export const formatNumber = (n) =>
  n.toLocaleString('en-US', { maximumFractionDigits: 4 });

/**
 * @param {string} expression
 * @param {number|null} [prevResult]
 * @returns {string|null}
 */
export const buildMathExpression = (expression, prevResult) => {
  let expr = expression.replace(/,/g, '').replace(/\s+/g, '');
  if (/(?<![a-zA-Z])ans(?![a-zA-Z])/i.test(expr)) {
    const valStr = prevResult != null ? String(prevResult) : '0';
    expr = expr.replace(/(?<![a-zA-Z])ans(?![a-zA-Z])/gi, `(${valStr})`);
  }
  const normalized = normalizeSuperscriptForMath(expr)
    .replace(/\^(-?[0-9]+(?:\.[0-9]+)?)/g, (_m, e) => `^${e.startsWith('-') ? `(${e})` : e}`)
    .replace(/\*\*/g, '^')
    .replace(/\)\s*\(/g, ')*(')
    .replace(/(\d)\s*\(/g, '$1*(')
    .replace(/\)\s*(\d)/g, ')*$1');
  if (/[^0-9+\-*/.()^]/.test(normalized)) return null;
  return normalized;
};

export const SUPERSCRIPT_RE = new RegExp(`[${SUPERSCRIPT_CHARS}]`);

/**
 * @param {string} expr
 * @returns {boolean}
 */
export const isMathProblem = (expr) => {
  const trimmed = expr.trim();
  if (!trimmed) return false;
  if (/[\+\-\*\/\^]/.test(trimmed)) return true;
  if (/ans/i.test(trimmed)) return true;
  if (SUPERSCRIPT_RE.test(trimmed)) return true;
  return false;
};

/**
 * @param {string} str
 * @returns {string|null}
 */
export const findVariable = (str) => {
  const cleaned = str.replace(/(?<![a-zA-Z])ans(?![a-zA-Z])/gi, '0');
  const letterRe = /(?<![a-zA-Z])([a-zA-Z])(?![a-zA-Z])/g;
  let m;
  while ((m = letterRe.exec(cleaned)) !== null) {
    if ('xyzXYZ'.includes(m[1])) return m[1];
  }
  letterRe.lastIndex = 0;
  while ((m = letterRe.exec(cleaned)) !== null) {
    const letter = m[1];
    if (letter === 'e' || letter === 'E') {
      if (/\d/.test(cleaned[m.index - 1]) && /\d/.test(cleaned[m.index + 1])) continue;
    }
    return letter;
  }
  return null;
};

/**
 * @param {string} eqStr
 * @returns {{ variable: string, value: number }|null}
 */
export const solveLinearEquation = (eqStr) => {
  const parts = eqStr.split('=').map(s => s.trim()).filter(s => s.length > 0);
  if (parts.length < 2) return null;
  const left = parts[parts.length - 2];
  const right = parts[parts.length - 1];
  const variable = findVariable(left + ' ' + right);
  if (!variable) return null;

  /** @type {(exprStr: string, varVal: number) => number} */
  const evalSide = (exprStr, varVal) => {
    const withImplicit = exprStr
      .replace(new RegExp(`(\\d)\\s*${variable}\\b`, 'gi'), `$1*(${varVal})`)
      .replace(new RegExp(`\\b${variable}\\b`, 'gi'), `(${varVal})`);
    const clean = buildMathExpression(withImplicit);
    if (!clean) throw new Error('unparseable');
    return mathParser.parse(clean).evaluate();
  };

  try {
    const f = (/** @type {number} */ v) => evalSide(left, v) - evalSide(right, v);
    const f0 = f(0), f1 = f(1);
    const slope = f1 - f0;
    if (Math.abs(slope) < 1e-9) return null;
    const sol = -f0 / slope;
    if (!Number.isFinite(sol)) return null;
    const tol = Math.max(1e-4, Math.abs(f0) * 1e-6);
    if (Math.abs(f(sol)) > tol) return null;
    return { variable, value: Math.round(sol * 10000) / 10000 };
  } catch { return null; }
};

/**
 * @param {string} expr
 * @returns {string}
 */
export const formatMathSide = (expr) => {
  return makeExponentsPretty(expr.replace(/,/g, '').replace(/\s+/g, ''))
    .replace(/([0-9a-zA-Z\)\u00B9\u00B2\u00B3\u2070-\u207F])([\+\-\*\/])/g, '$1 $2 ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * @param {string} eqStr
 * @returns {string}
 */
export const formatEquation = (eqStr) => {
  return eqStr.split('=').map(side => formatMathSide(side)).join(' = ');
};

/**
 * @param {string} expression
 * @returns {string}
 */
export const formatMathExpression = (expression) => formatMathSide(expression);

/**
 * @param {any} doc
 * @param {number} pos
 * @returns {number|null}
 */
export const getPreviousLineResult = (doc, pos) => {
  let prevResult = null;
  doc.nodesBetween(0, pos, (/** @type {any} */ node) => {
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

/**
 * @typedef {Object} ParsedMathLine
 * @property {string} leadingSpaces
 * @property {string} chainPrefixSolve
 * @property {string} chainPrefixEval
 * @property {string|null} left
 * @property {string|null} right
 * @property {boolean} hasEquals
 * @property {boolean} emptyRHS
 * @property {boolean} hasVariable
 * @property {boolean} isSolvableEquation
 * @property {boolean} isStandaloneNumber
 */

/**
 * @param {string} line
 * @returns {ParsedMathLine|null}
 */
export const parseMathLine = (line) => {
  if (line.includes('=>')) return null;

  const leadingSpaces = line.match(/^\s*/)?.[0] ?? '';
  const segments = line.split('=');
  const lastSeg = segments[segments.length - 1];
  const emptyRHS = lastSeg.trim().length === 0;

  /** @type {string|null} */ let left = null;
  /** @type {string|null} */ let right = null;
  let chainPrefixSolve = '', chainPrefixEval = '';

  if (segments.length === 1) {
    left = segments[0].trim();
  } else if (emptyRHS) {
    const active = segments.slice(0, -1);
    left = active[active.length - 1].trim();
    const lastEq = line.lastIndexOf('=');
    const prevEq = line.lastIndexOf('=', lastEq - 1);
    if (prevEq !== -1) chainPrefixSolve = line.substring(0, prevEq + 1) + ' ';
  } else {
    left = segments[segments.length - 2].trim();
    right = lastSeg.trim();
    const lastEq = line.lastIndexOf('=');
    const prevEq = line.lastIndexOf('=', lastEq - 1);
    if (prevEq !== -1) chainPrefixSolve = line.substring(0, prevEq + 1) + ' ';
    chainPrefixEval = line.substring(0, lastEq + 1) + ' ';
  }

  const sideText = [left, right].filter(Boolean).join(' ');
  const hasVariable = findVariable(sideText) !== null;
  const isStandaloneNumber = !hasVariable && left !== null && /^\d+(\.\d+)?$/.test(left);
  const isSolvableEquation = !emptyRHS && hasVariable && segments.length >= 2;

  return { leadingSpaces, chainPrefixSolve, chainPrefixEval, left, right,
           hasEquals: segments.length >= 2, emptyRHS, hasVariable,
           isSolvableEquation, isStandaloneNumber };
};

/**
 * @param {any} state
 * @param {string} mathLine
 * @param {number} from
 * @param {number} to
 * @returns {any}
 */
export const buildMathTransaction = (state, mathLine, from, to) => {
  const parsed = parseMathLine(mathLine);
  if (!parsed) return null;

  const { leadingSpaces, chainPrefixSolve, chainPrefixEval, left, right,
          hasEquals, emptyRHS, hasVariable, isSolvableEquation,
          isStandaloneNumber } = parsed;

  if (left === null) return null;

  // 1. Standalone number: '1000=' → '1,000 = '
  //    decPart is preserved verbatim — user-typed decimals are not truncated
  //    to 4 dp. Only computed values (branches 3, 4, 5) truncate.
  if (isStandaloneNumber && emptyRHS) {
    const [intPart, decPart] = left.split('.');
    const formatted = decPart !== undefined
      ? `${formatNumber(Number(intPart))}.${decPart}`
      : formatNumber(Number(intPart));
    return state.tr.insertText(
      `${leadingSpaces}${chainPrefixSolve}${formatted} = `, from, to);
  }

  // 2. Variable, empty RHS → wait for RHS
  if (hasVariable && emptyRHS) {
    return state.tr.insertText(
      `${leadingSpaces}${chainPrefixSolve}${formatMathSide(left)} = `, from, to);
  }

  // 3. Solvable equation
  if (isSolvableEquation && right !== null) {
    const eqStr = `${left} = ${right}`;
    const sol = solveLinearEquation(eqStr);
    if (!sol) return null;
    return state.tr.insertText(
      `${leadingSpaces}${chainPrefixSolve}${formatEquation(eqStr)}  =>  ${sol.variable} = ${formatNumber(sol.value)} `,
      from, to);
  }

  // 4. Evaluation — empty RHS or no '='
  if ((emptyRHS || !hasEquals) && isMathProblem(left)) {
    const prevResult = getPreviousLineResult(state.doc, from);
    try {
      const clean = buildMathExpression(left, prevResult);
      if (!clean) return null;
      const result = mathParser.parse(clean).evaluate();
      if (!Number.isFinite(result)) return null;
      const rounded = Math.round(result * 10000) / 10000;
      return state.tr.insertText(
        `${leadingSpaces}${chainPrefixSolve}${formatMathSide(left)} = ${formatNumber(rounded)} `,
        from, to);
    } catch { return null; }
  }

  // 5. Chain continuation — RHS is itself a math problem
  if (!emptyRHS && right !== null && !hasVariable && isMathProblem(right)) {
    const prevResult = getPreviousLineResult(state.doc, from);
    try {
      const clean = buildMathExpression(right, prevResult);
      if (!clean) return null;
      const result = mathParser.parse(clean).evaluate();
      if (!Number.isFinite(result)) return null;
      const rounded = Math.round(result * 10000) / 10000;
      return state.tr.insertText(
        `${leadingSpaces}${chainPrefixEval}${formatMathSide(right)} = ${formatNumber(rounded)} `,
        from, to);
    } catch { return null; }
  }

  // 6. Already solved → null → Enter inserts a newline
  return null;
};

export const MATH_CLASS_SRC = '[0-9a-zA-Z+\\-*/^.,()\\s\\u00B9\\u00B2\\u00B3\\u2070-\\u207F=]';
export const MATH_CLASS_RE = new RegExp(`(${MATH_CLASS_SRC}+)$`);
export const MATH_FIND_RE  = new RegExp(`(${MATH_CLASS_SRC}+)=$`);
