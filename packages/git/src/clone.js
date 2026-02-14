import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { withGitAskpass } from './askpass.js';

function runGit(args, { cwd, env } = {}) {
  const p = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...(env ?? {}) } });
  if (p.status !== 0) {
    const msg = (p.stderr || p.stdout || '').trim();
    throw new Error(`git ${args.join(' ')} failed: ${msg}`);
  }
  return p.stdout.trim();
}

export function cloneAtSha({ source, sha, destDir, auth = null }) {
  if (!source) throw new Error('source required');
  if (!sha) throw new Error('sha required');
  if (!destDir) throw new Error('destDir required');
  if (fs.existsSync(destDir) && fs.readdirSync(destDir).length > 0) throw new Error('destDir must be empty');

  const doClone = ({ env } = {}) => {
    runGit(['clone', '--no-checkout', source, destDir], { env });
    runGit(['-C', destDir, 'checkout', sha, '--'], { env });
  };

  if (auth?.username && auth?.password) {
    withGitAskpass({ username: auth.username, password: auth.password }, ({ env }) => doClone({ env }));
  } else {
    doClone();
  }
  return { ok: true, destDir };
}
