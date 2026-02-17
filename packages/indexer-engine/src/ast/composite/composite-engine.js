import path from 'node:path';
import { createTypeScriptAstEngine } from '../typescript/typescript-engine.js';
import { createTreeSitterAstEngine } from '../treesitter/treesitter-engine.js';

function isJsTsLike({ filePath, language }) {
  const lang = String(language ?? '').toLowerCase();
  if (lang === 'js' || lang === 'javascript' || lang === 'ts' || lang === 'typescript' || lang === 'tsx') return true;
  const ext = path.extname(String(filePath ?? '')).toLowerCase();
  return ext === '.js' || ext === '.jsx' || ext === '.ts' || ext === '.tsx' || ext === '.mjs' || ext === '.cjs';
}

export function createCompositeAstEngine({ repoRoot, sourceFileExists }) {
  const ts = createTypeScriptAstEngine({ repoRoot, sourceFileExists });
  const tree = createTreeSitterAstEngine({ repoRoot, sourceFileExists });

  function pick({ filePath, language }) {
    return isJsTsLike({ filePath, language }) ? ts : tree;
  }

  function supportsLanguage(languageOrFileLang) {
    return Boolean(ts?.supportsLanguage?.(languageOrFileLang) || tree?.supportsLanguage?.(languageOrFileLang));
  }

  function parse({ filePath, language, text }) {
    return pick({ filePath, language }).parse({ filePath, language, text });
  }

  function precomputeExports({ filePath, language, ast, lines, sha, containerUid }) {
    const engine = pick({ filePath, language });
    if (typeof engine.precomputeExports !== 'function') return null;
    return engine.precomputeExports({ filePath, language, ast, lines, sha, containerUid });
  }

  function* extractRecords(args) {
    const engine = pick({ filePath: args?.filePath, language: args?.language });
    yield* engine.extractRecords(args);
  }

  return { supportsLanguage, parse, precomputeExports, extractRecords };
}

