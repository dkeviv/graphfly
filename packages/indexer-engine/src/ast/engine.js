import { createTypeScriptAstEngine } from './typescript/typescript-engine.js';
import { createTreeSitterAstEngine } from './treesitter/treesitter-engine.js';
import { createCompositeAstEngine } from './composite/composite-engine.js';

export function createAstEngineFromEnv({ env = process.env, repoRoot, sourceFileExists }) {
  const prod = String(env.GRAPHFLY_MODE ?? 'dev').toLowerCase() === 'prod';
  // SaaS default: composite engine.
  // - TypeScript compiler API for JS/TS/TSX (best cross-file resolution + validator extraction)
  // - Tree-sitter for all other supported languages (uniform multi-language coverage)
  // Dev default: TypeScript engine (vendored; zero-install).
  const defaultMode = prod ? 'composite' : 'typescript';
  const mode = String(env.GRAPHFLY_AST_ENGINE ?? defaultMode).toLowerCase();
  if (mode === 'none' || mode === 'off' || mode === '') return null;

  if (mode === 'composite' || mode === 'auto') {
    const engine = createCompositeAstEngine({ repoRoot, sourceFileExists });
    assertAstEngineShape(engine);
    return engine;
  }

  if (mode === 'tree-sitter' || mode === 'treesitter') {
    const engine = createTreeSitterAstEngine({ repoRoot, sourceFileExists });
    assertAstEngineShape(engine);
    return engine;
  }

  if (mode === 'typescript') {
    const engine = createTypeScriptAstEngine({ repoRoot, sourceFileExists });
    assertAstEngineShape(engine);
    return engine;
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
