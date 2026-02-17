function mdEscapeInline(text) {
  return String(text ?? '').replaceAll('\n', ' ').trim();
}

function trimInline(text, maxLen = 240) {
  const s = mdEscapeInline(text);
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}…`;
}

function mdJsonInline(value) {
  try {
    return mdEscapeInline(JSON.stringify(value));
  } catch {
    return mdEscapeInline(String(value));
  }
}

function renderParamList(params) {
  if (!Array.isArray(params) || params.length === 0) return '';
  const lines = ['### Parameters'];
  for (const p of params.slice(0, 50)) {
    const name = mdEscapeInline(p?.name ?? '');
    if (!name) continue;
    const type = p?.type ? `: \`${mdEscapeInline(p.type)}\`` : '';
    const optional = p?.optional ? ' (optional)' : '';
    const desc = p?.description ? ` — ${trimInline(p.description, 280)}` : '';
    lines.push(`- **${name}**${optional}${type}${desc}`);
  }
  return lines.join('\n');
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
    parameters,
    returnType,
    docstring,
    contract,
    constraints,
    allowableValues,
    location
  } = contractGetResult ?? {};

  const title = qualifiedName ? mdEscapeInline(qualifiedName) : mdEscapeInline(symbolUid);
  const evidence = location?.filePath
    ? `Evidence: \`${mdEscapeInline(location.filePath)}:${Number(location.lineStart ?? 1)}-${Number(location.lineEnd ?? location.lineStart ?? 1)}\``
    : 'Evidence: (missing location)';

  const summary = contract?.description ?? docstring ?? null;
  const paramList =
    contract?.kind === 'class'
      ? contract?.constructor?.parameters ?? null
      : contract?.parameters ?? parameters ?? null;
  const returnsType = contract?.returns?.type ?? returnType ?? null;

  const parts = [];
  parts.push(`## ${title}`);
  parts.push('');
  parts.push(`- **Symbol UID:** \`${mdEscapeInline(symbolUid)}\``);
  if (signature) parts.push(`- **Signature:** \`${mdEscapeInline(signature)}\``);
  if (returnsType) parts.push(`- **Return Type:** \`${mdEscapeInline(returnsType)}\``);
  if (summary) parts.push(`- **Docstring:** ${trimInline(summary, 320)}`);
  parts.push(`- **${evidence}**`);
  parts.push('');

  const paramsMd = renderParamList(paramList);
  if (paramsMd) parts.push(paramsMd, '');
  if (contract) parts.push(renderKvList('Contract', contract), '');
  if (constraints) parts.push(renderKvList('Constraints', constraints), '');
  if (allowableValues) parts.push(renderKvList('Allowable Values', allowableValues), '');

  // Safety invariant: never emit code fences or inline code bodies.
  const out = parts.join('\n').trimEnd() + '\n';
  return out.replaceAll('```', '``\\`');
}
