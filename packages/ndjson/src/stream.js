import readline from 'node:readline';

export async function* parseNdjsonStream(readable) {
  const rl = readline.createInterface({ input: readable, crlfDelay: Infinity });
  for await (const line of rl) {
    const t = String(line).trim();
    if (!t) continue;
    yield JSON.parse(t);
  }
}

