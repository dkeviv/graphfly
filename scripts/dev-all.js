import { spawn } from 'node:child_process';

function run(cmd, args, { env = process.env, name } = {}) {
  const p = spawn(cmd, args, { env, stdio: 'inherit' });
  p.on('exit', (code) => {
    if (code && code !== 0) {
      // eslint-disable-next-line no-console
      console.error(`[dev-all] ${name ?? cmd} exited with code ${code}`);
      process.exitCode = code;
    }
  });
  return p;
}

function usage() {
  return [
    'node scripts/dev-all.js [--pg]',
    '',
    'Modes:',
    '  (default) memory queues; API drains jobs in-process (fast local UI testing).',
    '  --pg      durable queues + workers (closer to prod; requires DATABASE_URL + migrations).'
  ].join('\n');
}

const args = new Set(process.argv.slice(2));
if (args.has('--help') || args.has('-h')) {
  // eslint-disable-next-line no-console
  console.log(usage());
  process.exit(0);
}

const usePg = args.has('--pg');
const env = { ...process.env };
if (!env.GRAPHFLY_MODE) env.GRAPHFLY_MODE = 'dev';
if (!env.GRAPHFLY_AUTH_MODE) env.GRAPHFLY_AUTH_MODE = 'none';

if (usePg) {
  if (!env.GRAPHFLY_QUEUE_MODE) env.GRAPHFLY_QUEUE_MODE = 'pg';
} else {
  env.GRAPHFLY_QUEUE_MODE = 'memory';
}

const procs = [];
procs.push(run(process.execPath, ['apps/api/src/server.js'], { env, name: 'api' }));
procs.push(run(process.execPath, ['apps/web/dev-server.js'], { env, name: 'web' }));

if (usePg) {
  procs.push(run(process.execPath, ['workers/indexer/src/queue-runner.js'], { env, name: 'worker:indexer' }));
  procs.push(run(process.execPath, ['workers/doc-agent/src/queue-runner.js'], { env, name: 'worker:doc' }));
  procs.push(run(process.execPath, ['workers/graph-agent/src/queue-runner.js'], { env, name: 'worker:graph' }));
}

function shutdown() {
  for (const p of procs) {
    try {
      p.kill('SIGTERM');
    } catch {}
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

