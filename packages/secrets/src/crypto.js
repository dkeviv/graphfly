import crypto from 'node:crypto';

function decodeKeyMaterial(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const isHex = /^[0-9a-f]+$/i.test(s) && s.length % 2 === 0;
  const buf = Buffer.from(s, isHex ? 'hex' : 'base64');
  if (buf.length < 32) throw new Error('secret key material must be at least 32 bytes');
  return buf.subarray(0, 32);
}

function parseKeyring(env) {
  // Preferred: GRAPHFLY_SECRET_KEYS="k1:base64,k2:base64" (first is primary)
  const rawRing = String(env.GRAPHFLY_SECRET_KEYS ?? '').trim();
  if (rawRing) {
    const parts = rawRing
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const keysById = new Map();
    const order = [];
    for (const p of parts) {
      const i = p.indexOf(':');
      if (i <= 0) throw new Error('GRAPHFLY_SECRET_KEYS entries must be "kid:material"');
      const kid = p.slice(0, i).trim();
      const material = p.slice(i + 1).trim();
      if (!kid) throw new Error('GRAPHFLY_SECRET_KEYS missing kid');
      const key = decodeKeyMaterial(material);
      if (!key) throw new Error(`GRAPHFLY_SECRET_KEYS missing key material for ${kid}`);
      keysById.set(kid, key);
      order.push(kid);
    }
    const primaryKeyId = order[0] ?? null;
    const primaryKey = primaryKeyId ? keysById.get(primaryKeyId) : null;
    return { primaryKeyId, primaryKey, keysById };
  }

  // Back-compat: single key in GRAPHFLY_SECRET_KEY (implicit key id "default").
  const single = decodeKeyMaterial(env.GRAPHFLY_SECRET_KEY ?? '');
  if (single) {
    const keysById = new Map([['default', single]]);
    return { primaryKeyId: 'default', primaryKey: single, keysById };
  }
  return { primaryKeyId: null, primaryKey: null, keysById: new Map() };
}

export function getSecretKeyringInfo({ env = process.env } = {}) {
  const ring = parseKeyring(env);
  return { primaryKeyId: ring.primaryKeyId, keyIds: Array.from(ring.keysById.keys()) };
}

export function encryptString({ plaintext, env = process.env }) {
  const ring = parseKeyring(env);
  if (!ring.primaryKey) throw new Error('missing_secret_key');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ring.primaryKey, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext ?? ''), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // v1: iv.tag.ct (base64url)
  const b64url = (b) =>
    Buffer.from(b)
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  // v2: kid.iv.tag.ct (base64url segments)
  const kid = ring.primaryKeyId ?? 'default';
  return `v2.${kid}.${b64url(iv)}.${b64url(tag)}.${b64url(ct)}`;
}

export function decryptString({ ciphertext, env = process.env }) {
  const ring = parseKeyring(env);
  if (!ring.primaryKey) throw new Error('missing_secret_key');
  const s = String(ciphertext ?? '');
  const parts = s.split('.');
  const b64urlToBuf = (v) => {
    const b64 = v.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return Buffer.from(padded, 'base64');
  };

  function tryDecryptWithKey(key, iv, tag, ct) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  }

  if (parts.length === 5 && parts[0] === 'v2') {
    const kid = parts[1];
    const iv = b64urlToBuf(parts[2]);
    const tag = b64urlToBuf(parts[3]);
    const ct = b64urlToBuf(parts[4]);
    const key = ring.keysById.get(kid) ?? null;
    if (key) return tryDecryptWithKey(key, iv, tag, ct);
    // Key id not found: try all keys (supports rotation/misconfig recovery).
    for (const k of ring.keysById.values()) {
      try {
        return tryDecryptWithKey(k, iv, tag, ct);
      } catch {
        // try next
      }
    }
    throw new Error('unknown_key_id');
  }

  // v1: v1.iv.tag.ct (legacy single-key)
  if (parts.length === 4 && parts[0] === 'v1') {
    const iv = b64urlToBuf(parts[1]);
    const tag = b64urlToBuf(parts[2]);
    const ct = b64urlToBuf(parts[3]);
    // Prefer primary key; if it fails, try all keys.
    try {
      return tryDecryptWithKey(ring.primaryKey, iv, tag, ct);
    } catch {
      for (const k of ring.keysById.values()) {
        try {
          return tryDecryptWithKey(k, iv, tag, ct);
        } catch {
          // try next
        }
      }
      throw new Error('decrypt_failed');
    }
  }

  throw new Error('unsupported_ciphertext');
}
