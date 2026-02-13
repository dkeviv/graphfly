const SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /(?:(?:api|access|secret)[-_ ]?key|token|password)\s*[:=]\s*['"]?([A-Za-z0-9_\-\/+=]{8,})['"]?/gi,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC )?PRIVATE KEY-----/g
];

export function redactSecrets(text) {
  let out = String(text ?? '');
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[REDACTED]');
  return out;
}

