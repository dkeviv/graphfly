import fs from 'node:fs';

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

function write(p, text) {
  fs.writeFileSync(p, text, 'utf8');
}

function extractRequirements(md) {
  const out = [];
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^####\s+([A-Z]+-[A-Z0-9-]+):\s+(.*)\s*$/);
    if (!m) continue;
    out.push({ id: m[1], title: m[2], line: i + 1 });
  }
  return out;
}

function parseProjectPlan(md) {
  // Small parser: reads the top tracking table and the "Production Readiness Checklist" table.
  const planRows = [];
  const readinessRows = [];
  const lines = md.split('\n');

  function parseMainTable(startIdx) {
    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith('|')) break;
      const cols = line.split('|').slice(1, -1).map((c) => c.trim());
      // Skip header/separator rows.
      if (cols.every((c) => c === '---' || c === '')) continue;
      if (cols[0] === 'Area') continue;
      if (cols.length < 5) continue;
      planRows.push({
        area: cols[0],
        specAnchor: cols[1],
        requirementIds: cols[2],
        status: cols[3],
        gate: cols[4]
      });
    }
  }

  function parseReadinessTable(startIdx) {
    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith('|')) break;
      const cols = line.split('|').slice(1, -1).map((c) => c.trim());
      if (cols.every((c) => c === '---' || c === '')) continue;
      if (cols[0] === 'Area') continue;
      if (cols.length < 5) continue;
      readinessRows.push({
        area: cols[0],
        item: cols[1],
        acceptance: cols[2],
        status: cols[3],
        gate: cols[4]
      });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('| Area | Spec Anchor | Requirement IDs | Status |')) parseMainTable(i + 2);
    if (lines[i].startsWith('| Area | Item | Acceptance | Status |')) parseReadinessTable(i + 2);
  }

  return { planRows, readinessRows };
}

function extractRequirementTokens(text) {
  const s = String(text ?? '');
  const hits = s.match(/[A-Z]{2,}-[A-Z0-9]+-(?:\*|[A-Z0-9-]+)/g) ?? [];
  return hits.map((h) => h.trim());
}

function matchesToken(requirementId, token) {
  if (!token) return false;
  if (token.endsWith('*')) return requirementId.startsWith(token.slice(0, -1));
  return requirementId === token;
}

function matchesRequirement(requirementId, requirementIdsCell) {
  const tokens = extractRequirementTokens(requirementIdsCell);
  return tokens.some((t) => matchesToken(requirementId, t));
}

function statusFromPlan({ requirementId, planRows }) {
  const hits = planRows.filter((r) => matchesRequirement(requirementId, r.requirementIds));
  if (hits.length === 0) return '❌';
  const statuses = hits.map((r) => r.status).filter(Boolean);
  if (statuses.includes('DONE')) return '✅';
  if (statuses.includes('PARTIAL')) return '⚠️';
  if (statuses.includes('PENDING')) return '❌';
  return '⚠️';
}

function fileHintsForRequirement(id) {
  const prefix = id.split('-', 2)[0] ?? id;
  if (id.startsWith('FR-GH')) return ['apps/api/src/server.js', 'apps/api/src/github-webhook.js', 'packages/github-*', 'packages/repos*'];
  if (id.startsWith('FR-CIG')) return ['workers/indexer/', 'packages/cig/', 'packages/ndjson/', 'packages/cig-pg/', 'migrations/001_init.sql'];
  if (id.startsWith('FR-DOC')) return ['workers/doc-agent/', 'packages/doc-blocks/', 'packages/doc-store/', 'packages/github-service/'];
  if (id.startsWith('FR-GX')) return ['apps/web/', 'apps/api/src/server.js', 'packages/cig/src/search.js'];
  if (id.startsWith('FR-BL')) return ['apps/api/src/server.js', 'packages/billing*/', 'packages/stripe-*/', 'migrations/001_init.sql'];
  if (id.startsWith('NFR')) return ['docs/05_SECURITY.md', 'docs/06_OPERATIONS.md', 'docs/07_ADMIN_GUIDE.md', 'migrations/001_init.sql'];
  if (prefix === 'UF') return ['docs/04_UX_SPEC.md', 'apps/web/'];
  return ['docs/02_REQUIREMENTS.md', 'docs/03_TECHNICAL_SPEC.md'];
}

function isBlocker({ id, title }) {
  // Phase-1: treat all FR-* as blockers, except explicitly future-tagged items.
  if (!String(id).startsWith('FR-')) return false;
  return !/\(Future\)/i.test(String(title ?? ''));
}

function implementationPointers({ requirementId, planRows }) {
  const hits = planRows.filter((r) => matchesRequirement(requirementId, r.requirementIds));
  const anchors = Array.from(new Set(hits.map((h) => h.specAnchor).filter(Boolean)));
  const hints = fileHintsForRequirement(requirementId);
  return Array.from(new Set([...anchors, ...hints]));
}

function render({ requirements, planRows }) {
  const lines = [];
  lines.push('# Graphfly — Spec-to-Work Item Map (Drift Guardrail)');
  lines.push('');
  lines.push('This file maps each requirement in `docs/02_REQUIREMENTS.md` to:');
  lines.push('- implementation status (✅ / ⚠️ / ❌)');
  lines.push('- implementing areas and files/directories (best-effort pointers)');
  lines.push('- whether it is a Phase-1 blocker');
  lines.push('');
  lines.push('Regenerate: `npm run spec:map`');
  lines.push('');
  lines.push('| Requirement | Spec Anchor | Status | Blocker | Implemented By |');
  lines.push('|---|---:|---:|:---:|---|');
  for (const r of requirements) {
    const status = statusFromPlan({ requirementId: r.id, planRows });
    const blocker = isBlocker(r) ? 'BLOCKER' : '';
    const anchor = `docs/02_REQUIREMENTS.md:${r.line}`;
    const pointers = implementationPointers({ requirementId: r.id, planRows }).join(', ');
    lines.push(`| \`${r.id}\` — ${r.title} | \`${anchor}\` | ${status} | ${blocker} | ${pointers} |`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('Notes:');
  lines.push('- ✅ means implemented per `project_plan.md` and covered by tests where applicable.');
  lines.push('- ⚠️ means partial, env-gated, or needs verification against acceptance criteria.');
  lines.push('- ❌ means not yet implemented or not yet tracked in `project_plan.md`.');
  lines.push('');
  return lines.join('\n');
}

const requirementsMd = read('docs/02_REQUIREMENTS.md');
const planMd = read('project_plan.md');
const requirements = extractRequirements(requirementsMd);
const { planRows } = parseProjectPlan(planMd);

const out = render({ requirements, planRows });

const args = new Set(process.argv.slice(2));
const stdout = args.has('--stdout');
const check = args.has('--check');

if (stdout) {
  // eslint-disable-next-line no-console
  console.log(out);
  process.exit(0);
}

if (check) {
  const existing = fs.existsSync('spec-map.md') ? read('spec-map.md') : '';
  if (existing !== out) {
    // eslint-disable-next-line no-console
    console.error('spec-map: out of date (run: npm run spec:map)');
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log('spec-map: OK');
  process.exit(0);
}

write('spec-map.md', out);
// eslint-disable-next-line no-console
console.log(`spec-map: wrote ${requirements.length} requirement rows`);
