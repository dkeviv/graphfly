export function createAstEngineFromEnv({ env = process.env, repoRoot, sourceFileExists }) {
  const mode = String(env.GRAPHFLY_AST_ENGINE ?? 'none').toLowerCase();
  if (mode === 'none' || mode === 'off' || mode === '') return null;

  if (mode === 'tree-sitter' || mode === 'treesitter') {
    // This is intentionally a hard error until the dependency is installed/vendored.
    // We keep the interface stable so adding Tree-sitter later does not require a pipeline rewrite.
    const err = new Error('ast_engine_unavailable: tree-sitter dependency not installed');
    err.code = 'ast_engine_unavailable';
    err.engine = 'tree-sitter';
    throw err;
  }

  if (mode === 'typescript') {
    const err = new Error('ast_engine_unavailable: typescript dependency not installed');
    err.code = 'ast_engine_unavailable';
    err.engine = 'typescript';
    throw err;
  }

  const err = new Error(`ast_engine_unknown: ${mode}`);
  err.code = 'ast_engine_unknown';
  throw err;
}

// Interface contract (future):
// engine.parse({ filePath, language, text }) => { ok: true, ast, diagnostics[] } | { ok:false, error, diagnostics[] }
// engine.extractRecords({ filePath, language, ast, sha, containerUid, packageToUid, ... }) => Iterable<NDJSONRecord>
export function assertAstEngineShape(engine) {
  if (!engine) return;
  if (typeof engine.parse !== 'function') throw new Error('invalid_ast_engine: missing parse()');
  if (typeof engine.extractRecords !== 'function') throw new Error('invalid_ast_engine: missing extractRecords()');
}

