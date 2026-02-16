import path from 'node:path';
import { computeSignatureHash, makeSymbolUid } from '../../../../cig/src/identity.js';
import { treesitterLanguageForFilePath, TREE_SITTER_LANGUAGE_CONFIG } from './languages.js';
import { loadTreeSitterLanguage, loadTreeSitterRuntime } from './runtime.js';

function posixPath(p) {
  return String(p ?? '').replaceAll('\\', '/');
}

function nodeText(text, node) {
  if (!node) return '';
  return String(text ?? '').slice(node.startIndex, node.endIndex);
}

function nodeLine(node) {
  const row = node?.startPosition?.row ?? 0;
  return row + 1;
}

function safeName(s) {
  const t = String(s ?? '').trim();
  if (!t) return null;
  if (t.length > 300) return t.slice(0, 300);
  return t;
}

function packageNameFromImport(spec) {
  if (!spec || spec.startsWith('.') || spec.startsWith('/')) return null;
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec;
  }
  return spec.split('/')[0];
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
    first_seen_sha: sha ?? 'mock',
    last_seen_sha: sha ?? 'mock'
  };
}

function parseExpressRoutes(lines) {
  const routes = [];
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] ?? '').trim();
    const m = line.match(/\b(?:app|router)\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/);
    if (m) routes.push({ method: m[1].toUpperCase(), path: m[2], line: i + 1 });
  }
  return routes;
}

function parseCronEntrypoints(lines) {
  const crons = [];
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] ?? '').trim();
    const m = line.match(/\bcron\.schedule\(\s*['"]([^'"]+)['"]/);
    if (m) crons.push({ schedule: m[1], line: i + 1 });
  }
  return crons;
}

function parseQueueConsumers(lines) {
  const qs = [];
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] ?? '').trim();
    const m = line.match(/\b(?:queue|bull|bullmq)\.(?:process|add)\(\s*['"]([^'"]+)['"]/);
    if (m) qs.push({ name: m[1], line: i + 1 });
  }
  return qs;
}

function parseFastApiRoutes(lines) {
  const routes = [];
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] ?? '').trim();
    const m = line.match(/^@(?:app|router)\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/);
    if (m) routes.push({ method: m[1].toUpperCase(), path: m[2], line: i + 1 });
  }
  return routes;
}

function parseFlaskRoutes(lines) {
  const routes = [];
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] ?? '').trim();
    const m = line.match(/^@(?:app|bp|blueprint)\.route\(\s*['"]([^'"]+)['"]\s*(?:,\s*(.+))?\)/);
    if (!m) continue;
    const routePath = m[1];
    const rest = m[2] ?? '';
    const methodM = rest.match(/methods\s*=\s*\[([^\]]+)\]/) ?? rest.match(/methods\s*=\s*\(([^\)]+)\)/);
    const raw = methodM ? methodM[1] : null;
    const methods = raw
      ? raw
          .split(',')
          .map((x) => x.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean)
      : ['GET'];
    for (const method of methods) routes.push({ method: method.toUpperCase(), path: routePath, line: i + 1 });
  }
  return routes;
}

function parseDjangoRoutes(lines) {
  const routes = [];
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] ?? '').trim();
    const m = line.match(/\bpath\(\s*['"]([^'"]+)['"]\s*,/);
    if (m) routes.push({ method: 'GET', path: `/${String(m[1]).replace(/^\/+/, '')}`, line: i + 1 });
    const rm = line.match(/\bre_path\(\s*r?['"]([^'"]+)['"]\s*,/);
    if (rm) routes.push({ method: 'GET', path: `/${String(rm[1]).replace(/^\/+/, '')}`, line: i + 1 });
  }
  return routes;
}

