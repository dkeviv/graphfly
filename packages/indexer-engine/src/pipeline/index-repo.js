import fs from 'node:fs';
import path from 'node:path';
import { walkRepoFiles } from '../repo/walk.js';
import { parsePackageJsonManifest } from '../sources/npm/package-json.js';
import { parsePackageLockJsonManifest } from '../sources/npm/package-lock-json.js';
import { parseYarnLockManifest } from '../sources/npm/yarn-lock.js';
import { parsePnpmLockManifest } from '../sources/npm/pnpm-lock.js';
import { parseGoModManifest } from '../sources/go/go-mod.js';
import { parseGoSumManifest } from '../sources/go/go-sum.js';
import { parseCargoTomlManifest } from '../sources/rust/cargo-toml.js';
import { parseCargoLockManifest } from '../sources/rust/cargo-lock.js';
import { parseRequirementsTxtManifest } from '../sources/python/requirements-txt.js';
import { parsePyprojectTomlManifest } from '../sources/python/pyproject-toml.js';
import { parseComposerJsonManifest } from '../sources/php/composer-json.js';
import { parseComposerLockManifest } from '../sources/php/composer-lock.js';
import { parsePomXmlManifest } from '../sources/java/pom-xml.js';
import { parseGradleBuildManifest } from '../sources/java/gradle-build.js';
import { parseCsprojManifest } from '../sources/csharp/csproj.js';
import { parseNuGetPackagesLockManifest } from '../sources/csharp/nuget-packages-lock.js';
import { parseJsFile } from '../sources/js/js-parser.js';
import { parsePythonFile } from '../sources/python/py-parser.js';
import { parseGoFile } from '../sources/go/go-parser.js';
import { parseRustFile } from '../sources/rust/rust-parser.js';
import { parseJavaFile } from '../sources/java/java-parser.js';
import { parseCSharpFile } from '../sources/csharp/csharp-parser.js';
import { parseRubyFile } from '../sources/ruby/ruby-parser.js';
import { parseGemfileManifest } from '../sources/ruby/gemfile.js';
import { parseGemfileLockManifest } from '../sources/ruby/gemfile-lock.js';
import { parsePhpFile } from '../sources/php/php-parser.js';
import { parseCFile } from '../sources/c/c-parser.js';
import { parseCppFile } from '../sources/cpp/cpp-parser.js';
import { parseSwiftFile } from '../sources/swift/swift-parser.js';
import { parseKotlinFile } from '../sources/kotlin/kotlin-parser.js';
import { computeSignatureHash, makeSymbolUid } from '../../../cig/src/identity.js';
import { embedText384 } from '../../../cig/src/embedding.js';
import { createTsPathResolver } from '../config/tsconfig.js';
import { createAstEngineFromEnv } from '../ast/engine.js';

function rel(absRoot, absPath) {
  const r = path.relative(absRoot, absPath);
  return r.split(path.sep).join('/');
}

