import path from 'node:path';
import { computeSignatureHash, makeSymbolUid } from '../../../../cig/src/identity.js';
import { embedText384 } from '../../../../cig/src/embedding.js';

function parseImports(lines) {
  const imports = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^\s*import\s+(.+?)\s+from\s+['"](.+?)['"]\s*;?\s*$/);
    if (!m) continue;
    const binding = m[1];
    const spec = m[2];
    const names = [];
    const named = binding.match(/\{([^}]+)\}/);
    if (named) {
      for (const part of named[1].split(',')) {
        const n = part.trim().split(/\s+as\s+/i)[0]?.trim();
        if (n) names.push(n);
      }
    } else {
      const def = binding.trim().split(',')[0]?.trim();
      if (def && def !== '*') names.push(def);
    }
    imports.push({ spec, names, line: i + 1 });
  }
  return imports;
}

function parseExpressRoutes(lines) {
  const routes = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/\bapp\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/);
    if (m) routes.push({ method: m[1].toUpperCase(), path: m[2], line: i + 1 });
  }
  return routes;
}

function resolveImport(fromFileRel, spec, sourceFileExists = null) {
  if (!spec.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFileRel), spec));
  if (base.endsWith('.ts') || base.endsWith('.tsx') || base.endsWith('.js') || base.endsWith('.jsx')) return base;
  const exts = ['.ts', '.tsx', '.js', '.jsx'];
  const candidates = [];
  for (const ext of exts) candidates.push(`${base}${ext}`);
  for (const ext of exts) candidates.push(`${base}/index${ext}`);
  if (typeof sourceFileExists === 'function') {
    for (const c of candidates) {
      if (sourceFileExists(c)) return c;
    }
  }
  return candidates[0] ?? null;
}

function packageNameFromImport(spec) {
  if (!spec || spec.startsWith('.') || spec.startsWith('/')) return null;
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec;
  }
  return spec.split('/')[0];
}

function ensurePackageNode({ packageKey, sha, packageToUid }) {
  if (!packageKey) return null;
  if (packageToUid?.has?.(packageKey)) return { uid: packageToUid.get(packageKey), node: null };
  const [ecosystem, ...rest] = String(packageKey).split(':');
  const name = rest.join(':');
  const qualifiedName = `${ecosystem}:${name}`;
  const signature = `package ${qualifiedName}`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language: 'pkg', qualifiedName, signatureHash });
  const node = {
    symbol_uid: symbolUid,
    qualified_name: qualifiedName,
    name,
    node_type: 'Package',
    symbol_kind: 'package',
    file_path: '',
    line_start: 1,
    line_end: 1,
    language: 'external',
    visibility: 'public',
    signature,
    signature_hash: signatureHash,
    contract: null,
    constraints: null,
    allowable_values: null,
    external_ref: { ecosystem, name },
    first_seen_sha: sha ?? 'mock',
    last_seen_sha: sha ?? 'mock'
  };
  packageToUid?.set?.(packageKey, symbolUid);
  return { uid: symbolUid, node };
}

function findJsDocBlock(lines, i) {
  const maxLookback = 40;
  let end = -1;
  for (let j = i - 1; j >= 0 && i - j <= maxLookback; j--) {
    if (lines[j].includes('*/')) {
      end = j;
      break;
    }
    if (lines[j].trim() !== '' && !lines[j].trim().startsWith('*') && !lines[j].trim().startsWith('//')) {
      break;
    }
  }
  if (end < 0) return null;

  let start = -1;
  for (let j = end; j >= 0 && i - j <= maxLookback; j--) {
    if (lines[j].includes('/**')) {
      start = j;
      break;
    }
  }
  if (start < 0) return null;
  return lines.slice(start, end + 1);
}

function parseJsDoc(jsdocLines) {
  if (!Array.isArray(jsdocLines) || jsdocLines.length === 0) return null;
  const clean = jsdocLines
    .map((l) => l.trim().replace(/^\/\*\*\s?/, '').replace(/\*\/\s?$/, '').replace(/^\*\s?/, '').trim())
    .filter((l) => l.length > 0);

  const params = new Map();
  const constraints = Object.create(null);
  const allowableValues = Object.create(null);
  let returnsType = null;
  const descLines = [];

  for (const line of clean) {
    if (line.startsWith('@param')) {
      const m = line.match(/^@param\s+\{([^}]+)\}\s+(\[[^\]]+\]|[A-Za-z0-9_$]+)(?:\s*-\s*(.*))?$/);
      if (m) {
        const type = m[1].trim();
        let name = m[2].trim();
        const optional = name.startsWith('[') && name.endsWith(']');
        if (optional) name = name.slice(1, -1);
        const description = (m[3] ?? '').trim() || null;
        params.set(name, { type, optional, description });

        const values = [];
        for (const mm of type.matchAll(/'([^']+)'|\"([^\"]+)\"/g)) {
          const v = mm[1] ?? mm[2];
          if (v) values.push(v);
        }
        if (values.length > 0) allowableValues[name] = values;
      }
      continue;
    }
    if (line.startsWith('@returns')) {
      const m = line.match(/^@returns\s+\{([^}]+)\}/);
      if (m) returnsType = m[1].trim();
      continue;
    }
    if (line.startsWith('@min') || line.startsWith('@max') || line.startsWith('@pattern')) {
      const m = line.match(/^@(min|max|pattern)\s+([A-Za-z0-9_$]+)\s+(.+?)\s*$/);
      if (m) {
        const kind = m[1];
        const name = m[2];
        const value = m[3];
        if (!constraints[name]) constraints[name] = {};
        if (kind === 'min' || kind === 'max') {
          const n = Number(value);
          if (Number.isFinite(n)) constraints[name][kind] = n;
        } else {
          constraints[name].pattern = value;
        }
      }
      continue;
    }
    if (!line.startsWith('@')) descLines.push(line);
  }

  const description = descLines.length > 0 ? descLines.join(' ').trim() : null;
  return { description, params, returnsType, constraints, allowableValues };
}

