import { isPlainObject } from './types.js';

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

export function validateNodeRecord(node) {
  if (!isPlainObject(node)) return { ok: false, reason: 'node_not_object' };
  if (!isNonEmptyString(node.symbol_uid)) return { ok: false, reason: 'node_missing_symbol_uid' };
  if (!isNonEmptyString(node.node_type)) return { ok: false, reason: 'node_missing_node_type' };
  return { ok: true };
}

export function validateEdgeRecord(edge) {
  if (!isPlainObject(edge)) return { ok: false, reason: 'edge_not_object' };
  if (!isNonEmptyString(edge.source_symbol_uid)) return { ok: false, reason: 'edge_missing_source' };
  if (!isNonEmptyString(edge.target_symbol_uid)) return { ok: false, reason: 'edge_missing_target' };
  if (!isNonEmptyString(edge.edge_type)) return { ok: false, reason: 'edge_missing_type' };
  return { ok: true };
}

export function validateEdgeOccurrenceRecord(o) {
  if (!isPlainObject(o)) return { ok: false, reason: 'occ_not_object' };
  if (!isNonEmptyString(o.file_path)) return { ok: false, reason: 'occ_missing_file_path' };
  if (!Number.isInteger(o.line_start) || o.line_start <= 0) return { ok: false, reason: 'occ_bad_line_start' };
  if (!Number.isInteger(o.line_end) || o.line_end < o.line_start) return { ok: false, reason: 'occ_bad_line_end' };
  return validateEdgeRecord(o);
}

