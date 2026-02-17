import { computeSignatureHash, makeSymbolUid } from '../../../../cig/src/identity.js';
import { embedText384 } from '../../../../cig/src/embedding.js';
import childProcess from 'node:child_process';
import path from 'node:path';

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

function parsePyImports(lines) {
  const imports = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('import ')) {
      const rest = line.slice('import '.length).trim();
      const mods = rest.split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean);
      for (const m of mods) imports.push({ module: m, line: i + 1 });
    } else if (line.startsWith('from ')) {
      const m = line.match(/^from\s+([A-Za-z0-9_\.]+)\s+import\s+/);
      if (m) imports.push({ module: m[1], line: i + 1 });
    }
  }
  return imports;
}

function runPythonAstExtractor({ text }) {
  const py = process.env.GRAPHFLY_PYTHON_BIN ?? 'python3';
  const code = `
import ast, json, sys
src = sys.stdin.read()
tree = ast.parse(src)

defs = []
calls = []
imports = []

class V(ast.NodeVisitor):
    def __init__(self):
        self.stack = []
    def visit_FunctionDef(self, node):
        params = []
        for a in getattr(node.args, "posonlyargs", []): params.append(a.arg)
        for a in getattr(node.args, "args", []): params.append(a.arg)
        if getattr(node.args, "vararg", None): params.append(node.args.vararg.arg)
        for a in getattr(node.args, "kwonlyargs", []): params.append(a.arg)
        if getattr(node.args, "kwarg", None): params.append(node.args.kwarg.arg)
        defs.append({"kind":"function","name":node.name,"line":node.lineno,"params":params})
        self.stack.append(node.name)
        self.generic_visit(node)
        self.stack.pop()
    def visit_AsyncFunctionDef(self, node):
        self.visit_FunctionDef(node)
    def visit_ClassDef(self, node):
        defs.append({"kind":"class","name":node.name,"line":node.lineno,"params":[]})
        self.stack.append(node.name)
        self.generic_visit(node)
        self.stack.pop()
    def visit_Call(self, node):
        callee = None
        if isinstance(node.func, ast.Name):
            callee = node.func.id
        elif isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name):
            callee = node.func.value.id + "." + node.func.attr
        if callee:
            calls.append({"enclosing": self.stack[-1] if self.stack else None, "callee": callee, "line": getattr(node, "lineno", None)})
        self.generic_visit(node)
    def visit_Import(self, node):
        for a in node.names:
            imports.append({"kind":"import","module":a.name,"as":a.asname,"line":node.lineno})
    def visit_ImportFrom(self, node):
        mod = node.module or ""
        lvl = getattr(node, "level", 0) or 0
        for a in node.names:
            imports.append({"kind":"from","module":mod,"level":lvl,"name":a.name,"as":a.asname,"line":node.lineno})

V().visit(tree)
print(json.dumps({"defs":defs,"calls":calls,"imports":imports}))
`;
  const out = childProcess.spawnSync(py, ['-c', code], { input: text, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 2500 });
  if (out.status !== 0) {
    const err = new Error(`python_ast_failed: ${String(out.stderr || out.stdout || '').slice(0, 200)}`);
    err.code = 'python_ast_failed';
    throw err;
  }
  return JSON.parse(String(out.stdout ?? '{}'));
}

function resolvePythonImportToFile({ fromFilePath, imp, sourceFileExists }) {
  if (typeof sourceFileExists !== 'function') return null;
  const fromDir = path.posix.dirname(String(fromFilePath));

  if (imp.kind === 'from' && Number(imp.level ?? 0) > 0) {
    const up = Math.max(0, Number(imp.level) - 1);
    let baseDir = fromDir;
    for (let i = 0; i < up; i++) baseDir = path.posix.dirname(baseDir);
    const mod = String(imp.module ?? '').replaceAll('.', '/');
    const base = mod ? path.posix.join(baseDir, mod) : baseDir;
    const candidates = [`${base}.py`, path.posix.join(base, '__init__.py')];
    for (const c of candidates) if (sourceFileExists(c)) return c;
    return null;
  }

  const moduleName = imp.kind === 'import' ? String(imp.module ?? '') : imp.kind === 'from' ? String(imp.module ?? '') : '';
  if (!moduleName) return null;
  const modPath = moduleName.replaceAll('.', '/');
  const candidates = [`${modPath}.py`, path.posix.join(modPath, '__init__.py')];
  for (const c of candidates) if (sourceFileExists(c)) return c;
  return null;
}

