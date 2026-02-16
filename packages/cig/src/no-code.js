import { isPlainObject } from './types.js';

const REDACTED = '[REDACTED_CODE_LIKE]';

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function hasCodeFence(s) {
  if (!isNonEmptyString(s)) return false;
  return /(^|\n)\s{0,3}(```|~~~)/.test(s);
}

function looksLikeCodeBody(s) {
  const str = String(s ?? '');
  if (!isNonEmptyString(str)) return false;
  if (hasCodeFence(str)) return true;
  // Heuristic: long, code-dense single-line or multi-line payload.
  const lines = str.split('\n');
  const first = (lines[0] ?? '').trim();
  if (first.length < 80) return false;
  const braces = (first.match(/[{}]/g) ?? []).length;
  const semis = (first.match(/;/g) ?? []).length;
  const arrows = (first.match(/=>/g) ?? []).length;
  const keywords = (first.match(/\b(function|class|return|import|from|def|public|private|const|let|var)\b/g) ?? []).length;
  const operators = (first.match(/[=:+*\/<>]/g) ?? []).length;
  if (arrows >= 1) return true;
  if (braces >= 2 && keywords >= 1) return true;
  if (semis >= 2) return true;
  return keywords >= 2 && operators >= 6;
}

function sanitizeString(s, { maxLen = 2000 } = {}) {
  if (!isNonEmptyString(s)) return s;
  if (looksLikeCodeBody(s)) return REDACTED;
  // Never persist multi-line text fields; keep a compact summary only.
  const firstLine = String(s).split('\n')[0] ?? '';
  const trimmed = firstLine.trim();
  if (trimmed.length === 0) return '';
  if (trimmed.length > maxLen) return `${trimmed.slice(0, maxLen)}…`;
  return trimmed;
}

function sanitizeDeep(value, depth = 0) {
  if (depth > 6) return null;
  if (typeof value === 'string') return sanitizeString(value);
  if (Array.isArray(value)) {
    const out = [];
    for (let i = 0; i < Math.min(value.length, 200); i++) out.push(sanitizeDeep(value[i], depth + 1));
    return out;
  }
  if (isPlainObject(value)) {
    const out = {};
    const keys = Object.keys(value);
    for (let i = 0; i < Math.min(keys.length, 200); i++) {
      const k = keys[i];
      out[k] = sanitizeDeep(value[k], depth + 1);
    }
    return out;
  }
  return value;
}

export function sanitizeNodeForPersistence(node) {
  if (!isPlainObject(node)) return node;
  const out = { ...node };
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === 'string') out[k] = sanitizeString(v);
  }
  // Deep sanitize structured fields that may carry user/authored text.
  if (out.parameters) out.parameters = sanitizeDeep(out.parameters);
  if (out.contract) out.contract = sanitizeDeep(out.contract);
  if (out.constraints) out.constraints = sanitizeDeep(out.constraints);
  if (out.allowable_values) out.allowable_values = sanitizeDeep(out.allowable_values);
  if (out.external_ref) out.external_ref = sanitizeDeep(out.external_ref);
  return out;
}

export function sanitizeEdgeForPersistence(edge) {
  if (!isPlainObject(edge)) return edge;
  const out = { ...edge };
  if (out.metadata) out.metadata = sanitizeDeep(out.metadata);
  return out;
}

export function sanitizeAnnotationForPersistence(annotation) {
  if (!isPlainObject(annotation)) return annotation;
  const out = { ...annotation };
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === 'string') out[k] = sanitizeString(v);
  }
  if (out.payload) out.payload = sanitizeDeep(out.payload);
  return out;
}

export function isRedactedCodeLike(value) {
  return value === REDACTED;
}
