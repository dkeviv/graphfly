export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && (value.constructor === Object || Object.getPrototypeOf(value) === null);
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashString(input) {
  // Non-crypto stable hash for IDs/tests; production should use sha256.
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

