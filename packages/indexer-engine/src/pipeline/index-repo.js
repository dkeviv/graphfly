import fs from 'node:fs';
import path from 'node:path';
import { walkRepoFiles } from '../repo/walk.js';
import { parsePackageJsonManifest } from '../sources/npm/package-json.js';
import { parseGoModManifest } from '../sources/go/go-mod.js';
import { parseCargoTomlManifest } from '../sources/rust/cargo-toml.js';
import { parseRequirementsTxtManifest } from '../sources/python/requirements-txt.js';
import { parseComposerJsonManifest } from '../sources/php/composer-json.js';
import { parseJsFile } from '../sources/js/js-parser.js';
import { parsePythonFile } from '../sources/python/py-parser.js';
import { parseGoFile } from '../sources/go/go-parser.js';
import { parseRustFile } from '../sources/rust/rust-parser.js';
import { parseJavaFile } from '../sources/java/java-parser.js';
import { parseCSharpFile } from '../sources/csharp/csharp-parser.js';
import { parseRubyFile } from '../sources/ruby/ruby-parser.js';
import { parsePhpFile } from '../sources/php/php-parser.js';
import { computeSignatureHash, makeSymbolUid } from '../../../cig/src/identity.js';
import { embedText384 } from '../../../cig/src/embedding.js';

function rel(absRoot, absPath) {
  const r = path.relative(absRoot, absPath);
  return r.split(path.sep).join('/');
}

function classify(filePath) {
  const p = String(filePath);
  if (p.endsWith('package.json')) return 'manifest:package.json';
  if (p.endsWith('go.mod')) return 'manifest:go.mod';
  if (p.endsWith('Cargo.toml')) return 'manifest:Cargo.toml';
  if (p.endsWith('requirements.txt')) return 'manifest:requirements.txt';
  if (p.endsWith('composer.json')) return 'manifest:composer.json';
  if (p.endsWith('.js') || p.endsWith('.jsx') || p.endsWith('.ts') || p.endsWith('.tsx')) return 'source:js';
  if (p.endsWith('.py')) return 'source:python';
  if (p.endsWith('.go')) return 'source:go';
  if (p.endsWith('.rs')) return 'source:rust';
  if (p.endsWith('.java')) return 'source:java';
  if (p.endsWith('.cs')) return 'source:csharp';
  if (p.endsWith('.rb')) return 'source:ruby';
  if (p.endsWith('.php')) return 'source:php';
  return null;
}

function makeFileNode({ filePath, language, sha }) {
  const qualifiedName = filePath.replaceAll('/', '.');
  const signature = `file ${filePath}`;
  const signatureHash = computeSignatureHash({ signature });
  const symbolUid = makeSymbolUid({ language, qualifiedName, signatureHash });
  return {
    symbol_uid: symbolUid,
    qualified_name: qualifiedName,
    name: path.posix.basename(filePath),
    node_type: 'File',
    symbol_kind: 'module',
    file_path: filePath,
    line_start: 1,
    line_end: 1,
    language,
    visibility: 'internal',
    signature,
    signature_hash: signatureHash,
    contract: null,
    constraints: null,
    allowable_values: null,
    embedding_text: `${qualifiedName} ${signature}`,
    embedding: embedText384(`${qualifiedName} ${signature}`),
    first_seen_sha: sha ?? 'mock',
    last_seen_sha: sha ?? 'mock'
  };
}

