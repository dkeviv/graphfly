import { assert, hashString, stableStringify } from './types.js';

export function computeSignatureHash({ signature }) {
  if (!signature) return null;
  return hashString(signature);
}

export function computeContractHash({ contract, constraints, allowableValues }) {
  const payload = {
    contract: contract ?? null,
    constraints: constraints ?? null,
    allowableValues: allowableValues ?? null
  };
  return hashString(stableStringify(payload));
}

export function makeSymbolUid({ language, qualifiedName, signatureHash }) {
  assert(typeof language === 'string' && language.length > 0, 'language is required');
  assert(typeof qualifiedName === 'string' && qualifiedName.length > 0, 'qualifiedName is required');
  const sig = typeof signatureHash === 'string' && signatureHash.length > 0 ? signatureHash : 'nosig';
  return `${language}::${qualifiedName}::${sig}`;
}

