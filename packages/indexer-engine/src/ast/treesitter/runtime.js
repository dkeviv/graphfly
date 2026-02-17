import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const LANGUAGE_MODULES = {
  javascript: { pkg: 'tree-sitter-javascript', export: 'default' },
  typescript: { pkg: 'tree-sitter-typescript', export: 'typescript' },
  tsx: { pkg: 'tree-sitter-typescript', export: 'tsx' },
  python: { pkg: 'tree-sitter-python', export: 'default' },
  go: { pkg: 'tree-sitter-go', export: 'default' },
  java: { pkg: 'tree-sitter-java', export: 'default' },
  csharp: { pkg: 'tree-sitter-c-sharp', export: 'default' },
  rust: { pkg: 'tree-sitter-rust', export: 'default' },
  ruby: { pkg: 'tree-sitter-ruby', export: 'default' },
  php: { pkg: 'tree-sitter-php', export: 'php' },
  c: { pkg: 'tree-sitter-c', export: 'default' },
  cpp: { pkg: 'tree-sitter-cpp', export: 'default' },
  swift: { pkg: 'tree-sitter-swift', export: 'default' },
  kotlin: { pkg: 'tree-sitter-kotlin', export: 'default' }
};

export function loadTreeSitterRuntime() {
  try {
    const Parser = require('tree-sitter');
    return Parser?.default ?? Parser;
  } catch (e) {
    const err = new Error('ast_engine_unavailable: tree-sitter runtime missing (install tree-sitter)');
    err.code = 'ast_engine_unavailable';
    err.engine = 'tree-sitter';
    err.cause = e;
    throw err;
  }
}

export function loadTreeSitterLanguage(lang) {
  const cfg = LANGUAGE_MODULES[String(lang ?? '')];
  if (!cfg) return null;
  try {
    const mod = require(cfg.pkg);
    const exported = cfg.export === 'default' ? (mod?.default ?? mod) : mod?.[cfg.export] ?? null;
    if (!exported) throw new Error(`language_export_missing:${cfg.pkg}:${cfg.export}`);
    return exported;
  } catch (e) {
    const err = new Error(`ast_engine_unavailable: tree-sitter language missing for ${lang} (install ${cfg.pkg})`);
    err.code = 'ast_engine_unavailable';
    err.engine = 'tree-sitter';
    err.language = lang;
    err.cause = e;
    throw err;
  }
}
