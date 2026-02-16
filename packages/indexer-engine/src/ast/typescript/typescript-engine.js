import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { computeSignatureHash, makeSymbolUid } from '../../../../cig/src/identity.js';
import { embedText384 } from '../../../../cig/src/embedding.js';

function loadVendoredTypeScript() {
  const require = createRequire(import.meta.url);
  // Vendored to guarantee the AST engine is always available (no network install required).
  // Path is relative to this file: packages/indexer-engine/vendor/typescript/lib/typescript.js
  const here = path.dirname(fileURLToPath(import.meta.url));
  const tsPath = path.resolve(here, '../../../vendor/typescript/lib/typescript.js');
  // eslint-disable-next-line import/no-dynamic-require
  return require(tsPath);
}

function languageForFilePath(filePath) {
  const p = String(filePath ?? '');
  if (p.endsWith('.ts') || p.endsWith('.tsx')) return 'ts';
  return 'js';
}

function scriptKindForFilePath(ts, filePath) {
  const p = String(filePath ?? '');
  if (p.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (p.endsWith('.ts')) return ts.ScriptKind.TS;
  if (p.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function isStringLiteralLike(ts, node) {
  return Boolean(node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)));
}

function posToLine(sf, pos) {
  const lc = sf.getLineAndCharacterOfPosition(pos);
  return (lc?.line ?? 0) + 1;
}

	function packageNameFromImport(spec) {
	  if (!spec || spec.startsWith('.') || spec.startsWith('/')) return null;
	  if (spec.startsWith('@')) {
	    const parts = spec.split('/');
	    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec;
	  }
	  return spec.split('/')[0];
	}

	function isLikelyInternalAliasImport(spec) {
	  const s = String(spec ?? '');
	  // Common alias patterns in modern JS/TS repos.
	  return s.startsWith('~/') || s.startsWith('@/') || s.startsWith('#') || s.startsWith('$');
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
	  return null;
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
    if (String(lines[j] ?? '').includes('*/')) {
      end = j;
      break;
    }
    const t = String(lines[j] ?? '').trim();
    if (t !== '' && !t.startsWith('*') && !t.startsWith('//')) break;
  }
  if (end < 0) return null;

  let start = -1;
  for (let j = end; j >= 0 && i - j <= maxLookback; j--) {
    if (String(lines[j] ?? '').includes('/**')) {
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
    .map((l) => String(l).trim().replace(/^\/\*\*\s?/, '').replace(/\*\/\s?$/, '').replace(/^\*\s?/, '').trim())
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

function extractIdentifierParamName(ts, nameNode) {
  if (!nameNode) return null;
  if (ts.isIdentifier(nameNode)) return nameNode.text;
  if (ts.isObjectBindingPattern(nameNode)) return '_destructured';
  if (ts.isArrayBindingPattern(nameNode)) return '_destructured';
  return null;
}

	function makeSymbolNode({ kind, name, params, jsdoc, filePath, line, sha, language, containerUid = null, visibility = 'internal' }) {
	  const qualifiedName = `${filePath}::${name}`;
	  const signature =
	    kind === 'class'
	      ? `class ${name}`
	      : kind === 'method'
	        ? `method ${name}(${params.join(', ')})`
	        : `function ${name}(${params.join(', ')})`;
	  const signatureHash = computeSignatureHash({ signature });
	  const symbolUid = makeSymbolUid({ language, qualifiedName, signatureHash });
	  const embeddingText = `${qualifiedName} ${signature} ${jsdoc?.description ?? ''}`.trim();

  const parameters = params.map((p) => {
    const info = jsdoc?.params?.get?.(p) ?? null;
    return { name: p, type: info?.type ?? null, optional: Boolean(info?.optional) || undefined, description: info?.description ?? null };
  });

	  const contract =
	    kind === 'class'
	      ? { kind: 'class', name, constructor: { parameters } }
	      : {
	          kind: kind === 'method' ? 'method' : 'function',
	          name,
	          parameters,
	          returns: jsdoc?.returnsType ? { type: jsdoc.returnsType } : null,
	          description: jsdoc?.description ?? null
	        };

  const constraints = jsdoc?.constraints && Object.keys(jsdoc.constraints).length > 0 ? jsdoc.constraints : null;
  const allowableValues = jsdoc?.allowableValues && Object.keys(jsdoc.allowableValues).length > 0 ? jsdoc.allowableValues : null;

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

	function uidForDecl({ kind, name, params, filePath, language }) {
	  const qualifiedName = `${filePath}::${name}`;
	  const signature =
	    kind === 'class'
	      ? `class ${name}`
	      : kind === 'method'
	        ? `method ${name}(${(params ?? []).join(', ')})`
	        : `function ${name}(${(params ?? []).join(', ')})`;
	  const signatureHash = computeSignatureHash({ signature });
	  return makeSymbolUid({ language, qualifiedName, signatureHash });
	}

function hasExportModifier(ts, node) {
  const mods = node?.modifiers;
  if (!mods) return false;
  return mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function hasDefaultModifier(ts, node) {
  const mods = node?.modifiers;
  if (!mods) return false;
  return mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
}

function extractImportsFromAst(ts, sf) {
  const out = [];

  function visit(node) {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && isStringLiteralLike(ts, node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      const names = [];
      const bindings = [];
      const clause = node.importClause;
      if (clause?.name?.text) {
        names.push(clause.name.text);
        bindings.push({ local: clause.name.text, imported: 'default', kind: 'default' });
      }
      const named = clause?.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const el of named.elements) {
          const local = el?.name?.text ?? null;
          const imported = (el?.propertyName?.text ?? el?.name?.text) ?? null;
          if (local) names.push(local);
          if (local && imported) bindings.push({ local, imported, kind: 'named' });
        }
      } else if (named && ts.isNamespaceImport(named)) {
        const local = named.name?.text ?? null;
        if (local) names.push(local);
        if (local) bindings.push({ local, imported: '*', kind: 'namespace' });
      }
      out.push({ spec, names, bindings, line: posToLine(sf, node.getStart(sf)) });
    }

    if (ts.isCallExpression(node)) {
      // require('x')
      if (ts.isIdentifier(node.expression) && node.expression.text === 'require' && node.arguments?.length >= 1) {
        const arg = node.arguments[0];
        if (isStringLiteralLike(ts, arg)) {
          out.push({ spec: arg.text, names: [], bindings: [], line: posToLine(sf, node.getStart(sf)) });
        }
      }
      // import('x')
      if (node.expression?.kind === ts.SyntaxKind.ImportKeyword && node.arguments?.length >= 1) {
        const arg = node.arguments[0];
        if (isStringLiteralLike(ts, arg)) {
          out.push({ spec: arg.text, names: [], bindings: [], line: posToLine(sf, node.getStart(sf)) });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return out;
}

	function extractExportedDeclsFromAst(ts, sf) {
	  const decls = [];
	  for (const st of sf.statements ?? []) {
    if (ts.isFunctionDeclaration(st) && st.name?.text && hasExportModifier(ts, st)) {
      const params = (st.parameters ?? [])
        .map((p) => extractIdentifierParamName(ts, p.name))
        .filter((x) => Boolean(x));
      decls.push({
        kind: 'function',
        name: st.name.text,
        params,
        line: posToLine(sf, st.getStart(sf)),
        isDefault: hasDefaultModifier(ts, st)
      });
    } else if (ts.isClassDeclaration(st) && st.name?.text && hasExportModifier(ts, st)) {
      decls.push({
        kind: 'class',
        name: st.name.text,
        params: [],
        line: posToLine(sf, st.getStart(sf)),
        isDefault: hasDefaultModifier(ts, st)
      });
    } else if (ts.isVariableStatement(st) && hasExportModifier(ts, st)) {
      for (const d of st.declarationList?.declarations ?? []) {
        const name = d.name && ts.isIdentifier(d.name) ? d.name.text : null;
        if (!name) continue;
        const init = d.initializer ?? null;
        const isFn = init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
        if (!isFn) continue;
        const params = (init.parameters ?? [])
          .map((p) => extractIdentifierParamName(ts, p.name))
          .filter((x) => Boolean(x));
        decls.push({
          kind: 'function',
          name,
          params,
          line: posToLine(sf, d.getStart(sf)),
          isDefault: false
        });
      }
    }
  }
	  return decls;
	}

	function isPrivateLike(ts, node) {
	  const mods = node?.modifiers;
	  if (!mods) return false;
	  return mods.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword);
	}

	function extractTopLevelDeclsAndMethodsFromAst(ts, sf) {
	  const decls = [];

	  for (const st of sf.statements ?? []) {
	    if (ts.isFunctionDeclaration(st) && st.name?.text) {
	      const params = (st.parameters ?? [])
	        .map((p) => extractIdentifierParamName(ts, p.name))
	        .filter((x) => Boolean(x));
	      decls.push({
	        kind: 'function',
	        name: st.name.text,
	        params,
	        line: posToLine(sf, st.getStart(sf)),
	        isExported: hasExportModifier(ts, st),
	        isDefault: hasDefaultModifier(ts, st),
	        visibility: hasExportModifier(ts, st) ? 'public' : 'internal'
	      });
	      continue;
	    }

	    if (ts.isClassDeclaration(st) && st.name?.text) {
	      const exported = hasExportModifier(ts, st);
	      const classLine = posToLine(sf, st.getStart(sf));
	      decls.push({
	        kind: 'class',
	        name: st.name.text,
	        params: [],
	        line: classLine,
	        isExported: exported,
	        isDefault: hasDefaultModifier(ts, st),
	        visibility: exported ? 'public' : 'internal'
	      });

	      for (const m of st.members ?? []) {
	        if (!ts.isMethodDeclaration(m)) continue;
	        const mName = m.name && ts.isIdentifier(m.name) ? m.name.text : null;
	        if (!mName) continue;
	        const params = (m.parameters ?? [])
	          .map((p) => extractIdentifierParamName(ts, p.name))
	          .filter((x) => Boolean(x));
	        const privateLike = isPrivateLike(ts, m);
	        decls.push({
	          kind: 'method',
	          name: `${st.name.text}.${mName}`,
	          methodName: mName,
	          className: st.name.text,
	          params,
	          line: posToLine(sf, m.getStart(sf)),
	          isExported: exported,
	          isDefault: false,
	          visibility: privateLike ? 'private' : exported ? 'public' : 'internal'
	        });
	      }
	      continue;
	    }

	    if (ts.isVariableStatement(st)) {
	      const exported = hasExportModifier(ts, st);
	      for (const d of st.declarationList?.declarations ?? []) {
	        const name = d.name && ts.isIdentifier(d.name) ? d.name.text : null;
	        if (!name) continue;
	        const init = d.initializer ?? null;
	        const isFn = init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
	        if (!isFn) continue;
	        const params = (init.parameters ?? [])
	          .map((p) => extractIdentifierParamName(ts, p.name))
	          .filter((x) => Boolean(x));
	        decls.push({
	          kind: 'function',
	          name,
	          params,
	          line: posToLine(sf, d.getStart(sf)),
	          isExported: exported,
	          isDefault: false,
	          visibility: exported ? 'public' : 'internal'
	        });
	      }
	    }
	  }
	  return decls;
	}

function parseExpressRoutes(lines) {
  const routes = [];
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] ?? '');
    const m = line.match(/\bapp\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/);
    if (m) routes.push({ method: m[1].toUpperCase(), path: m[2], line: i + 1 });
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

function parseCronEntrypoints(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] ?? '');
    const m = line.match(/\bcron\.schedule\(\s*['"]([^'"]+)['"]/);
    if (m) out.push({ expr: m[1], line: i + 1 });
    const jm = line.match(/\bnew\s+CronJob\(\s*['"]([^'"]+)['"]/);
    if (jm) out.push({ expr: jm[1], line: i + 1 });
  }
  return out;
}

function parseQueueConsumers(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] ?? '');
    const m = line.match(/\.process\(\s*(?:['"]([^'"]+)['"]\s*,)?/);
    if (m) out.push({ name: m[1] ?? 'default', line: i + 1 });
  }
  return out;
}

function makeCronJobNode({ expr, filePath, line, sha, containerUid = null }) {
  const qualifiedName = `cron.${expr}`;
  const signature = `cron ${expr}`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language: 'cron', qualifiedName, signatureHash });
  return {
    symbol_uid: symbolUid,
    qualified_name: qualifiedName,
    name: signature,
    node_type: 'CronJob',
    symbol_kind: 'cron_job',
    container_uid: containerUid,
    file_path: filePath,
    line_start: line,
    line_end: line,
    language: 'cron',
    visibility: 'internal',
    signature,
    signature_hash: signatureHash,
    contract: { kind: 'cron', expression: expr },
    constraints: null,
    allowable_values: null,
    embedding_text: `${signature} cron job`,
    embedding: embedText384(`${signature} cron job`),
    first_seen_sha: sha ?? 'mock',
    last_seen_sha: sha ?? 'mock'
  };
}

