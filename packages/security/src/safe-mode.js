import { redactSecrets } from './redact.js';

export const GraphflyMode = Object.freeze({
  DEFAULT: 'default',
  SUPPORT_SAFE: 'support_safe'
});

export function normalizeMode(mode) {
  return mode === GraphflyMode.SUPPORT_SAFE ? GraphflyMode.SUPPORT_SAFE : GraphflyMode.DEFAULT;
}

export function sanitizeNodeForMode(node, mode) {
  const m = normalizeMode(mode);

  // Never return code bodies/snippets in any mode.
  // Also avoid leaking docstrings in support-safe mode (can contain secrets).
  const safe = {
    symbolUid: node.symbol_uid,
    qualifiedName: node.qualified_name ?? null,
    name: node.name ?? null,
    nodeType: node.node_type,
    symbolKind: node.symbol_kind ?? null,
    containerUid: node.container_uid ?? null,
    exportedName: node.exported_name ?? null,
    language: node.language ?? null,
    visibility: node.visibility ?? null,
    signature: node.signature ?? null,
    signatureHash: node.signature_hash ?? null,
    contract: node.contract ?? null,
    constraints: node.constraints ?? null,
    allowableValues: node.allowable_values ?? null,
    externalRef: node.external_ref ?? null,
    location: node.file_path
      ? { filePath: node.file_path, lineStart: node.line_start ?? null, lineEnd: node.line_end ?? null }
      : null
  };

  if (m === GraphflyMode.DEFAULT) {
    // In default mode we still redact secrets in docstrings if included later.
    if (typeof node.docstring === 'string' && node.docstring.length) safe.docstring = redactSecrets(node.docstring);
  }

  return safe;
}
