import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function writeFile0700(filePath, text) {
  fs.writeFileSync(filePath, text, { encoding: 'utf8', mode: 0o700 });
}

export function withGitAskpass({ username, password }, fn) {
  if (typeof username !== 'string' || username.length === 0) throw new Error('auth.username required');
  if (typeof password !== 'string' || password.length === 0) throw new Error('auth.password required');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphfly-askpass-'));
  const scriptPath = path.join(dir, 'askpass.sh');

  writeFile0700(
    scriptPath,
    [
      '#!/bin/sh',
      'case "$1" in',
      "  *Username*) echo \"$GRAPHFLY_GIT_USERNAME\" ;;",
      "  *Password*) echo \"$GRAPHFLY_GIT_PASSWORD\" ;;",
      '  *) echo "" ;;',
      'esac',
      ''
    ].join('\n')
  );

  try {
    const out = fn({
      env: {
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: scriptPath,
        GRAPHFLY_GIT_USERNAME: username,
        GRAPHFLY_GIT_PASSWORD: password
      }
    });
    return out;
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

