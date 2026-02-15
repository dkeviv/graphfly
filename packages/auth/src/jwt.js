import crypto from 'node:crypto';

function b64urlEncode(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function b64urlDecodeToBuf(s) {
  const b64 = String(s ?? '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

function signHs256({ secret, input }) {
  const h = crypto.createHmac('sha256', secret);
  h.update(input);
  return b64urlEncode(h.digest());
}

export function createJwtHs256({ secret, claims, nowSec = Math.floor(Date.now() / 1000), ttlSec = 3600 } = {}) {
  if (!secret) throw new Error('secret is required');
  if (!claims || typeof claims !== 'object') throw new Error('claims is required');
  const iat = Number(nowSec);
  const exp = iat + Math.max(60, Math.min(24 * 3600, Number(ttlSec) || 3600));
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { ...claims, iat, exp };
  const input = `${b64urlEncode(JSON.stringify(header))}.${b64urlEncode(JSON.stringify(payload))}`;
  const sig = signHs256({ secret, input });
  return `${input}.${sig}`;
}

export function verifyJwtHs256({ secret, token, nowSec = Math.floor(Date.now() / 1000) } = {}) {
  if (!secret) return { ok: false, reason: 'missing_secret' };
  const t = String(token ?? '');
  const parts = t.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'invalid_format' };
  const [h, p, s] = parts;
  const input = `${h}.${p}`;
  const expected = signHs256({ secret, input });
  if (expected !== s) return { ok: false, reason: 'bad_signature' };
  let payload;
  try {
    payload = JSON.parse(b64urlDecodeToBuf(p).toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid_payload' };
  }
  const exp = Number(payload?.exp);
  if (!Number.isFinite(exp)) return { ok: false, reason: 'missing_exp' };
  if (Number(nowSec) >= exp) return { ok: false, reason: 'expired' };
  return { ok: true, claims: payload };
}

