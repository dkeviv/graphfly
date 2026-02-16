import fs from 'node:fs';
import path from 'node:path';

function shouldSkipDir(name) {
  return name === 'node_modules' || name === '.git' || name === '.hg' || name === '.svn' || name === 'dist' || name === 'build';
}

export function walkRepoFiles(absRoot) {
  const out = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && shouldSkipDir(entry.name)) continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else out.push(p);
    }
  }
  walk(absRoot);
  return out;
}

