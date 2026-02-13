export function* parseNdjsonText(ndjsonText) {
  const lines = ndjsonText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    yield JSON.parse(line);
  }
}

