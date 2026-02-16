import path from 'node:path';

export const TREE_SITTER_LANGUAGE_CONFIG = {
  javascript: { wasm: 'tree-sitter-javascript.wasm', exts: ['.js', '.jsx', '.mjs', '.cjs'] },
  typescript: { wasm: 'tree-sitter-typescript.wasm', exts: ['.ts'] },
  tsx: { wasm: 'tree-sitter-tsx.wasm', exts: ['.tsx'] },
  python: { wasm: 'tree-sitter-python.wasm', exts: ['.py'] },
  go: { wasm: 'tree-sitter-go.wasm', exts: ['.go'] },
  java: { wasm: 'tree-sitter-java.wasm', exts: ['.java'] },
  csharp: { wasm: 'tree-sitter-c-sharp.wasm', exts: ['.cs'] },
  rust: { wasm: 'tree-sitter-rust.wasm', exts: ['.rs'] },
  ruby: { wasm: 'tree-sitter-ruby.wasm', exts: ['.rb'] },
  php: { wasm: 'tree-sitter-php.wasm', exts: ['.php'] },
  c: { wasm: 'tree-sitter-c.wasm', exts: ['.c', '.h'] },
  cpp: { wasm: 'tree-sitter-cpp.wasm', exts: ['.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx'] }
};

const EXT_TO_LANG = new Map();
for (const [lang, cfg] of Object.entries(TREE_SITTER_LANGUAGE_CONFIG)) {
  for (const ext of cfg.exts) EXT_TO_LANG.set(ext, lang);
}

export function treesitterLanguageForFilePath(filePath) {
  const ext = path.extname(String(filePath ?? '')).toLowerCase();
  return EXT_TO_LANG.get(ext) ?? null;
}