function parseGoHttpEntrypoints(lines) {
  const routes = [];
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] ?? '');
    const hm = line.match(/\bhttp\.HandleFunc\(\s*\"([^\"]+)\"/);
    if (hm) {
      routes.push({ method: 'GET', path: hm[1], line: i + 1 });
      continue;
    }
    const gm = line.match(/\b(?:router|r)\.(GET|POST|PUT|DELETE|PATCH)\(\s*\"([^\"]+)\"/);
    if (gm) routes.push({ method: gm[1], path: gm[2], line: i + 1 });
  }
  return routes;
}

function parseSpringRoutes(lines) {
  const routes = [];
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] ?? '').trim();
    const mm = line.match(/^@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)\(\s*\"([^\"]+)\"/);
    if (mm) {
      const method = mm[1].replace('Mapping', '').toUpperCase();
      routes.push({ method, path: mm[2], line: i + 1 });
      continue;
    }
    const rm = line.match(/^@RequestMapping\((.+)\)/);
    if (rm) {
      const body = rm[1];
      const pathM = body.match(/value\s*=\s*\"([^\"]+)\"|path\s*=\s*\"([^\"]+)\"/);
      const methodM = body.match(/RequestMethod\.([A-Z]+)/);
      const p = pathM ? (pathM[1] ?? pathM[2]) : null;
      const m = methodM ? methodM[1] : 'GET';
      if (p) routes.push({ method: m, path: p, line: i + 1 });
    }
  }
  return routes;
}

function parseAspNetRoutes(lines) {
  const routes = [];
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] ?? '').trim();
    const mm = line.match(/\bMap(Get|Post|Put|Delete|Patch)\(\s*\"([^\"]+)\"/);
    if (mm) {
      routes.push({ method: mm[1].toUpperCase(), path: mm[2], line: i + 1 });
      continue;
    }
    const am = line.match(/^\[(HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch)\(\s*\"([^\"]+)\"/);
    if (am) routes.push({ method: am[1].replace('Http', '').toUpperCase(), path: am[2], line: i + 1 });
  }
  return routes;
}

function* emitHttpEntrypoints({ lang, lines, filePath, sha, containerUid }) {
  const routes =
    lang === 'python'
      ? [...parseFastApiRoutes(lines), ...parseFlaskRoutes(lines), ...parseDjangoRoutes(lines)]
      : lang === 'go'
        ? parseGoHttpEntrypoints(lines)
        : lang === 'java'
          ? parseSpringRoutes(lines)
          : lang === 'csharp'
            ? parseAspNetRoutes(lines)
            : lang === 'javascript' || lang === 'typescript' || lang === 'tsx'
              ? parseExpressRoutes(lines)
              : [];
  for (const r of routes) {
    const ep = makeApiEndpointNode({ method: r.method, routePath: r.path, filePath, line: r.line, sha, containerUid });
    yield { type: 'node', data: ep };
    if (containerUid) {
      const e = makeEdge({ sourceUid: containerUid, targetUid: ep.symbol_uid, edgeType: 'Defines', sha, metadata: { kind: 'api_endpoint' } });
      yield { type: 'edge', data: e };
      yield { type: 'edge_occurrence', data: makeOccurrence({ edge: e, filePath, line: r.line, kind: 'route_map' }) };
      const cf = makeEdge({ sourceUid: ep.symbol_uid, targetUid: containerUid, edgeType: 'ControlFlow', sha, metadata: { kind: 'route_handler_file' } });
      yield { type: 'edge', data: cf };
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
  }
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
    embedding_text: `package ${qualifiedName}`,
    first_seen_sha: sha ?? 'mock',
    last_seen_sha: sha ?? 'mock'
  };
  packageToUid?.set?.(packageKey, symbolUid);
  return { uid: symbolUid, node };
}

function makeSymbolNode({ kind, name, params = [], filePath, line, sha, language, containerUid = null, visibility = 'internal' }) {
  const qualifiedName = `${filePath}::${name}`;
  const signature =
    kind === 'class'
      ? `class ${name}`
      : kind === 'method'
        ? `method ${name}(${params.join(', ')})`
        : `function ${name}(${params.join(', ')})`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language, qualifiedName, signatureHash });
  const embeddingText = `${qualifiedName} ${signature}`.trim();
  return {
    symbol_uid: symbolUid,
    qualified_name: qualifiedName,
    name,
    node_type: kind === 'class' ? 'Class' : 'Function',
    symbol_kind: kind === 'class' ? 'class' : kind === 'method' ? 'method' : 'function',
    container_uid: containerUid,
    file_path: filePath,
    line_start: line,
    line_end: line,
    language,
    visibility,
    signature,
    signature_hash: signatureHash,
    parameters: params.map((p) => ({ name: p, type: null, description: null })),
    contract:
      kind === 'class'
        ? { kind: 'class', name, constructor: { parameters: params.map((p) => ({ name: p, type: null })) } }
        : { kind: kind === 'method' ? 'method' : 'function', name, parameters: params.map((p) => ({ name: p, type: null })), returns: null },
    constraints: null,
    allowable_values: null,
    embedding_text: embeddingText,
    first_seen_sha: sha ?? 'mock',
    last_seen_sha: sha ?? 'mock'
  };
}

function makeEdge({ sourceUid, targetUid, edgeType, sha, metadata = null }) {
  return {
    source_symbol_uid: sourceUid,
    target_symbol_uid: targetUid,
    edge_type: edgeType,
    first_seen_sha: sha ?? 'mock',
    last_seen_sha: sha ?? 'mock',
    metadata: metadata && Object.keys(metadata).length > 0 ? metadata : null
  };
}

function makeOccurrence({ edge, filePath, line, kind }) {
  return {
    ...edge,
    file_path: filePath,
    line_start: line,
    line_end: line,
    occurrence_kind: kind
  };
}

function* walkNamed(node) {
  if (!node) return;
  const stack = [node];
  while (stack.length) {
    const cur = stack.pop();
    yield cur;
    const kids = cur.namedChildren ?? [];
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
}

function extractImportSpec({ lang, text, node }) {
  // Return best-effort import specifier (string) from a language-specific import node.
  const t = node.type;

  if (lang === 'python') {
    if (t === 'import_statement') return safeName(nodeText(text, node).replace(/^import\s+/, '').split(/\s+/)[0]);
    if (t === 'import_from_statement') {
      // "from x.y import z" -> x.y
      const raw = nodeText(text, node);
      const m = raw.match(/^\s*from\s+([A-Za-z0-9_\.]+)\s+import\s+/);
      return safeName(m?.[1] ?? null);
    }
  }

  if (lang === 'go') {
    if (t === 'import_spec') {
      const str = node.namedChildren?.find((c) => c.type === 'interpreted_string_literal' || c.type === 'raw_string_literal') ?? null;
      const v = str ? nodeText(text, str).replace(/^["`]|["`]$/g, '') : null;
      return safeName(v);
    }
  }

  if (lang === 'java') {
    if (t === 'import_declaration') {
      const raw = nodeText(text, node);
      const m = raw.match(/import\s+([A-Za-z0-9_\.]+)\s*;/);
      return safeName(m?.[1] ?? null);
    }
  }

  if (lang === 'csharp') {
    if (t === 'using_directive') {
      const raw = nodeText(text, node);
      const m = raw.match(/using\s+([A-Za-z0-9_\.]+)\s*;/);
      return safeName(m?.[1] ?? null);
    }
  }

  if (lang === 'rust') {
    if (t === 'use_declaration') {
      const raw = nodeText(text, node);
      const m = raw.match(/use\s+([^;]+);/);
      return safeName(m?.[1]?.trim() ?? null);
    }
  }

  if (lang === 'ruby') {
    if (t === 'call' || t === 'command') {
      const raw = nodeText(text, node).trim();
      const m = raw.match(/^(require|require_relative)\s+['"]([^'"]+)['"]/);
      return safeName(m?.[2] ?? null);
    }
  }

  if (lang === 'php') {
    if (t === 'namespace_use_declaration') {
      const raw = nodeText(text, node);
      const m = raw.match(/use\s+([^;]+);/);
      return safeName(m?.[1]?.trim() ?? null);
    }
  }

  if (lang === 'c' || lang === 'cpp') {
    if (t === 'preproc_include') {
      const raw = nodeText(text, node);
      const m = raw.match(/#\s*include\s+[<"]([^>"]+)[>"]/);
      return safeName(m?.[1] ?? null);
    }
  }

  if (lang === 'swift') {
    if (t === 'import_declaration') {
      const raw = nodeText(text, node);
      const m = raw.match(/import\s+([A-Za-z0-9_\.]+)/);
      return safeName(m?.[1] ?? null);
    }
  }

  if (lang === 'kotlin') {
    if (t === 'import_header') {
      const raw = nodeText(text, node);
      const m = raw.match(/import\s+([A-Za-z0-9_\.]+)/);
      return safeName(m?.[1] ?? null);
    }
  }

  // JS/TS handled by language-specific node types.
  if (lang === 'javascript' || lang === 'typescript' || lang === 'tsx') {
    if (t === 'import_statement') {
      const str =
        node.namedChildren?.find((c) => c.type === 'string' || c.type === 'string_fragment' || c.type === 'template_string') ?? null;
      const v = str ? nodeText(text, str).replace(/^['"`]|['"`]$/g, '') : null;
      return safeName(v);
    }
    if (t === 'call_expression') {
      const raw = nodeText(text, node);
      const m = raw.match(/\brequire\(\s*['"]([^'"]+)['"]/);
      return safeName(m?.[1] ?? null);
    }
  }

  return null;
}

function extractCallee({ lang, text, node }) {
  // Best-effort callee name for call expressions.
  if (lang === 'python') {
    if (node.type !== 'call') return null;
    const fn = node.namedChildren?.[0] ?? null;
    if (!fn) return null;
    if (fn.type === 'identifier') return safeName(nodeText(text, fn));
    if (fn.type === 'attribute') {
      const raw = nodeText(text, fn);
      return safeName(raw.replace(/\s+/g, ''));
    }
  }

  if (lang === 'go') {
    if (node.type !== 'call_expression') return null;
    const fn = node.namedChildren?.[0] ?? null;
    if (!fn) return null;
    if (fn.type === 'identifier') return safeName(nodeText(text, fn));
    if (fn.type === 'selector_expression') return safeName(nodeText(text, fn).replace(/\s+/g, ''));
  }

  if (lang === 'java') {
    if (node.type !== 'method_invocation') return null;
    // method_invocation contains name identifier and optional object.
    const raw = nodeText(text, node);
    const m = raw.match(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    return safeName(m?.[1] ?? null);
  }

  if (lang === 'csharp') {
    if (node.type !== 'invocation_expression') return null;
    const raw = nodeText(text, node);
    const m = raw.match(/([A-Za-z_][A-Za-z0-9_\.]*)\s*\(/);
    return safeName(m?.[1] ?? null);
  }

  if (lang === 'rust') {
    if (node.type !== 'call_expression') return null;
    const raw = nodeText(text, node);
    const m = raw.match(/([A-Za-z_][A-Za-z0-9_:<>]*)\s*\(/);
    return safeName(m?.[1] ?? null);
  }

  if (lang === 'ruby') {
    if (node.type !== 'call' && node.type !== 'command' && node.type !== 'method_call') return null;
    const raw = nodeText(text, node).trim();
    const m = raw.match(/^([A-Za-z_][A-Za-z0-9_\.!?]*)\b/);
    return safeName(m?.[1] ?? null);
  }

  if (lang === 'php') {
    if (node.type !== 'function_call_expression') return null;
    const raw = nodeText(text, node);
    const m = raw.match(/([A-Za-z_][A-Za-z0-9_\\]*)\s*\(/);
    return safeName(m?.[1] ?? null);
  }

  if (lang === 'c' || lang === 'cpp') {
    if (node.type !== 'call_expression') return null;
    const raw = nodeText(text, node);
    const m = raw.match(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    return safeName(m?.[1] ?? null);
  }

  if (lang === 'swift' || lang === 'kotlin') {
    if (node.type !== 'call_expression') return null;
    const raw = nodeText(text, node);
    const m = raw.match(/([A-Za-z_][A-Za-z0-9_\.]*)\s*\(/);
    return safeName(m?.[1] ?? null);
  }

  if (lang === 'javascript' || lang === 'typescript' || lang === 'tsx') {
    if (node.type !== 'call_expression') return null;
    const fn = node.namedChildren?.[0] ?? null;
    if (!fn) return null;
    const raw = nodeText(text, fn);
    return safeName(raw.replace(/\s+/g, ''));
  }

  return null;
}

function resolveJsImport({ filePath, spec, sourceFileExists, resolveAliasImport }) {
  if (!spec) return null;
  if (spec.startsWith('.')) {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(filePath), spec));
    if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(base)) return base;
    const exts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
    const candidates = [];
    for (const ext of exts) candidates.push(`${base}${ext}`);
    for (const ext of exts) candidates.push(`${base}/index${ext}`);
    for (const c of candidates) if (sourceFileExists(c)) return c;
    return null;
  }
  if (typeof resolveAliasImport === 'function') {
    const resolved = resolveAliasImport({ fromFileRel: filePath, spec });
    if (resolved && sourceFileExists(resolved)) return resolved;
  }
  return null;
}

function resolvePyImport({ filePath, spec, sourceFileExists }) {
  if (!spec) return null;
  const fromDir = path.posix.dirname(filePath);
  const modPath = spec.replaceAll('.', '/');
  const candidates = [path.posix.join(modPath) + '.py', path.posix.join(modPath, '__init__.py')];
  for (const c of candidates) if (sourceFileExists(c)) return c;
  // Relative module "pkg.sub" from same dir can be common in apps without package root.
  const relCandidates = [path.posix.join(fromDir, `${modPath}.py`), path.posix.join(fromDir, modPath, '__init__.py')];
  for (const c of relCandidates) if (sourceFileExists(c)) return c;
  return null;
}

function resolveGoImport({ spec, fileByGoImportPath }) {
  if (!spec) return null;
  return fileByGoImportPath?.get?.(spec) ?? null;
}

function resolveDottedImport({ spec, sourceFileExists, ext }) {
  if (!spec) return null;
  const p = spec.replaceAll('.', '/');
  const candidates = [`${p}${ext}`];
  for (const c of candidates) if (sourceFileExists(c)) return c;
  return null;
}

function declarationNameForNode({ lang, text, node }) {
  const t = node.type;
  if (lang === 'python') {
    if (t === 'function_definition' || t === 'class_definition') {
      const id = node.namedChildren?.find((c) => c.type === 'identifier') ?? null;
      return id ? safeName(nodeText(text, id)) : null;
    }
  }
  if (lang === 'go') {
    if (t === 'function_declaration' || t === 'method_declaration' || t === 'type_spec') {
      const id = node.namedChildren?.find((c) => c.type === 'identifier') ?? null;
      return id ? safeName(nodeText(text, id)) : null;
    }
  }
  if (lang === 'java') {
    if (t === 'class_declaration' || t === 'interface_declaration' || t === 'method_declaration') {
      const id = node.namedChildren?.find((c) => c.type === 'identifier') ?? null;
      return id ? safeName(nodeText(text, id)) : null;
    }
  }
  if (lang === 'csharp') {
    if (t === 'class_declaration' || t === 'interface_declaration' || t === 'method_declaration') {
      const id = node.namedChildren?.find((c) => c.type === 'identifier') ?? null;
      return id ? safeName(nodeText(text, id)) : null;
    }
  }
  if (lang === 'rust') {
    if (t === 'function_item' || t === 'struct_item' || t === 'enum_item' || t === 'impl_item') {
      const id = node.namedChildren?.find((c) => c.type === 'identifier' || c.type === 'type_identifier') ?? null;
      return id ? safeName(nodeText(text, id)) : null;
    }
  }
  if (lang === 'ruby') {
    if (t === 'method' || t === 'class' || t === 'module') {
      const id = node.namedChildren?.find((c) => c.type === 'constant' || c.type === 'identifier') ?? null;
      return id ? safeName(nodeText(text, id)) : null;
    }
  }
  if (lang === 'php') {
    if (t === 'function_definition' || t === 'method_declaration' || t === 'class_declaration') {
      const id = node.namedChildren?.find((c) => c.type === 'name' || c.type === 'identifier') ?? null;
      return id ? safeName(nodeText(text, id)) : null;
    }
  }
  if (lang === 'c' || lang === 'cpp') {
    if (t === 'function_definition') {
      const id = node.namedChildren?.find((c) => c.type === 'function_declarator' || c.type === 'identifier') ?? null;
      return id ? safeName(nodeText(text, id).split('(')[0].trim()) : null;
    }
  }
  if (lang === 'swift') {
    if (t === 'function_declaration' || t === 'class_declaration' || t === 'struct_declaration') {
      const id = node.namedChildren?.find((c) => c.type === 'identifier') ?? null;
      return id ? safeName(nodeText(text, id)) : null;
    }
  }
  if (lang === 'kotlin') {
    if (t === 'function_declaration' || t === 'class_declaration' || t === 'object_declaration') {
      const id = node.namedChildren?.find((c) => c.type === 'simple_identifier') ?? null;
      return id ? safeName(nodeText(text, id)) : null;
    }
  }
  if (lang === 'javascript' || lang === 'typescript' || lang === 'tsx') {
    if (t === 'function_declaration' || t === 'class_declaration' || t === 'method_definition') {
      const id = node.namedChildren?.find((c) => c.type === 'identifier' || c.type === 'property_identifier') ?? null;
      return id ? safeName(nodeText(text, id)) : null;
    }
  }
  return null;
}

function kindForDecl({ lang, nodeType }) {
  if (lang === 'python') return nodeType === 'class_definition' ? 'class' : nodeType === 'function_definition' ? 'function' : null;
  if (lang === 'go') return nodeType === 'method_declaration' ? 'method' : nodeType === 'function_declaration' ? 'function' : null;
  if (lang === 'java') return nodeType === 'method_declaration' ? 'method' : nodeType.includes('class') ? 'class' : null;
  if (lang === 'csharp') return nodeType === 'method_declaration' ? 'method' : nodeType.includes('class') ? 'class' : null;
  if (lang === 'rust') return nodeType === 'function_item' ? 'function' : nodeType.endsWith('_item') ? 'class' : null;
  if (lang === 'ruby') return nodeType === 'method' ? 'method' : nodeType === 'class' ? 'class' : null;
  if (lang === 'php') return nodeType === 'method_declaration' ? 'method' : nodeType === 'class_declaration' ? 'class' : nodeType === 'function_definition' ? 'function' : null;
  if (lang === 'c' || lang === 'cpp') return nodeType === 'function_definition' ? 'function' : null;
  if (lang === 'swift') return nodeType === 'function_declaration' ? 'function' : nodeType.includes('class') || nodeType.includes('struct') ? 'class' : null;
  if (lang === 'kotlin') return nodeType === 'function_declaration' ? 'function' : nodeType.includes('class') || nodeType.includes('object') ? 'class' : null;
  if (lang === 'javascript' || lang === 'typescript' || lang === 'tsx')
    return nodeType === 'method_definition' ? 'method' : nodeType === 'class_declaration' ? 'class' : nodeType === 'function_declaration' ? 'function' : null;
  return null;
}

export function createTreeSitterAstEngine({ repoRoot, sourceFileExists }) {
  const Parser = loadTreeSitterRuntime();
  const parserCache = new Map(); // lang -> { parser }

  function normalizeLang(v) {
    const s = String(v ?? '').toLowerCase();
    if (s === 'js') return 'javascript';
    if (s === 'ts') return 'typescript';
    return s;
  }

  function supportsLanguage(languageOrFileLang) {
    return Boolean(TREE_SITTER_LANGUAGE_CONFIG[normalizeLang(languageOrFileLang)]);
  }

  function getParser(lang) {
    const normalized = normalizeLang(lang);
    if (parserCache.has(normalized)) return parserCache.get(normalized);
    const language = loadTreeSitterLanguage(normalized);
    if (!language) return null;
    const parser = new Parser();
    parser.setLanguage(language);
    const p = { parser, language };
    parserCache.set(normalized, p);
    return p;
  }

  function parse({ filePath, language, text }) {
    const inferred = treesitterLanguageForFilePath(filePath);
    const lang = normalizeLang(language ?? inferred ?? '');
    if (!supportsLanguage(lang)) return { ok: false, error: `treesitter_unsupported_language:${lang}`, diagnostics: [] };
    const { parser } = getParser(lang);
    const t = String(text ?? '');
    const tree = parser.parse(t);
    return { ok: true, ast: { lang, filePath: posixPath(filePath), text: t, root: tree.rootNode }, diagnostics: [] };
  }

  // Precompute export map: file -> name->uid. Used by import/call resolution.
  function precomputeExports({ filePath, language, ast, lines, sha, containerUid }) {
    const parsed = ast?.root ? ast : parse({ filePath, language, text: ast?.text ?? lines?.join('\n') ?? '' }).ast;
    const lang = parsed.lang;
    const byName = new Map();
    for (const n of walkNamed(parsed.root)) {
      const k = kindForDecl({ lang, nodeType: n.type });
      if (!k) continue;
      const name = declarationNameForNode({ lang, text: parsed.text, node: n });
      if (!name) continue;
      const node = makeSymbolNode({
        kind: k === 'function' ? 'function' : k === 'method' ? 'method' : 'class',
        name,
        params: [],
        filePath: parsed.filePath,
        line: nodeLine(n),
        sha,
        language: lang,
        containerUid,
        visibility: 'public'
      });
      byName.set(name, node.symbol_uid);
    }
    return byName;
  }

  function* extractRecords({
    filePath,
    language,
    ast,
    text,
    lines,
    sha,
    containerUid,
    fileToUid,
    exportedByFile,
    packageToUid,
    sourceFileExists: existsImpl,
    resolveAliasImport,
    goModuleName,
    fileByGoImportPath
  }) {
    const parsed =
      ast?.root
        ? ast
        : parse({ filePath, language, text: String(text ?? ast?.text ?? lines?.join('\n') ?? '') }).ast;
    const lang = parsed.lang;
    const fp = parsed.filePath;
    const exists = typeof existsImpl === 'function' ? existsImpl : sourceFileExists;

    const localByName = exportedByFile?.get?.(fp) ?? new Map();
    const declUidByNode = new WeakMap();

    // Entrypoints (HTTP routes + basic queue/cron for JS) derived from text lines.
    if (Array.isArray(lines)) {
      for (const record of emitHttpEntrypoints({ lang, lines, filePath: fp, sha, containerUid })) yield record;
      if (lang === 'javascript' || lang === 'typescript' || lang === 'tsx') {
        for (const c of parseCronEntrypoints(lines)) {
          yield {
            type: 'flow_entrypoint',
            data: {
              entrypoint_key: `cron:${c.schedule}`,
              entrypoint_type: 'cron',
              method: null,
              path: null,
              symbol_uid: containerUid,
              entrypoint_symbol_uid: containerUid,
              file_path: fp,
              line_start: c.line,
              line_end: c.line,
              sha
            }
          };
        }
        for (const q of parseQueueConsumers(lines)) {
          yield {
            type: 'flow_entrypoint',
            data: {
              entrypoint_key: `queue:${q.name}`,
              entrypoint_type: 'queue',
              method: null,
              path: null,
              symbol_uid: containerUid,
              entrypoint_symbol_uid: containerUid,
              file_path: fp,
              line_start: q.line,
              line_end: q.line,
              sha
            }
          };
        }
      }
    }

    // Declarations → nodes + Contains edge.
    for (const n of walkNamed(parsed.root)) {
      const k = kindForDecl({ lang, nodeType: n.type });
      if (!k) continue;
      const name = declarationNameForNode({ lang, text: parsed.text, node: n });
      if (!name) continue;
      const node = makeSymbolNode({
        kind: k === 'function' ? 'function' : k === 'method' ? 'method' : 'class',
        name,
        params: [],
        filePath: fp,
        line: nodeLine(n),
        sha,
        language: lang,
        containerUid,
        visibility: 'public'
      });
      yield { type: 'node', data: node };
      declUidByNode.set(n, node.symbol_uid);
      if (containerUid) {
        const edge = makeEdge({ sourceUid: containerUid, targetUid: node.symbol_uid, edgeType: 'Defines', sha, metadata: { kind: k } });
        yield { type: 'edge', data: edge };
        yield { type: 'edge_occurrence', data: makeOccurrence({ edge, filePath: fp, line: node.line_start ?? nodeLine(n), kind: 'other' }) };
      }
    }

    // Imports → Imports edge + UsesPackage when external.
    for (const n of walkNamed(parsed.root)) {
      const spec = extractImportSpec({ lang, text: parsed.text, node: n });
      if (!spec) continue;
      const line = nodeLine(n);
      let resolvedFile = null;
      if (lang === 'javascript' || lang === 'typescript' || lang === 'tsx') {
        resolvedFile = resolveJsImport({ filePath: fp, spec, sourceFileExists: exists, resolveAliasImport });
      } else if (lang === 'python') {
        resolvedFile = resolvePyImport({ filePath: fp, spec, sourceFileExists: exists });
      } else if (lang === 'go') {
        resolvedFile = resolveGoImport({ spec, fileByGoImportPath });
      } else if (lang === 'java') {
        resolvedFile = resolveDottedImport({ spec, sourceFileExists: exists, ext: '.java' });
      } else if (lang === 'csharp') {
        resolvedFile = resolveDottedImport({ spec, sourceFileExists: exists, ext: '.cs' });
      } else if (lang === 'kotlin') {
        resolvedFile = resolveDottedImport({ spec, sourceFileExists: exists, ext: '.kt' });
      } else if (lang === 'swift') {
        resolvedFile = null;
      } else if (lang === 'ruby') {
        resolvedFile = spec.endsWith('.rb') ? spec : `${spec}.rb`;
        if (!exists(resolvedFile)) resolvedFile = null;
      } else if (lang === 'php') {
        resolvedFile = null;
      } else if (lang === 'c' || lang === 'cpp') {
        resolvedFile = null;
      }

      if (resolvedFile && containerUid) {
        const targetFileUid = fileToUid?.get?.(resolvedFile) ?? null;
        if (targetFileUid) {
          const e = makeEdge({ sourceUid: containerUid, targetUid: targetFileUid, edgeType: 'Imports', sha, metadata: { import_spec: spec } });
          yield { type: 'edge', data: e };
          yield { type: 'edge_occurrence', data: makeOccurrence({ edge: e, filePath: fp, line, kind: 'import' }) };
        } else {
          yield { type: 'unresolved_import', data: { file_path: fp, sha, language: lang, import_spec: spec, resolved_file_path: resolvedFile, line } };
        }
      } else {
        yield { type: 'unresolved_import', data: { file_path: fp, sha, language: lang, import_spec: spec, resolved_file_path: resolvedFile, line } };
      }

      const pkgName = packageNameFromImport(spec);
      if (pkgName && containerUid) {
        const packageKey = `${lang}:${pkgName}`;
        const ensured = ensurePackageNode({ packageKey, sha, packageToUid });
        if (ensured?.node) yield { type: 'node', data: ensured.node };
        if (ensured?.uid) {
          const e = makeEdge({ sourceUid: containerUid, targetUid: ensured.uid, edgeType: 'UsesPackage', sha, metadata: { import_spec: spec } });
          yield { type: 'edge', data: e };
          yield { type: 'edge_occurrence', data: makeOccurrence({ edge: e, filePath: fp, line, kind: 'import' }) };
        }
      }
    }

    function enclosingUid(node) {
      let cur = node?.parent ?? null;
      while (cur) {
        const uid = declUidByNode.get(cur);
        if (uid) return uid;
        cur = cur.parent ?? null;
      }
      return containerUid ?? null;
    }

    // Calls → Calls edges when resolvable to local symbol, otherwise omit (conservative).
    for (const n of walkNamed(parsed.root)) {
      const callee = extractCallee({ lang, text: parsed.text, node: n });
      if (!callee) continue;
      const line = nodeLine(n);
      const calleeName = String(callee).split('.').slice(-1)[0];
      const targetUid = localByName.get(calleeName) ?? null;
      const sourceUid = enclosingUid(n);
      if (!targetUid || !sourceUid) continue;
      const edge = makeEdge({ sourceUid, targetUid, edgeType: 'Calls', sha, metadata: { callee } });
      yield { type: 'edge', data: edge };
      yield { type: 'edge_occurrence', data: makeOccurrence({ edge, filePath: fp, line, kind: 'call' }) };
    }
  }

  return {
    supportsLanguage,
    parse,
    precomputeExports,
    extractRecords
  };
}