function parseParamNames(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return [];
  return s
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => p.replace(/=.*$/g, '').trim())
    .map((p) => p.replace(/^\.\.\./, '').trim())
    .filter((p) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(p));
}

function parseExportedDecls(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fm = line.match(/^\s*export\s+function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)/);
    if (fm) {
      out.push({
        kind: 'function',
        name: fm[1],
        paramsRaw: fm[2],
        line: i + 1,
        jsdoc: parseJsDoc(findJsDocBlock(lines, i))
      });
      continue;
    }
    const cm = line.match(/^\s*export\s+class\s+([A-Za-z0-9_$]+)/);
    if (cm) {
      out.push({
        kind: 'class',
        name: cm[1],
        paramsRaw: '',
        line: i + 1,
        jsdoc: parseJsDoc(findJsDocBlock(lines, i))
      });
    }
  }
  return out;
}

function makeApiEndpointNode({ method, routePath, filePath, line, sha, containerUid = null }) {
  const qualifiedName = `http.${method}.${routePath}`;
  const signature = `${method} ${routePath}`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language: 'http', qualifiedName, signatureHash });
  return {
    symbol_uid: symbolUid,
    qualified_name: qualifiedName,
    name: signature,
    node_type: 'ApiEndpoint',
    symbol_kind: 'api_endpoint',
    container_uid: containerUid,
    file_path: filePath,
    line_start: line,
    line_end: line,
    language: 'http',
    visibility: 'public',
    signature,
    signature_hash: signatureHash,
    contract: { kind: 'http_route', method, path: routePath },
    constraints: null,
    allowable_values: null,
    embedding_text: `${signature} endpoint`,
    embedding: embedText384(`${signature} endpoint`),
    first_seen_sha: sha ?? 'mock',
    last_seen_sha: sha ?? 'mock'
  };
}

function makeExportedSymbolNode({ kind, name, params, jsdoc, filePath, line, sha, language = 'js', containerUid = null }) {
  const qualifiedName = `${filePath}::${name}`;
  const paramNames = params.length > 0 ? params : Array.from(jsdoc?.params?.keys?.() ?? []);
  const signature = kind === 'class' ? `class ${name}` : `function ${name}(${paramNames.join(', ')})`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language, qualifiedName, signatureHash });

  const parameters = paramNames.map((p) => {
    const info = jsdoc?.params?.get?.(p) ?? null;
    return { name: p, type: info?.type ?? null, optional: Boolean(info?.optional) || undefined, description: info?.description ?? null };
  });

  const contract =
    kind === 'class'
      ? { kind: 'class', name, constructor: { parameters } }
      : { kind: 'function', name, parameters, returns: jsdoc?.returnsType ? { type: jsdoc.returnsType } : null, description: jsdoc?.description ?? null };

  const constraints = jsdoc?.constraints && Object.keys(jsdoc.constraints).length > 0 ? jsdoc.constraints : null;
  const allowableValues = jsdoc?.allowableValues && Object.keys(jsdoc.allowableValues).length > 0 ? jsdoc.allowableValues : null;
  const embeddingText = `${qualifiedName} ${signature} ${jsdoc?.description ?? ''}`.trim();

  return {
    symbol_uid: symbolUid,
    qualified_name: qualifiedName,
    name,
    node_type: kind === 'class' ? 'Class' : 'Function',
    symbol_kind: kind === 'class' ? 'class' : 'function',
    container_uid: containerUid,
    file_path: filePath,
    line_start: line,
    line_end: line,
    language,
    visibility: 'public',
    signature,
    signature_hash: signatureHash,
    parameters,
    contract,
    constraints,
    allowable_values: allowableValues,
    embedding_text: embeddingText,
    embedding: embedText384(embeddingText),
    first_seen_sha: sha ?? 'mock',
    last_seen_sha: sha ?? 'mock'
  };
}