function parseFastApiRoutes(lines) {
  const routes = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const m = line.match(/^@(?:app|router)\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/);
    if (m) routes.push({ method: m[1].toUpperCase(), path: m[2], line: i + 1 });
  }
  return routes;
}

function parseFlaskRoutes(lines) {
  const routes = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
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
    const line = lines[i].trim();
    const m = line.match(/\bpath\(\s*['"]([^'"]+)['"]\s*,/);
    if (m) routes.push({ method: 'GET', path: `/${String(m[1]).replace(/^\/+/, '')}`, line: i + 1 });
    const rm = line.match(/\bre_path\(\s*r?['"]([^'"]+)['"]\s*,/);
    if (rm) routes.push({ method: 'GET', path: `/${String(rm[1]).replace(/^\/+/, '')}`, line: i + 1 });
  }
  return routes;
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

function parsePyPublicDecls(lines) {
  const decls = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fm = line.match(/^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*:/);
    if (fm) {
      decls.push({ kind: 'function', name: fm[1], paramsRaw: fm[2], line: i + 1 });
      continue;
    }
    const cm = line.match(/^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\s*(\(|:)/);
    if (cm) {
      decls.push({ kind: 'class', name: cm[1], paramsRaw: '', line: i + 1 });
    }
  }
  return decls;
}

function parseParamNames(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return [];
  return s
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => p.replace(/=.*$/g, '').trim())
    .map((p) => p.replace(/^\*/, '').trim())
    .filter((p) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(p));
}

function makeExportedSymbolNode({ kind, name, params, filePath, line, sha, containerUid = null }) {
  const qualifiedName = `${filePath}::${name}`;
  const signature = kind === 'class' ? `class ${name}` : `def ${name}(${params.join(', ')})`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language: 'python', qualifiedName, signatureHash });
  const parameters = params.map((p) => ({ name: p, type: null, optional: undefined, description: null }));
  const contract = kind === 'class' ? { kind: 'class', name, constructor: { parameters } } : { kind: 'function', name, parameters, returns: null, description: null };
  const embeddingText = `${qualifiedName} ${signature}`.trim();
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
    language: 'python',
    visibility: 'public',
    signature,
    signature_hash: signatureHash,
    parameters,
    contract,
    constraints: null,
    allowable_values: null,
    embedding_text: embeddingText,
    embedding: embedText384(embeddingText),
    first_seen_sha: sha ?? 'mock',
    last_seen_sha: sha ?? 'mock'
  };
}

function parsePydanticModels(lines) {
  const models = [];
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] ?? '');
    const m = line.match(/^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*:/);
    if (!m) continue;
    const name = m[1];
    const bases = m[2];
    if (!/\bBaseModel\b/.test(bases)) continue;
    const classIndent = (line.match(/^\s*/) ?? [''])[0].length;

    const fields = [];
    const constraints = Object.create(null);
    const allowableValues = Object.create(null);

    for (let j = i + 1; j < lines.length; j++) {
      const l = String(lines[j] ?? '');
      const indent = (l.match(/^\s*/) ?? [''])[0].length;
      if (l.trim() === '') continue;
      // Stop when we dedent to the class level or hit a new top-level decl.
      if (indent <= classIndent && (l.trim().startsWith('class ') || l.trim().startsWith('def ') || !l.startsWith(' '))) break;
      if (indent <= classIndent) break;

      const fm = l.match(/^\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=]+?)(?:\s*=\s*(.+))?\s*$/);
      if (!fm) continue;
      const field = fm[1];
      const typeAnn = (fm[2] ?? '').trim();
      const rhs = (fm[3] ?? '').trim();

      fields.push({ name: field, type: typeAnn || null, optional: false, description: null });

      // Allowable values: typing.Literal['a','b']
      const lit = typeAnn.match(/\bLiteral\s*\[([^\]]+)\]/);
      if (lit?.[1]) {
        const values = [];
        for (const part of lit[1].split(',')) {
          const s = part.trim();
          const mm = s.match(/^['"]([^'"]+)['"]$/);
          if (mm?.[1]) values.push(mm[1]);
        }
        if (values.length > 0) allowableValues[field] = values;
      }

      // Constraints: Field(..., ge=0, le=120, regex='...')
      if (rhs.includes('Field(')) {
        const argStr = rhs.replace(/.*Field\s*\(/, '').replace(/\)\s*$/, '');
        const c = {};
        const re = /\b(ge|gt|le|lt|min_length|max_length|regex|pattern)\b\s*=\s*([^,\)]+)/g;
        let mm = null;
        while ((mm = re.exec(argStr))) {
          const k = mm[1];
          const vRaw = String(mm[2] ?? '').trim();
          if (k === 'regex' || k === 'pattern') {
            const qm = vRaw.match(/^['"]([^'"]+)['"]$/);
            c.pattern = qm?.[1] ?? vRaw;
          } else {
            const n = Number(vRaw);
            if (Number.isFinite(n)) {
              if (k === 'ge' || k === 'gt' || k === 'min_length') c.min = n;
              if (k === 'le' || k === 'lt' || k === 'max_length') c.max = n;
            }
          }
        }
        if (Object.keys(c).length > 0) constraints[field] = c;
      }
    }

    models.push({
      name,
      line: i + 1,
      fields,
      constraints: Object.keys(constraints).length > 0 ? constraints : null,
      allowable_values: Object.keys(allowableValues).length > 0 ? allowableValues : null
    });
  }
  return models;
}

