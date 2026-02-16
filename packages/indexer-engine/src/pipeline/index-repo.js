import fs from 'node:fs';
import path from 'node:path';
import { walkRepoFiles } from '../repo/walk.js';
import { parsePackageJsonManifest } from '../sources/npm/package-json.js';
import { parseJsFile } from '../sources/js/js-parser.js';
import { parsePythonFile } from '../sources/python/py-parser.js';
import { computeSignatureHash, makeSymbolUid } from '../../../cig/src/identity.js';
import { embedText384 } from '../../../cig/src/embedding.js';

function rel(absRoot, absPath) {
  const r = path.relative(absRoot, absPath);
  return r.split(path.sep).join('/');
}

function classify(filePath) {
  const p = String(filePath);
  if (p.endsWith('package.json')) return 'manifest:package.json';
  if (p.endsWith('.js') || p.endsWith('.jsx') || p.endsWith('.ts') || p.endsWith('.tsx')) return 'source:js';
  if (p.endsWith('.py')) return 'source:python';
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
    if (kind === 'manifest:package.json') manifestFiles.push(abs);
    else if (kind === 'source:js' || kind === 'source:python') sourceFiles.push(abs);
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

  // Emit File nodes first.
  for (const absFile of sourceFiles) {
    const filePath = rel(absRoot, absFile);
    const kind = classify(filePath);
    const lang = kind === 'source:python' ? 'python' : languageHint ?? 'js';
    const node = makeFileNode({ filePath, language: lang, sha });
    fileToUid.set(filePath, node.symbol_uid);
    yield { type: 'node', data: node };
  }

  // Manifests (NPM) + declared deps.
  for (const absManifest of manifestFiles) {
    const filePath = rel(absRoot, absManifest);
    for (const record of parsePackageJsonManifest({
      absManifestPath: absManifest,
      filePath,
      sha,
      packageToUid
    })) {
      yield record;
    }
  }

  // Source parsing.
  for (const absFile of sourceFiles) {
    const filePath = rel(absRoot, absFile);
    const sourceUid = fileToUid.get(filePath) ?? null;
    const text = fs.readFileSync(absFile, 'utf8');
    const lines = text.split('\n');

    const kind = classify(filePath);
    if (kind === 'source:python') {
      for (const record of parsePythonFile({ filePath, lines, sha, containerUid: sourceUid, exportedByFile, packageToUid })) yield record;
    } else {
      for (const record of parseJsFile({ filePath, lines, sha, containerUid: sourceUid, exportedByFile, packageToUid })) yield record;
    }
  }
}

