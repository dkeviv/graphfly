function mdEscapeInline(text) {
  return String(text ?? '').replaceAll('\n', ' ').trim();
}

function mdJsonInline(value) {
  try {
    return mdEscapeInline(JSON.stringify(value));
  } catch {
    return mdEscapeInline(String(value));
  }
}

function renderKvList(title, obj) {
  if (!obj || typeof obj !== 'object') return '';
  const keys = Object.keys(obj);
  if (keys.length === 0) return '';
  const lines = [`### ${title}`];
  for (const k of keys.sort()) {
    lines.push(`- **${mdEscapeInline(k)}**: ${mdJsonInline(obj[k])}`);
  }
  return lines.join('\n');
}

export function renderContractDocBlock(contractGetResult) {
  const {
    symbolUid,
    qualifiedName,
    signature,
    contract,
    constraints,
    allowableValues,
    location
  } = contractGetResult ?? {};

  const title = qualifiedName ? mdEscapeInline(qualifiedName) : mdEscapeInline(symbolUid);
  const evidence = location?.filePath
    ? `Evidence: \`${mdEscapeInline(location.filePath)}:${Number(location.lineStart ?? 1)}\``
    : 'Evidence: (missing location)';

  const parts = [];
  parts.push(`## ${title}`);
  parts.push('');
  parts.push(`- **Symbol UID:** \`${mdEscapeInline(symbolUid)}\``);
  if (signature) parts.push(`- **Signature:** \`${mdEscapeInline(signature)}\``);
  parts.push(`- **${evidence}**`);
  parts.push('');
  if (contract) parts.push(renderKvList('Contract', contract), '');
  if (constraints) parts.push(renderKvList('Constraints', constraints), '');
  if (allowableValues) parts.push(renderKvList('Allowable Values', allowableValues), '');

  // Safety invariant: never emit code fences or inline code bodies.
  const out = parts.join('\n').trimEnd() + '\n';
  return out.replaceAll('```', '``\\`');
}

