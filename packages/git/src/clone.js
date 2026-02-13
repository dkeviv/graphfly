import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

function runGit(args, { cwd } = {}) {
  const p = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (p.status !== 0) {
    const msg = (p.stderr || p.stdout || '').trim();
    throw new Error(`git ${args.join(' ')} failed: ${msg}`);
  }
  return p.stdout.trim();
}

export function cloneAtSha({ source, sha, destDir }) {
  if (!source) throw new Error('source required');
  if (!sha) throw new Error('sha required');
  if (!destDir) throw new Error('destDir required');
  if (fs.existsSync(destDir) && fs.readdirSync(destDir).length > 0) throw new Error('destDir must be empty');

  runGit(['clone', '--no-checkout', source, destDir]);
  runGit(['-C', destDir, 'checkout', sha, '--'], {});
  return { ok: true, destDir };
}