function classify(filePath) {
  const p = String(filePath);
  if (p.endsWith('package.json')) return 'manifest:package.json';
  if (p.endsWith('package-lock.json')) return 'manifest:package-lock.json';
  if (p.endsWith('yarn.lock')) return 'manifest:yarn.lock';
  if (p.endsWith('pnpm-lock.yaml')) return 'manifest:pnpm-lock.yaml';
  if (p.endsWith('go.mod')) return 'manifest:go.mod';
  if (p.endsWith('go.sum')) return 'manifest:go.sum';
  if (p.endsWith('Cargo.toml')) return 'manifest:Cargo.toml';
  if (p.endsWith('Cargo.lock')) return 'manifest:Cargo.lock';
  if (p.endsWith('requirements.txt')) return 'manifest:requirements.txt';
  if (p.endsWith('pyproject.toml')) return 'manifest:pyproject.toml';
  if (p.endsWith('composer.json')) return 'manifest:composer.json';
  if (p.endsWith('composer.lock')) return 'manifest:composer.lock';
  if (p.endsWith('Gemfile')) return 'manifest:Gemfile';
  if (p.endsWith('Gemfile.lock')) return 'manifest:Gemfile.lock';
  if (p.endsWith('pom.xml')) return 'manifest:pom.xml';
  if (p.endsWith('build.gradle') || p.endsWith('build.gradle.kts')) return 'manifest:gradle';
  if (p.endsWith('.csproj')) return 'manifest:csproj';
  if (p.endsWith('packages.lock.json')) return 'manifest:packages.lock.json';
  if (p.endsWith('.js') || p.endsWith('.jsx') || p.endsWith('.ts') || p.endsWith('.tsx')) return 'source:js';
  if (p.endsWith('.py')) return 'source:python';
  if (p.endsWith('.go')) return 'source:go';
  if (p.endsWith('.rs')) return 'source:rust';
  if (p.endsWith('.java')) return 'source:java';
  if (p.endsWith('.cs')) return 'source:csharp';
  if (p.endsWith('.rb')) return 'source:ruby';
  if (p.endsWith('.php')) return 'source:php';
  if (p.endsWith('.c') || p.endsWith('.h')) return 'source:c';
  if (p.endsWith('.cc') || p.endsWith('.cpp') || p.endsWith('.cxx') || p.endsWith('.hpp') || p.endsWith('.hh') || p.endsWith('.hxx')) return 'source:cpp';
  if (p.endsWith('.swift')) return 'source:swift';
  if (p.endsWith('.kt') || p.endsWith('.kts')) return 'source:kotlin';
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

  yield {
    type: 'index_progress',
    data: {
      sha,
      mode: filter ? 'incremental' : 'full',
      phase: 'start',
      file_total: sourceFiles.length
    }
  };

  const sourceFileRelSet = new Set(sourceFiles.map((p) => rel(absRoot, p)));
  function sourceFileExists(relPath) {
    return sourceFileRelSet.has(String(relPath ?? ''));
  }
  const resolveTsAliasImport = createTsPathResolver({ repoRoot: absRoot, sourceFileExists });
  let astEngine = null;
  try {
    astEngine = createAstEngineFromEnv({ repoRoot: absRoot, sourceFileExists });
  } catch (e) {
    const prod = String(process.env.GRAPHFLY_MODE ?? 'dev').toLowerCase() === 'prod';
    const astRequired = String(process.env.GRAPHFLY_AST_REQUIRED ?? '').trim() === '1';
    // If an AST engine was explicitly requested but is unavailable:
    // - in prod (or when required), fail fast (avoid silently indexing with lower fidelity than expected).
    // - in dev, record diagnostics and continue with deterministic adapters.
    if (prod || astRequired) throw e;
    yield {
      type: 'index_diagnostic',
      data: {
        sha,
        mode: filter ? 'incremental' : 'full',
        phase: 'ast_engine',
        error: String(e?.message ?? e),
        engine: String(e?.engine ?? ''),
        note: 'falling back to built-in deterministic adapters'
      }
    };
    astEngine = null;
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
  let goModuleName = null;
  const fileByGoImportPath = new Map(); // import path -> representative file_path

  function jsLikeLanguageForFile(filePath) {
    const p = String(filePath);
    if (p.endsWith('.ts') || p.endsWith('.tsx')) return 'ts';
    return 'js';
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
                    : kind === 'source:c'
                      ? 'c'
                      : kind === 'source:cpp'
                        ? 'cpp'
                        : kind === 'source:swift'
                          ? 'swift'
                          : kind === 'source:kotlin'
                            ? 'kotlin'
                    : kind === 'source:js'
                      ? jsLikeLanguageForFile(filePath)
                      : languageHint ?? 'js';
    const node = makeFileNode({ filePath, language: lang, sha });
    fileToUid.set(filePath, node.symbol_uid);
    yield { type: 'node', data: node };
  }

  // Precompute exports for JS/TS files when the AST engine supports it.
  // This enables stable import/call resolution independent of file traversal order.
  if (astEngine && typeof astEngine.precomputeExports === 'function') {
    for (const absFile of sourceFiles) {
      const filePath = rel(absRoot, absFile);
      const kind = classify(filePath);
      if (kind !== 'source:js') continue;
      try {
        const text = fs.readFileSync(absFile, 'utf8');
        const lines = text.split('\n');
        const language = jsLikeLanguageForFile(filePath);
        const res = astEngine.parse({ filePath, language, text });
        if (!res?.ok) continue;
        const byName = astEngine.precomputeExports({
          filePath,
          language,
          ast: res.ast,
          lines,
          sha,
          containerUid: fileToUid.get(filePath) ?? null
        });
        if (byName && typeof byName.get === 'function') exportedByFile.set(filePath, byName);
      } catch (e) {
        // Non-fatal: extraction will still work; call graph may be less complete.
        yield emitParseError({ filePath, phase: 'precompute_exports', err: e });
      }
    }
  }

  // Manifests + declared deps.
  for (const absManifest of manifestFiles) {
    const filePath = rel(absRoot, absManifest);
    const kind = classify(filePath);
    const common = { absManifestPath: absManifest, filePath, sha, packageToUid };
    const records =
      kind === 'manifest:package.json'
        ? parsePackageJsonManifest(common)
        : kind === 'manifest:package-lock.json'
          ? parsePackageLockJsonManifest(common)
          : kind === 'manifest:yarn.lock'
            ? parseYarnLockManifest(common)
            : kind === 'manifest:pnpm-lock.yaml'
              ? parsePnpmLockManifest(common)
        : kind === 'manifest:go.mod'
          ? parseGoModManifest(common)
          : kind === 'manifest:go.sum'
            ? parseGoSumManifest(common)
          : kind === 'manifest:Cargo.toml'
            ? parseCargoTomlManifest(common)
            : kind === 'manifest:Cargo.lock'
              ? parseCargoLockManifest(common)
          : kind === 'manifest:requirements.txt'
            ? parseRequirementsTxtManifest(common)
            : kind === 'manifest:pyproject.toml'
              ? parsePyprojectTomlManifest(common)
          : kind === 'manifest:composer.json'
            ? parseComposerJsonManifest(common)
            : kind === 'manifest:composer.lock'
              ? parseComposerLockManifest(common)
            : kind === 'manifest:Gemfile'
              ? parseGemfileManifest(common)
              : kind === 'manifest:Gemfile.lock'
                ? parseGemfileLockManifest(common)
                : kind === 'manifest:pom.xml'
                  ? parsePomXmlManifest(common)
                  : kind === 'manifest:gradle'
                    ? parseGradleBuildManifest(common)
                    : kind === 'manifest:csproj'
                      ? parseCsprojManifest(common)
                      : kind === 'manifest:packages.lock.json'
                        ? parseNuGetPackagesLockManifest(common)
                : [];
    for (const record of records) {
      if (!goModuleName && kind === 'manifest:go.mod' && record?.type === 'dependency_manifest') {
        const mod = record?.data?.parsed?.moduleName ?? null;
        if (typeof mod === 'string' && mod.length > 0) goModuleName = mod;
      }
      yield record;
    }
  }

  // Best-effort local Go package resolution map (import path -> representative file node).
  if (goModuleName) {
    for (const absFile of sourceFiles) {
      const filePath = rel(absRoot, absFile);
      if (!filePath.endsWith('.go')) continue;
      const dir = path.posix.dirname(filePath);
      const importPath = dir === '.' ? goModuleName : `${goModuleName}/${dir}`;
      const prev = fileByGoImportPath.get(importPath) ?? null;
      if (!prev || filePath < prev) fileByGoImportPath.set(importPath, filePath);
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
  for (let fileIndex = 0; fileIndex < sourceFiles.length; fileIndex++) {
    const absFile = sourceFiles[fileIndex];
    const filePath = rel(absRoot, absFile);
    const sourceUid = fileToUid.get(filePath) ?? null;
    const maxBytes = Number(process.env.GRAPHFLY_INDEXER_MAX_FILE_BYTES ?? 2_000_000);
    let size = 0;
    try {
      size = fs.statSync(absFile).size;
    } catch {
      size = 0;
    }
    if (Number.isFinite(maxBytes) && maxBytes > 0 && size > maxBytes) {
      yield emitParseError({ filePath, phase: 'skip_large_file', err: new Error(`file_too_large:${size}`) });
      continue;
    }
    const text = fs.readFileSync(absFile, 'utf8');
    const lines = text.split('\n');

    yield {
      type: 'index_progress',
      data: {
        sha,
        mode: filter ? 'incremental' : 'full',
        phase: 'file',
        file_path: filePath,
        file_index: fileIndex + 1,
        file_total: sourceFiles.length
      }
    };

    const kind = classify(filePath);
    try {
      if (kind === 'source:python') {
        for (const record of parsePythonFile({ filePath, lines, sha, containerUid: sourceUid, exportedByFile, packageToUid, sourceFileExists })) {
          yield record;
        }
      } else if (kind === 'source:go') {
        for (const record of parseGoFile({
          filePath,
          lines,
          sha,
          containerUid: sourceUid,
          exportedByFile,
          packageToUid,
          goModuleName,
          fileByGoImportPath,
          sourceFileExists
        })) {
          yield record;
        }
      } else if (kind === 'source:rust') {
        for (const record of parseRustFile({ filePath, lines, sha, containerUid: sourceUid, exportedByFile, packageToUid, sourceFileExists })) {
          yield record;
        }
      } else if (kind === 'source:java') {
        for (const record of parseJavaFile({ filePath, lines, sha, containerUid: sourceUid, exportedByFile, packageToUid, sourceFileExists })) {
          yield record;
        }
      } else if (kind === 'source:csharp') {
        for (const record of parseCSharpFile({ filePath, lines, sha, containerUid: sourceUid, exportedByFile, packageToUid, sourceFileExists })) {
          yield record;
        }
      } else if (kind === 'source:ruby') {
        for (const record of parseRubyFile({ filePath, lines, sha, containerUid: sourceUid, exportedByFile, packageToUid, sourceFileExists })) {
          yield record;
        }
      } else if (kind === 'source:php') {
        for (const record of parsePhpFile({ filePath, lines, sha, containerUid: sourceUid, exportedByFile, packageToUid, sourceFileExists })) {
          yield record;
        }
      } else if (kind === 'source:c') {
        for (const record of parseCFile({ filePath, lines, sha, containerUid: sourceUid, exportedByFile, packageToUid, sourceFileExists })) {
          yield record;
        }
      } else if (kind === 'source:cpp') {
        for (const record of parseCppFile({ filePath, lines, sha, containerUid: sourceUid, exportedByFile, packageToUid, sourceFileExists })) {
          yield record;
        }
      } else if (kind === 'source:swift') {
        for (const record of parseSwiftFile({ filePath, lines, sha, containerUid: sourceUid, exportedByFile, packageToUid, sourceFileExists })) {
          yield record;
        }
      } else if (kind === 'source:kotlin') {
        for (const record of parseKotlinFile({ filePath, lines, sha, containerUid: sourceUid, exportedByFile, packageToUid, sourceFileExists })) {
          yield record;
        }
      } else {
        let usedAst = false;
        if (astEngine) {
          try {
            const res = astEngine.parse({ filePath, language: jsLikeLanguageForFile(filePath), text });
            if (res?.ok) {
              usedAst = true;
              for (const record of astEngine.extractRecords({
                filePath,
                language: jsLikeLanguageForFile(filePath),
                ast: res.ast,
                text,
                lines,
                sha,
                containerUid: sourceUid,
                exportedByFile,
                packageToUid,
                sourceFileExists,
                resolveAliasImport: resolveTsAliasImport
              })) {
                yield record;
              }
            }
          } catch (e) {
            yield emitParseError({ filePath, phase: 'parse_ast', err: e });
          }
        }
        if (!usedAst) {
          for (const record of parseJsFile({
            filePath,
            lines,
            sha,
            containerUid: sourceUid,
            exportedByFile,
            packageToUid,
            sourceFileExists,
            resolveAliasImport: resolveTsAliasImport
          })) {
            yield record;
          }
        }
      }
    } catch (e) {
      yield emitParseError({ filePath, phase: 'parse_source', err: e });
    }
  }
}
