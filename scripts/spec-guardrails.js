import { execSync } from 'node:child_process';
import fs from 'node:fs';

function sh(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8').trim();
}

function listChangedFiles() {
  // Prefer staged changes (pre-commit/pre-push); fall back to working tree vs HEAD.
  try {
    const out = sh('git diff --name-only --cached');
    if (out) return out.split('\n').filter(Boolean);
  } catch {
    // ignore
  }
  try {
    const out = sh('git diff --name-only');
    if (out) return out.split('\n').filter(Boolean);
  } catch {
    // ignore
  }
  return [];
}

function anyMatch(files, prefixes) {
  return files.some((f) => prefixes.some((p) => f === p || f.startsWith(p)));
}

function mustInclude(files, required) {
  return required.some((r) => files.includes(r) || files.some((f) => f.startsWith(r)));
}

function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

function fail(message, details = []) {
  const lines = [message, ...details.map((d) => `- ${d}`)].join('\n');
  // eslint-disable-next-line no-console
  console.error(lines);
  process.exit(1);
}

const changed = listChangedFiles();
if (changed.length === 0) {
  // eslint-disable-next-line no-console
  console.log('spec-guardrails: no changes detected');
  process.exit(0);
}

const SPEC_DOCS = [
  'docs/02_REQUIREMENTS.md',
  'docs/03_TECHNICAL_SPEC.md',
  'docs/04_UX_SPEC.md',
  'docs/05_SECURITY.md',
  'docs/06_OPERATIONS.md',
  'docs/07_ADMIN_GUIDE.md',
  'project_plan.md',
  'spec-map.md'
];

const CODE_PREFIXES = ['apps/', 'packages/', 'workers/', 'migrations/'];
const ADMIN_IMPACT_PREFIXES = ['apps/api/', 'workers/', 'migrations/', 'packages/stores/', 'packages/secrets/', 'packages/queue', 'packages/queue-pg'];
const UX_IMPACT_PREFIXES = ['apps/web/'];
const SCHEMA_IMPACT_PREFIXES = ['migrations/', 'packages/cig', 'packages/cig-pg', 'packages/ndjson', 'packages/indexer-cli'];

// Rule 1: if code changes, at least one spec doc or project plan must be updated in the same patch.
if (anyMatch(changed, CODE_PREFIXES) && !mustInclude(changed, SPEC_DOCS)) {
  fail('spec-guardrails: code changed but no spec/plan docs updated', [
    `Changed: ${changed.slice(0, 15).join(', ')}${changed.length > 15 ? '…' : ''}`,
    `Update at least one of: ${SPEC_DOCS.join(', ')}`
  ]);
}

// Rule 1B: if code changes, project tracking must be updated (auto-maintained plan).
if (anyMatch(changed, CODE_PREFIXES) && !changed.includes('project_plan.md')) {
  fail('spec-guardrails: code changed but project_plan.md was not updated', [
    'Graphfly requires keeping project_plan.md current after each feature implementation + test gate.',
    'Update the row(s) corresponding to the feature you changed.'
  ]);
}

// Rule 1C: if requirements or plan changed, spec-map must be up-to-date (generator output matches file).
if (changed.includes('docs/02_REQUIREMENTS.md') || changed.includes('project_plan.md')) {
  try {
    sh('node scripts/spec-map-generate.js --check');
  } catch {
    fail('spec-guardrails: spec-map.md is out of date', ['Run: npm run spec:map']);
  }
}

// Rule 2: admin-impact changes require admin guide update.
if (anyMatch(changed, ADMIN_IMPACT_PREFIXES) && !changed.includes('docs/07_ADMIN_GUIDE.md')) {
  fail('spec-guardrails: admin-impact change requires docs/07_ADMIN_GUIDE.md update', [
    'Admin-impact areas include API, workers, migrations, secrets, queues, stores.',
    'Update docs/07_ADMIN_GUIDE.md with any new env vars, runbooks, or operational steps.'
  ]);
}

// Rule 3: UX-impact changes require UX spec update (unless explicitly docs-only).
if (anyMatch(changed, UX_IMPACT_PREFIXES) && !changed.includes('docs/04_UX_SPEC.md')) {
  fail('spec-guardrails: apps/web changed but docs/04_UX_SPEC.md not updated', [
    'Update UX spec tables/flows when onboarding/admin/graph/docs UX changes.'
  ]);
}

// Rule 4: schema/ingest changes require technical spec update.
if (anyMatch(changed, SCHEMA_IMPACT_PREFIXES) && !changed.includes('docs/03_TECHNICAL_SPEC.md')) {
  fail('spec-guardrails: schema/graph ingestion changed but docs/03_TECHNICAL_SPEC.md not updated', [
    'Update technical spec for schema, ingestion contracts, constraints, and worker pipeline.'
  ]);
}

// Rule 5: ensure docs do not mention OpenClaw (brand hygiene).
const tech = readText('docs/03_TECHNICAL_SPEC.md');
if (/openclaw/i.test(tech)) {
  fail('spec-guardrails: docs/03_TECHNICAL_SPEC.md contains disallowed term "openclaw"', [
    'Do not mention upstream projects by name in the specification.'
  ]);
}

// eslint-disable-next-line no-console
console.log('spec-guardrails: OK');
