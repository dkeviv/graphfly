import crypto from 'node:crypto';

function keyFromEnv(env) {
  const raw = env.GRAPHFLY_SECRET_KEY ?? '';
  if (!raw) return null;
  // Accept base64 or hex.
  const isHex = /^[0-9a-f]+$/i.test(raw) && raw.length % 2 === 0;
  const buf = Buffer.from(raw, isHex ? 'hex' : 'base64');
  if (buf.length < 32) throw new Error('GRAPHFLY_SECRET_KEY must be at least 32 bytes');
  return buf.subarray(0, 32);
}

export function encryptString({ plaintext, env = process.env }) {
  const key = keyFromEnv(env);
  if (!key) throw new Error('missing_secret_key');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext ?? ''), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // v1: iv.tag.ct (base64url)
  const b64url = (b) =>
    Buffer.from(b)
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  return `v1.${b64url(iv)}.${b64url(tag)}.${b64url(ct)}`;
}

export function decryptString({ ciphertext, env = process.env }) {
  const key = keyFromEnv(env);
  if (!key) throw new Error('missing_secret_key');
  const s = String(ciphertext ?? '');
  const parts = s.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('unsupported_ciphertext');
  const b64urlToBuf = (v) => {
    const b64 = v.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return Buffer.from(padded, 'base64');
  };
  const iv = b64urlToBuf(parts[1]);
  const tag = b64urlToBuf(parts[2]);
  const ct = b64urlToBuf(parts[3]);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

