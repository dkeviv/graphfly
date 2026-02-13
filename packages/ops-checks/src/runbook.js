import fs from 'node:fs';

export function checkOperationsDoc({ filePath = 'docs/06_OPERATIONS.md' } = {}) {
  const text = fs.readFileSync(filePath, 'utf8');
  const required = [
    { name: 'SLO', re: /^##\s+.*Service Level Objectives/im },
    { name: 'Observability', re: /^##\s+.*Observability/im },
    { name: 'Runbooks', re: /^##\s+.*Runbooks/im },
    { name: 'Backup', re: /^##\s+.*Backup/im }
  ];
  const missing = required.filter((r) => !r.re.test(text)).map((r) => r.name);
  return { ok: missing.length === 0, missing };
}