export function* parseJsFile({ filePath, lines, sha, containerUid, exportedByFile, packageToUid, sourceFileExists = null, resolveAliasImport = null }) {
  const language = filePath.endsWith('.ts') || filePath.endsWith('.tsx') ? 'ts' : 'js';
  const sourceUid = containerUid ?? null;

  const decls = parseExportedDecls(lines);
  if (decls.length > 0) {
    const byName = new Map();
    for (const d of decls) {
      const params = parseParamNames(d.paramsRaw);
      const node = makeExportedSymbolNode({ kind: d.kind, name: d.name, params, jsdoc: d.jsdoc, filePath, line: d.line, sha, language, containerUid: sourceUid });
      byName.set(d.name, node.symbol_uid);
      yield { type: 'node', data: node };
      yield {
        type: 'edge',
        data: {
          source_symbol_uid: sourceUid,
          target_symbol_uid: node.symbol_uid,
          edge_type: 'Defines',
          metadata: { kind: d.kind },
          first_seen_sha: sha,
          last_seen_sha: sha
        }
      };
      yield {
        type: 'edge_occurrence',
        data: {
          source_symbol_uid: sourceUid,
          target_symbol_uid: node.symbol_uid,
          edge_type: 'Defines',
          file_path: filePath,
          line_start: d.line,
          line_end: d.line,
          occurrence_kind: 'other',
          sha
        }
      };
    }
    exportedByFile.set(filePath, byName);
  }

  for (const r of parseExpressRoutes(lines)) {
    const ep = makeApiEndpointNode({ method: r.method, routePath: r.path, filePath, line: r.line, sha, containerUid: sourceUid });
    yield { type: 'node', data: ep };
    yield {
      type: 'edge',
      data: {
        source_symbol_uid: sourceUid,
        target_symbol_uid: ep.symbol_uid,
        edge_type: 'Defines',
        metadata: { kind: 'api_endpoint' },
        first_seen_sha: sha,
        last_seen_sha: sha
      }
    };
    yield {
      type: 'edge_occurrence',
      data: {
        source_symbol_uid: sourceUid,
        target_symbol_uid: ep.symbol_uid,
        edge_type: 'Defines',
        file_path: filePath,
        line_start: r.line,
        line_end: r.line,
        occurrence_kind: 'route_map',
        sha
      }
    };

    yield {
      type: 'edge',
      data: {
        source_symbol_uid: ep.symbol_uid,
        target_symbol_uid: sourceUid,
        edge_type: 'ControlFlow',
        metadata: { kind: 'route_handler_file' },
        first_seen_sha: sha,
        last_seen_sha: sha
      }
    };

    yield {
      type: 'flow_entrypoint',
      data: {
        entrypoint_key: `http:${r.method}:${r.path}`,
        entrypoint_type: 'http_route',
        method: r.method,
        path: r.path,
        symbol_uid: ep.symbol_uid,
        entrypoint_symbol_uid: ep.symbol_uid,
        file_path: filePath,
        line_start: r.line,
        line_end: r.line,
        sha
      }
    };
  }

  for (const imp of parseImports(lines)) {
    const aliasResolved = typeof resolveAliasImport === 'function' ? resolveAliasImport(imp.spec) : null;
    const resolved = aliasResolved || resolveImport(filePath, imp.spec, sourceFileExists);
    if (resolved) {
      const targetLanguage = resolved.endsWith('.ts') || resolved.endsWith('.tsx') ? 'ts' : 'js';
      const targetUid = makeSymbolUid({
        language: targetLanguage,
        qualifiedName: resolved.replaceAll('/', '.'),
        signatureHash: computeSignatureHash({ signature: `file ${resolved}` })
      });
      yield {
        type: 'edge',
        data: {
          source_symbol_uid: sourceUid,
          target_symbol_uid: targetUid,
          edge_type: 'Imports',
          metadata: { spec: imp.spec },
          first_seen_sha: sha,
          last_seen_sha: sha
        }
      };
      yield {
        type: 'edge_occurrence',
        data: {
          source_symbol_uid: sourceUid,
          edge_type: 'Imports',
          target_symbol_uid: targetUid,
          file_path: filePath,
          line_start: imp.line,
          line_end: imp.line,
          occurrence_kind: 'import',
          sha
        }
      };
    }

    const pkgName = packageNameFromImport(imp.spec);
    if (pkgName) {
      const packageKey = `npm:${pkgName}`;
      const ensured = ensurePackageNode({ packageKey, sha, packageToUid });
      if (ensured?.node) yield { type: 'node', data: ensured.node };
      const pkgUid = ensured?.uid ?? null;
      if (!pkgUid) continue;
      yield {
        type: 'observed_dependency',
        data: { source_symbol_uid: sourceUid, file_path: filePath, sha, package_key: packageKey, evidence: { import_spec: imp.spec, line: imp.line } }
      };
      yield {
        type: 'edge',
        data: {
          source_symbol_uid: sourceUid,
          target_symbol_uid: pkgUid,
          edge_type: 'UsesPackage',
          metadata: { import_spec: imp.spec },
          first_seen_sha: sha,
          last_seen_sha: sha
        }
      };
      yield {
        type: 'edge_occurrence',
        data: {
          source_symbol_uid: sourceUid,
          target_symbol_uid: pkgUid,
          edge_type: 'UsesPackage',
          file_path: filePath,
          line_start: imp.line,
          line_end: imp.line,
          occurrence_kind: 'use',
          sha
        }
      };
    }
  }
}
