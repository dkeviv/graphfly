import crypto from 'node:crypto';

function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function computeGitHubSignature256({ secret, rawBody }) {
  const h = crypto.createHmac('sha256', secret);
  h.update(rawBody);
  return `sha256=${h.digest('hex')}`;
}

export function verifyGitHubSignature256({ secret, rawBody, signature256 }) {
  if (!secret) return { ok: false, reason: 'missing_secret' };
  if (!rawBody || !(rawBody instanceof Buffer)) return { ok: false, reason: 'missing_raw_body' };
  if (typeof signature256 !== 'string' || !signature256.startsWith('sha256=')) return { ok: false, reason: 'missing_signature' };
  const expected = computeGitHubSignature256({ secret, rawBody });
  return timingSafeEqualHex(expected, signature256) ? { ok: true } : { ok: false, reason: 'bad_signature' };
}

