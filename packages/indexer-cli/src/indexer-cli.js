import { spawn } from 'node:child_process';

function parseArgsJson(env) {
  const raw = env.GRAPHFLY_INDEXER_ARGS_JSON ?? '';
  if (!raw) return [];
  let v;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new Error('GRAPHFLY_INDEXER_ARGS_JSON must be a JSON array');
  }
  if (!Array.isArray(v)) throw new Error('GRAPHFLY_INDEXER_ARGS_JSON must be a JSON array');
  return v.map((x) => String(x));
}

export function resolveIndexerCommand({ env = process.env } = {}) {
  const cmd = String(env.GRAPHFLY_INDEXER_CMD ?? '').trim();
  if (!cmd) return null;
  const args = parseArgsJson(env);
  return { cmd, args };
}

export function runIndexerNdjson({
  repoRoot,
  sha,
  changedFiles = [],
  removedFiles = [],
  env = process.env,
  timeoutMs = 10 * 60 * 1000
} = {}) {
  const resolved = resolveIndexerCommand({ env });
  if (!resolved) {
    const err = new Error('indexer_not_configured');
    err.code = 'indexer_not_configured';
    throw err;
  }
  if (!repoRoot) throw new Error('repoRoot is required');
  const childEnv = {
    ...env,
    GRAPHFLY_REPO_ROOT: String(repoRoot),
    GRAPHFLY_SHA: String(sha ?? ''),
    GRAPHFLY_CHANGED_FILES_JSON: JSON.stringify(Array.isArray(changedFiles) ? changedFiles : []),
    GRAPHFLY_REMOVED_FILES_JSON: JSON.stringify(Array.isArray(removedFiles) ? removedFiles : [])
  };

  const child = spawn(resolved.cmd, resolved.args, {
    cwd: String(repoRoot),
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (d) => {
    stderr += String(d ?? '');
    if (stderr.length > 64_000) stderr = stderr.slice(-64_000);
  });

  const to = setTimeout(() => {
    child.kill('SIGKILL');
  }, Math.max(5_000, Number(timeoutMs) || 0));

  const exited = new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });

  async function waitForExitOk() {
    const { code, signal } = await exited;
    clearTimeout(to);
    if (code === 0) return { ok: true };
    const err = new Error(`indexer_failed: code=${code} signal=${signal ?? ''} stderr=${stderr.trim()}`);
    err.code = 'indexer_failed';
    err.exitCode = code;
    err.signal = signal;
    err.stderr = stderr;
    throw err;
  }

  return { stdout: child.stdout, waitForExitOk };
}