function makeQueueJobNode({ name, filePath, line, sha, containerUid = null }) {
  const qualifiedName = `queue.${name}`;
  const signature = `queue ${name}`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language: 'queue', qualifiedName, signatureHash });
  return {
    symbol_uid: symbolUid,
    qualified_name: qualifiedName,
    name: signature,
    node_type: 'QueueJob',
    symbol_kind: 'queue_job',
    container_uid: containerUid,
    file_path: filePath,
    line_start: line,
    line_end: line,
    language: 'queue',
    visibility: 'internal',
    signature,
    signature_hash: signatureHash,
    contract: { kind: 'queue_consumer', name },
    constraints: null,
    allowable_values: null,
    embedding_text: `${signature} queue consumer`,
    embedding: embedText384(`${signature} queue consumer`),
    first_seen_sha: sha ?? 'mock',
    last_seen_sha: sha ?? 'mock'
  };
}

export function createTypeScriptAstEngine({ sourceFileExists } = {}) {
  const ts = loadVendoredTypeScript();

  return {
    name: 'typescript',
    parse({ filePath, language, text }) {
      const kind = scriptKindForFilePath(ts, filePath);
      const sf = ts.createSourceFile(String(filePath ?? 'file.ts'), String(text ?? ''), ts.ScriptTarget.Latest, true, kind);
      return { ok: true, ast: sf, diagnostics: [] };
    },
	    precomputeExports({ filePath, language, ast, lines, sha, containerUid }) {
	      const sf = ast;
	      const decls = extractExportedDeclsFromAst(ts, sf);
	      const byName = new Map();
	      for (const d of decls) {
	        const uid = uidForDecl({ kind: d.kind, name: d.name, params: d.params ?? [], filePath, language });
	        byName.set(d.name, uid);
	        if (d.isDefault) byName.set('default', uid);
	      }
	      return byName;
	    },
    *extractRecords({
      filePath,
      language,
      ast,
      text,
      lines,
      sha,
      containerUid,
      exportedByFile,
      packageToUid,
      sourceFileExists: fileExists,
      resolveAliasImport
    }) {
	      const sourceUid = containerUid ?? null;
	      const sf = ast;

	      const decls = extractTopLevelDeclsAndMethodsFromAst(ts, sf);
	      if (decls.length > 0) {
	        const exportedByName = new Map();
	        const localByName = new Map();
	        const classUidByName = new Map();
	        const methodUidByClassAndName = new Map(); // `${classUid}::${methodName}` -> methodUid
	        const methodOwnerByUid = new Map(); // methodUid -> classUid
	        for (const d of decls) {
	          const jsdoc = parseJsDoc(findJsDocBlock(lines ?? [], Math.max(0, Number(d.line ?? 1) - 1)));
	          const container =
	            d.kind === 'method'
	              ? classUidByName.get(d.className) ?? sourceUid
	              : sourceUid;
	          const nodeName = d.kind === 'method' ? d.methodName : d.name;
	          const node = makeSymbolNode({
	            kind: d.kind,
	            name: nodeName,
	            params: d.params ?? [],
	            jsdoc,
	            filePath,
	            line: d.line,
	            sha,
	            language,
	            containerUid: container,
	            visibility: d.visibility ?? (d.isExported ? 'public' : 'internal')
	          });
	          localByName.set(d.name, node.symbol_uid);
	          if (d.kind === 'class') classUidByName.set(d.name, node.symbol_uid);
	          if (d.kind === 'method') {
	            methodUidByClassAndName.set(`${container}::${d.methodName}`, node.symbol_uid);
	            methodOwnerByUid.set(node.symbol_uid, container);
	          }

	          if (d.isExported && d.kind !== 'method') {
	            exportedByName.set(d.name, node.symbol_uid);
	            if (d.isDefault) exportedByName.set('default', node.symbol_uid);
	          }
	          yield { type: 'node', data: node };
	          yield {
	            type: 'edge',
	            data: {
	              source_symbol_uid: d.kind === 'method' ? (classUidByName.get(d.className) ?? sourceUid) : sourceUid,
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
	              source_symbol_uid: d.kind === 'method' ? (classUidByName.get(d.className) ?? sourceUid) : sourceUid,
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
	        // Only exported top-level decls are visible cross-file.
	        exportedByFile?.set?.(filePath, exportedByName);

	        // Store local symbol maps for call attribution and `this.method()` resolution.
	        // (Not persisted; used only within this file extraction.)
	        sf.__graphflyLocalByName = localByName;
	        sf.__graphflyMethodByClassAndName = methodUidByClassAndName;
	        sf.__graphflyMethodOwnerByUid = methodOwnerByUid;
	      }

      for (const r of parseExpressRoutes(lines ?? [])) {
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

      for (const c of parseCronEntrypoints(lines ?? [])) {
        const cronNode = makeCronJobNode({ expr: c.expr, filePath, line: c.line, sha, containerUid: sourceUid });
        yield { type: 'node', data: cronNode };
        yield { type: 'edge', data: { source_symbol_uid: sourceUid, target_symbol_uid: cronNode.symbol_uid, edge_type: 'Defines', metadata: { kind: 'cron_job' }, first_seen_sha: sha, last_seen_sha: sha } };
        yield { type: 'edge_occurrence', data: { source_symbol_uid: sourceUid, target_symbol_uid: cronNode.symbol_uid, edge_type: 'Defines', file_path: filePath, line_start: c.line, line_end: c.line, occurrence_kind: 'other', sha } };
        yield { type: 'edge', data: { source_symbol_uid: cronNode.symbol_uid, target_symbol_uid: sourceUid, edge_type: 'ControlFlow', metadata: { kind: 'cron_handler_file' }, first_seen_sha: sha, last_seen_sha: sha } };
        yield { type: 'flow_entrypoint', data: { entrypoint_key: `cron:${c.expr}`, entrypoint_type: 'cron_job', method: null, path: null, symbol_uid: cronNode.symbol_uid, entrypoint_symbol_uid: cronNode.symbol_uid, file_path: filePath, line_start: c.line, line_end: c.line, sha } };
      }

      for (const q of parseQueueConsumers(lines ?? [])) {
        const qNode = makeQueueJobNode({ name: q.name, filePath, line: q.line, sha, containerUid: sourceUid });
        yield { type: 'node', data: qNode };
        yield { type: 'edge', data: { source_symbol_uid: sourceUid, target_symbol_uid: qNode.symbol_uid, edge_type: 'Defines', metadata: { kind: 'queue_job' }, first_seen_sha: sha, last_seen_sha: sha } };
        yield { type: 'edge_occurrence', data: { source_symbol_uid: sourceUid, target_symbol_uid: qNode.symbol_uid, edge_type: 'Defines', file_path: filePath, line_start: q.line, line_end: q.line, occurrence_kind: 'other', sha } };
        yield { type: 'edge', data: { source_symbol_uid: qNode.symbol_uid, target_symbol_uid: sourceUid, edge_type: 'ControlFlow', metadata: { kind: 'queue_handler_file' }, first_seen_sha: sha, last_seen_sha: sha } };
        yield { type: 'flow_entrypoint', data: { entrypoint_key: `queue:${q.name}`, entrypoint_type: 'queue_job', method: null, path: null, symbol_uid: qNode.symbol_uid, entrypoint_symbol_uid: qNode.symbol_uid, file_path: filePath, line_start: q.line, line_end: q.line, sha } };
      }

	      const imports = extractImportsFromAst(ts, sf);
	      const localToImport = new Map(); // local -> { resolvedFile, importedName }
	      for (const imp of imports) {
	        const aliasResolved = typeof resolveAliasImport === 'function' ? resolveAliasImport(imp.spec) : null;
	        const resolved = aliasResolved || resolveImport(filePath, imp.spec, fileExists ?? sourceFileExists);
	        if (resolved) {
          const targetLang = languageForFilePath(resolved);
          const targetUid = makeSymbolUid({
            language: targetLang,
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

	          for (const b of imp.bindings ?? []) {
	            if (!b?.local || !b?.imported) continue;
	            localToImport.set(b.local, { resolvedFile: resolved, importedName: b.imported });
	          }
	        } else {
	          // Track unresolved relative/alias imports transparently. External package imports are handled as dependencies.
	          const spec = String(imp.spec ?? '');
	          if (spec.startsWith('.') || isLikelyInternalAliasImport(spec)) {
	            yield {
	              type: 'unresolved_import',
	              data: {
	                file_path: filePath,
	                line: imp.line,
	                spec,
	                kind: 'internal_unresolved',
	                sha
	              }
	            };
	          }
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

      // Call graph: conservative, deterministic resolution for identifier calls.
	      const localExports = exportedByFile?.get?.(filePath) ?? new Map();
	      const localDecls = sf.__graphflyLocalByName ?? new Map();
	      const methodByClassAndName = sf.__graphflyMethodByClassAndName ?? new Map();
	      const methodOwnerByUid = sf.__graphflyMethodOwnerByUid ?? new Map();
	      function resolveCallee(name) {
	        if (!name) return null;
	        if (localDecls.has(name)) return localDecls.get(name);
	        // Calls to other exported symbols in same file.
	        if (localExports.has(name)) return localExports.get(name);
	        const imp = localToImport.get(name);
        if (!imp) return null;
        const targetFile = imp.resolvedFile;
        const importedName = imp.importedName;
        const targets = exportedByFile?.get?.(targetFile) ?? null;
        if (!targets) return null;
        // default import maps to 'default' if present.
        const key = importedName === 'default' ? 'default' : importedName;
        return targets.get(key) ?? null;
      }

      const fileCallSourceUid = sourceUid;
      const exportUidByName = localExports;

      function containerUidForNode(node) {
        // Only attribute calls to exported functions we can identify by name.
        if (!node) return fileCallSourceUid;
        if (ts.isFunctionDeclaration(node) && node.name?.text && hasExportModifier(ts, node)) {
          return exportUidByName.get(node.name.text) ?? fileCallSourceUid;
        }
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
          return exportUidByName.get(node.name.text) ?? fileCallSourceUid;
        }
        return fileCallSourceUid;
      }

	      const callEdges = [];
	      const callOccs = [];

	      function recordResolvedCall({ containerUid, targetUid, callee, node }) {
	        if (!targetUid) return;
	        const line = posToLine(sf, node.getStart(sf));
	        callEdges.push({
	          type: 'edge',
	          data: {
	            source_symbol_uid: containerUid,
	            target_symbol_uid: targetUid,
	            edge_type: 'Calls',
	            metadata: { callee },
	            first_seen_sha: sha,
	            last_seen_sha: sha
	          }
	        });
	        callOccs.push({
	          type: 'edge_occurrence',
	          data: {
	            source_symbol_uid: containerUid,
	            target_symbol_uid: targetUid,
	            edge_type: 'Calls',
	            file_path: filePath,
	            line_start: line,
	            line_end: line,
	            occurrence_kind: 'call',
	            sha
	          }
	        });
	      }

	      function recordCall({ containerUid, callee, node }) {
	        const targetUid = resolveCallee(callee);
	        recordResolvedCall({ containerUid, targetUid, callee, node });
	      }

	      function visit(node, containerUid) {
	        if (!node) return;
	        if (ts.isCallExpression(node)) {
	          if (ts.isIdentifier(node.expression)) {
	            recordCall({ containerUid, callee: node.expression.text, node });
		          } else if (ts.isPropertyAccessExpression(node.expression) || ts.isPropertyAccessChain?.(node.expression)) {
		            const expr = node.expression;
		            const base = expr.expression;
		            const member = expr.name?.text ?? null;

		            // namespace import call: ns.fn()
		            if (member && base && ts.isIdentifier(base)) {
		              const imp = localToImport.get(base.text);
		              if (imp?.importedName === '*') {
		                const targets = exportedByFile?.get?.(imp.resolvedFile) ?? null;
		                const targetUid = targets?.get?.(member) ?? null;
		                if (targetUid) recordResolvedCall({ containerUid, targetUid, callee: member, node });
		              }
		            }

		            // static-like class call: ClassName.method()
		            if (member && base && ts.isIdentifier(base)) {
		              const baseUid = localDecls.get(base.text) ?? localExports.get(base.text) ?? null;
		              const targetUid = baseUid ? methodByClassAndName.get(`${baseUid}::${member}`) ?? null : null;
		              if (targetUid) recordResolvedCall({ containerUid, targetUid, callee: member, node });
		            }

		            // this.method() within class method: resolve to sibling method nodes.
		            if (member && base && base.kind === ts.SyntaxKind.ThisKeyword) {
		              const classUid = methodOwnerByUid.get(containerUid) ?? null;
		              const sibling = classUid ? methodByClassAndName.get(`${classUid}::${member}`) ?? null : null;
		              if (sibling) recordResolvedCall({ containerUid, targetUid: sibling, callee: member, node });
		            }
		          }
		        }

	        // Track containers for attribution when we can identify them.
	        if (ts.isClassDeclaration(node) && node.name?.text) {
	          const nextContainer = localDecls.get(node.name.text) ?? containerUid;
	          ts.forEachChild(node, (child) => visit(child, nextContainer));
	          return;
	        }
	        if (ts.isFunctionDeclaration(node) && node.name?.text) {
	          const nextContainer = localDecls.get(node.name.text) ?? containerUidForNode(node);
	          ts.forEachChild(node, (child) => visit(child, nextContainer));
	          return;
	        }
	        if (
	          ts.isVariableDeclaration(node) &&
	          ts.isIdentifier(node.name) &&
	          node.initializer &&
	          (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
	        ) {
	          const nextContainer = localDecls.get(node.name.text) ?? containerUidForNode(node);
	          ts.forEachChild(node.initializer, (child) => visit(child, nextContainer));
	          return;
	        }
	        if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
	          // containerUid becomes method uid when we have it.
	          const classUid = containerUid;
	          const key = `${classUid}::${node.name.text}`;
	          const nextContainer = methodByClassAndName.get(key) ?? containerUid;
	          ts.forEachChild(node, (child) => visit(child, nextContainer));
	          return;
	        }

	        ts.forEachChild(node, (child) => visit(child, containerUid));
	      }

      for (const st of sf.statements ?? []) visit(st, fileCallSourceUid);
      for (const r of callEdges) yield r;
      for (const r of callOccs) yield r;
    }
  };
}