export async function* indexRepoRecords({ repoRoot, sha, changedFiles = [], removedFiles = [], languageHint = null } = {}) {
  const absRoot = path.resolve(String(repoRoot));

  const filter = Array.isArray(changedFiles) && changedFiles.length > 0 ? new Set(changedFiles) : null;
  const allFiles = filter
    ? changedFiles.map((p) => path.join(absRoot, p)).filter((p) => fs.existsSync(p))
    : walkRepoFiles(absRoot);

  const sourceFiles = [];
  const manifestFiles = [];
  for (const abs of allFiles) {
    const filePath = rel(absRoot, abs);
    const kind = classify(filePath);
    if (kind && kind.startsWith('manifest:')) manifestFiles.push(abs);
    else if (kind && kind.startsWith('source:')) sourceFiles.push(abs);
  }

  // Index diagnostics (always emitted; useful for incremental correctness visibility).
  yield {
    type: 'index_diagnostic',
    data: {
      sha,
      mode: filter ? 'incremental' : 'full',
      changed_files: Array.isArray(changedFiles) ? changedFiles : [],
      removed_files: Array.isArray(removedFiles) ? removedFiles : [],
      reparsed_files: sourceFiles.map((p) => rel(absRoot, p)),
      impacted_files: [],
      note: filter ? 'builtin indexer reparses changed files only' : 'builtin indexer reparses full repo'
    }
  };

  const fileToUid = new Map(); // file_path -> symbol_uid
  const exportedByFile = new Map(); // file_path -> Map(name -> symbol_uid)
  const packageToUid = new Map(); // package_key -> symbol_uid
  const depDeclared = new Map(); // package_key -> { ranges: Map(version_range -> Set(file_path)), declaredIn: Set(file_path), scopes: Set(scope) }
  const depObserved = new Map(); // package_key -> Set(file_path)

  function trackRecord(record) {
    if (!record || typeof record !== 'object') return;
    if (record.type === 'declared_dependency') {
      const d = record.data ?? {};
      const pk = String(d.package_key ?? '');
      if (!pk) return;
      const manifestKey = String(d.manifest_key ?? '');
      const filePath = manifestKey.includes('::') ? manifestKey.split('::')[0] : null;
      const versionRange = String(d.version_range ?? '*');
      const scope = String(d.scope ?? 'prod');
      if (!depDeclared.has(pk)) depDeclared.set(pk, { ranges: new Map(), declaredIn: new Set(), scopes: new Set() });
      const entry = depDeclared.get(pk);
      entry.scopes.add(scope);
      if (filePath) entry.declaredIn.add(filePath);
      if (!entry.ranges.has(versionRange)) entry.ranges.set(versionRange, new Set());
      if (filePath) entry.ranges.get(versionRange).add(filePath);
    } else if (record.type === 'observed_dependency') {
      const o = record.data ?? {};
      const pk = String(o.package_key ?? '');
      const filePath = String(o.file_path ?? '');
      if (!pk || !filePath) return;
      if (!depObserved.has(pk)) depObserved.set(pk, new Set());
      depObserved.get(pk).add(filePath);
    }
  }

  // Emit File nodes first.
  for (const absFile of sourceFiles) {
    const filePath = rel(absRoot, absFile);
    const kind = classify(filePath);
    const lang =
      kind === 'source:python'
        ? 'python'
        : kind === 'source:go'
          ? 'go'
          : kind === 'source:rust'
            ? 'rust'
            : kind === 'source:java'
              ? 'java'
              : kind === 'source:csharp'
                ? 'csharp'
                : kind === 'source:ruby'
                  ? 'ruby'
                  : kind === 'source:php'
                    ? 'php'
                    : languageHint ?? 'js';
    const node = makeFileNode({ filePath, language: lang, sha });
    fileToUid.set(filePath, node.symbol_uid);
    const rec = { type: 'node', data: node };
    trackRecord(rec);
    yield rec;
  }

  // Manifests + declared deps.
  for (const absManifest of manifestFiles) {
    const filePath = rel(absRoot, absManifest);
    const kind = classify(filePath);
    const common = { absManifestPath: absManifest, filePath, sha, packageToUid };
    const records =
      kind === 'manifest:package.json'
        ? parsePackageJsonManifest(common)
        : kind === 'manifest:go.mod'
          ? parseGoModManifest(common)
          : kind === 'manifest:Cargo.toml'
            ? parseCargoTomlManifest(common)
            : kind === 'manifest:requirements.txt'
              ? parseRequirementsTxtManifest(common)
              : kind === 'manifest:composer.json'
                ? parseComposerJsonManifest(common)
                : [];
    for (const record of records) {
      trackRecord(record);
      yield record;
    }
  }

  function emitParseError({ filePath, phase, err }) {
    return {
      type: 'index_diagnostic',
      data: {
        sha,
        mode: filter ? 'incremental' : 'full',
        file_path: filePath,
        phase,
        error: String(err?.message ?? err)
      }
    }
  }

  // Source parsing.
  for (const absFile of sourceFiles) {
    const filePath = rel(absRoot, absFile);
    const sourceUid = fileToUid.get(filePath) ?? null;
    const text = fs.readFileSync(absFile, 'utf8');
    const lines = text.split('\n');

    const kind = classify(filePath);
    try {
      if (kind === 'source:python') {
        for (const record of parsePythonFile({ filePath, lines, sha, containerUid: sourceUid, exportedByFile, packageToUid })) {
          trackRecord(record);
          yield record;
        }
      } else if (kind === 'source:go') {
        for (const record of parseGoFile({ filePath, lines, sha, containerUid: sourceUid, exportedByFile, packageToUid })) {
          trackRecord(record);
          yield record;
        }
      } else if (kind === 'source:rust') {
        for (const record of parseRustFile({ filePath, lines, sha, containerUid: sourceUid, exportedByFile, packageToUid })) {
          trackRecord(record);
          yield record;
        }
      } else if (kind === 'source:java') {
        for (const record of parseJavaFile({ filePath, lines, sha, containerUid: sourceUid, exportedByFile, packageToUid })) {
          trackRecord(record);
          yield record;
        }
      } else if (kind === 'source:csharp') {
        for (const record of parseCSharpFile({ filePath, lines, sha, containerUid: sourceUid, exportedByFile, packageToUid })) {
          trackRecord(record);
          yield record;
        }
      } else if (kind === 'source:ruby') {
        for (const record of parseRubyFile({ filePath, lines, sha, containerUid: sourceUid, exportedByFile, packageToUid })) {
          trackRecord(record);
          yield record;
        }
      } else if (kind === 'source:php') {
        for (const record of parsePhpFile({ filePath, lines, sha, containerUid: sourceUid, exportedByFile, packageToUid })) {
          trackRecord(record);
          yield record;
        }
      } else {
        for (const record of parseJsFile({ filePath, lines, sha, containerUid: sourceUid, exportedByFile, packageToUid })) {
          trackRecord(record);
          yield record;
        }
      }
    } catch (e) {
      yield emitParseError({ filePath, phase: 'parse_source', err: e });
    }
  }

  // Dependency mismatches (declared vs observed) without assuming code or manifest is “correct”.
  const declaredKeys = new Set(depDeclared.keys());
  const observedKeys = new Set(depObserved.keys());

  for (const pk of declaredKeys) {
    if (observedKeys.has(pk)) continue;
    const entry = depDeclared.get(pk);
    yield {
      type: 'dependency_mismatch',
      data: {
        mismatch_type: 'declared_but_unused',
        package_key: pk,
        details: {
          declared_in_files: Array.from(entry?.declaredIn ?? []).sort(),
          scopes: Array.from(entry?.scopes ?? []).sort(),
          version_ranges: Array.from(entry?.ranges?.keys?.() ?? []).sort()
        },
        sha
      }
    };
  }

  for (const pk of observedKeys) {
    if (declaredKeys.has(pk)) continue;
    const files = Array.from(depObserved.get(pk) ?? []).sort();
    yield {
      type: 'dependency_mismatch',
      data: {
        mismatch_type: 'used_but_undeclared',
        package_key: pk,
        details: { observed_in_files: files },
        sha
      }
    };
  }

  for (const [pk, entry] of depDeclared.entries()) {
    const ranges = entry?.ranges;
    if (!ranges || ranges.size <= 1) continue;
    const details = {
      package_key: pk,
      version_ranges: Array.from(ranges.keys()).sort(),
      manifests: Array.from(ranges.entries()).map(([range, files]) => ({ version_range: range, files: Array.from(files).sort() }))
    };
    yield {
      type: 'dependency_mismatch',
      data: { mismatch_type: 'version_conflict', package_key: pk, details, sha }
    };
  }
}
