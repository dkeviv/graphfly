import fs from 'node:fs';
import path from 'node:path';

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readJsonIfExists(absPath) {
  if (!fs.existsSync(absPath)) return null;
  const raw = fs.readFileSync(absPath, 'utf8');
  return safeJsonParse(raw);
}

function normalizePosix(p) {
  return String(p ?? '').split(path.sep).join('/');
}

function buildCandidates(baseRel) {
  const base = String(baseRel ?? '');
  if (!base) return [];
  const hasExt = /\.[A-Za-z0-9]+$/.test(base);
  if (hasExt) return [base];
  const exts = ['.ts', '.tsx', '.js', '.jsx'];
  const out = [];
  for (const ext of exts) out.push(`${base}${ext}`);
  for (const ext of exts) out.push(`${base}/index${ext}`);
  return out;
}

function matchWildcard(pattern, value) {
  const i = pattern.indexOf('*');
  if (i < 0) return null;
  const pre = pattern.slice(0, i);
  const post = pattern.slice(i + 1);
  if (!value.startsWith(pre)) return null;
  if (!value.endsWith(post)) return null;
  return value.slice(pre.length, value.length - post.length);
}

export function createTsPathResolver({ repoRoot, sourceFileExists }) {
  const absRoot = path.resolve(String(repoRoot));
  const tsconfig = readJsonIfExists(path.join(absRoot, 'tsconfig.json')) ?? readJsonIfExists(path.join(absRoot, 'jsconfig.json'));
  const compilerOptions = tsconfig?.compilerOptions ?? {};
  const baseUrlRaw = compilerOptions.baseUrl ?? '.';
  const baseUrl = normalizePosix(baseUrlRaw);
  const paths = compilerOptions.paths ?? null;

  if (!paths || typeof paths !== 'object') {
    return function resolveAliasImport(spec) {
      void spec;
      return null;
    };
  }

  const entries = Object.entries(paths)
    .map(([k, v]) => ({ key: String(k), targets: Array.isArray(v) ? v.map((x) => String(x)) : [] }))
    .filter((e) => e.key.length > 0 && e.targets.length > 0);

  return function resolveAliasImport(spec) {
    const s = String(spec ?? '').trim();
    if (!s || s.startsWith('.') || s.startsWith('/') || s.startsWith('http:') || s.startsWith('https:')) return null;

    for (const e of entries) {
      const star = e.key.includes('*') ? matchWildcard(e.key, s) : null;
      const matches = e.key.includes('*') ? star !== null : e.key === s;
      if (!matches) continue;

      for (const t of e.targets) {
        const target = t.includes('*') && star !== null ? t.replaceAll('*', star) : t;
        const joined = normalizePosix(path.posix.normalize(path.posix.join(baseUrl, target)));
        for (const c of buildCandidates(joined)) {
          if (typeof sourceFileExists === 'function' && sourceFileExists(c)) return c;
        }
      }
    }
    return null;
  };
}