function makeSchemaNode({ name, fields, constraints, allowableValues, filePath, line, sha, containerUid = null }) {
  const qualifiedName = `${filePath}::${name}`;
  const signature = `schema ${name}`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language: 'python', qualifiedName, signatureHash });
  const embeddingText = `${qualifiedName} ${signature}`.trim();
  return {
    symbol_uid: symbolUid,
    qualified_name: qualifiedName,
    name,
    node_type: 'Schema',
    symbol_kind: 'schema',
    container_uid: containerUid,
    file_path: filePath,
    line_start: line,
    line_end: line,
    language: 'python',
    visibility: 'public',
    signature,
    signature_hash: signatureHash,
    parameters: null,
    contract: { kind: 'schema', name, fields: Array.isArray(fields) ? fields : [] },
    constraints: constraints ?? null,
    allowable_values: allowableValues ?? null,
    embedding_text: embeddingText,
    embedding: embedText384(embeddingText),
    first_seen_sha: sha ?? 'mock',
    last_seen_sha: sha ?? 'mock'
  };
}

export function* parsePythonFile({ filePath, lines, sha, containerUid, exportedByFile, packageToUid, sourceFileExists = null }) {
  const sourceUid = containerUid ?? null;
  const text = Array.isArray(lines) ? lines.join('\n') : '';
  let ast = null;
  try {
    ast = runPythonAstExtractor({ text });
  } catch {
    ast = null;
  }

  const decls = Array.isArray(ast?.defs)
    ? ast.defs
    : parsePyPublicDecls(lines).map((d) => ({ kind: d.kind, name: d.name, line: d.line, params: parseParamNames(d.paramsRaw) }));
  const localByName = new Map();

  for (const d of decls) {
    const params = Array.isArray(d.params) ? d.params : [];
    const node = makeExportedSymbolNode({ kind: d.kind, name: d.name, params, filePath, line: d.line, sha, containerUid: sourceUid });
    yield { type: 'node', data: node };
    localByName.set(d.name, node.symbol_uid);
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
  if (!exportedByFile.has(filePath)) exportedByFile.set(filePath, new Map());
  for (const [k, v] of localByName.entries()) exportedByFile.get(filePath).set(k, v);

  // Pydantic models: extract schema + constraints/allowables (public contract-only, no code bodies).
  for (const m of parsePydanticModels(lines)) {
    const schema = makeSchemaNode({
      name: m.name,
      fields: m.fields,
      constraints: m.constraints,
      allowableValues: m.allowable_values,
      filePath,
      line: m.line,
      sha,
      containerUid: sourceUid
    });
    yield { type: 'node', data: schema };
    yield {
      type: 'edge',
      data: {
        source_symbol_uid: sourceUid,
        target_symbol_uid: schema.symbol_uid,
        edge_type: 'Defines',
        metadata: { kind: 'schema' },
        first_seen_sha: sha,
        last_seen_sha: sha
      }
    };
    yield {
      type: 'edge_occurrence',
      data: {
        source_symbol_uid: sourceUid,
        target_symbol_uid: schema.symbol_uid,
        edge_type: 'Defines',
        file_path: filePath,
        line_start: m.line,
        line_end: m.line,
        occurrence_kind: 'other',
        sha
      }
    };
  }

  for (const r of [...parseFastApiRoutes(lines), ...parseFlaskRoutes(lines), ...parseDjangoRoutes(lines)]) {
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

  const imports = Array.isArray(ast?.imports) ? ast.imports : parsePyImports(lines).map((x) => ({ kind: 'import', module: x.module, line: x.line }));
  const importNameToResolvedUid = new Map();

  for (const imp of imports) {
    const resolvedFile = resolvePythonImportToFile({ fromFilePath: filePath, imp, sourceFileExists });
    if (resolvedFile) {
      const targetUid = makeSymbolUid({
        language: 'python',
        qualifiedName: resolvedFile.replaceAll('/', '.'),
        signatureHash: computeSignatureHash({ signature: `file ${resolvedFile}` })
      });
      yield {
        type: 'edge',
        data: {
          source_symbol_uid: sourceUid,
          target_symbol_uid: targetUid,
          edge_type: 'Imports',
          metadata: { module: imp.module ?? null },
          first_seen_sha: sha,
          last_seen_sha: sha
        }
      };
      const line = Number(imp.line ?? 1);
      yield {
        type: 'edge_occurrence',
        data: {
          source_symbol_uid: sourceUid,
          target_symbol_uid: targetUid,
          edge_type: 'Imports',
          file_path: filePath,
          line_start: line,
          line_end: line,
          occurrence_kind: 'import',
          sha
        }
      };

      if (imp.kind === 'from' && imp.name) {
        const byName = exportedByFile?.get?.(resolvedFile) ?? null;
        const targetSym = byName?.get?.(String(imp.name)) ?? null;
        if (targetSym) importNameToResolvedUid.set(String(imp.as ?? imp.name), targetSym);
      }
      continue;
    }

    const mod = String(imp.module ?? '');
    if (!mod) continue;
    const pkg = mod.split('.')[0];
    if (!pkg) continue;
    const packageKey = `pypi:${pkg}`;
    const ensured = ensurePackageNode({ packageKey, sha, packageToUid });
    if (ensured?.node) yield { type: 'node', data: ensured.node };
    const pkgUid = ensured?.uid ?? null;
    if (!pkgUid) continue;
    const line = Number(imp.line ?? 1);
    yield {
      type: 'observed_dependency',
      data: { source_symbol_uid: sourceUid, file_path: filePath, sha, package_key: packageKey, evidence: { import_module: mod, line } }
    };
    yield {
      type: 'edge',
      data: {
        source_symbol_uid: sourceUid,
        target_symbol_uid: pkgUid,
        edge_type: 'UsesPackage',
        metadata: { import_module: mod },
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
        line_start: line,
        line_end: line,
        occurrence_kind: 'use',
        sha
      }
    };
  }

  const calls = Array.isArray(ast?.calls) ? ast.calls : [];
  for (const c of calls) {
    const enclosing = c.enclosing ? String(c.enclosing) : null;
    const container = enclosing && localByName.has(enclosing) ? localByName.get(enclosing) : sourceUid;
    const callee = String(c.callee ?? '');
    if (!callee) continue;
    const calleeName = callee.includes('.') ? callee.split('.').pop() : callee;
    const targetUid = localByName.get(calleeName) ?? importNameToResolvedUid.get(calleeName) ?? null;
    if (!targetUid) continue;
    const line = Number(c.line ?? 1);
    yield {
      type: 'edge',
      data: { source_symbol_uid: container, target_symbol_uid: targetUid, edge_type: 'Calls', metadata: { callee }, first_seen_sha: sha, last_seen_sha: sha }
    };
    yield {
      type: 'edge_occurrence',
      data: { source_symbol_uid: container, target_symbol_uid: targetUid, edge_type: 'Calls', file_path: filePath, line_start: line, line_end: line, occurrence_kind: 'call', sha }
    };
  }
}
