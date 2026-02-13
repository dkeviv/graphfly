import crypto from 'node:crypto';

function timingSafeEqual(a, b) {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function computeStripeSignatureV1({ signingSecret, timestamp, rawBody }) {
  const payload = `${timestamp}.${rawBody.toString('utf8')}`;
  return crypto.createHmac('sha256', signingSecret).update(payload).digest('hex');
}

export function parseStripeSignatureHeader(header) {
  const out = Object.create(null);
  if (typeof header !== 'string' || header.length === 0) return out;
  for (const part of header.split(',')) {
    const [k, v] = part.split('=').map((s) => s.trim());
    if (k && v) out[k] = v;
  }
  return out;
}

export function verifyStripeWebhook({
  signingSecret,
  rawBody,
  stripeSignatureHeader,
  toleranceSeconds = 300,
  nowSeconds = () => Math.floor(Date.now() / 1000)
}) {
  if (!signingSecret) return { ok: false, reason: 'missing_secret' };
  if (!rawBody || !(rawBody instanceof Buffer)) return { ok: false, reason: 'missing_raw_body' };
  const parsed = parseStripeSignatureHeader(stripeSignatureHeader);
  const t = Number(parsed.t);
  const v1 = parsed.v1;
  if (!Number.isFinite(t) || !v1) return { ok: false, reason: 'missing_signature_fields' };

  const age = Math.abs(nowSeconds() - t);
  if (age > toleranceSeconds) return { ok: false, reason: 'timestamp_out_of_tolerance' };

  const expected = computeStripeSignatureV1({ signingSecret, timestamp: t, rawBody });
  return timingSafeEqual(expected, v1) ? { ok: true, timestamp: t } : { ok: false, reason: 'bad_signature' };
}

