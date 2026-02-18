function hasCodeFence(text) {
  const s = String(text ?? '');
  return /(^|\n)\s{0,3}(```|~~~)/.test(s);
}

function stripFencedCodeBlocks(markdown) {
  const s = String(markdown ?? '');
  // Replace fenced blocks with a sentinel. Keep it simple and safe; do not attempt to preserve code.
  // Matches ```lang\n...\n``` and ~~~...\n~~~ (up to 3 leading spaces).
  const re = /(^|\n)\s{0,3}(```|~~~)[^\n]*\n[\s\S]*?\n\s{0,3}\2[^\n]*(?=\n|$)/g;
  return s.replace(re, '\n[REDACTED_CODE_BLOCK]\n');
}

function stripIndentedCodeLines(markdown) {
  const lines = String(markdown ?? '').split('\n');
  const out = [];
  for (const line of lines) {
    if (/^\t/.test(line)) {
      out.push('[REDACTED_INDENTED_CODE]');
      continue;
    }
    if (/^ {4,}/.test(line)) {
      out.push('[REDACTED_INDENTED_CODE]');
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

export function sanitizeMarkdownForAssistant(markdown, { maxChars = 40_000 } = {}) {
  let s = String(markdown ?? '');
  if (hasCodeFence(s)) s = stripFencedCodeBlocks(s);
  s = stripIndentedCodeLines(s);
  if (s.length > maxChars) s = s.slice(0, maxChars) + '…';
  return s;
}

export function sanitizeAssistantAnswer(markdown, { maxChars = 20_000 } = {}) {
  // Answers must not contain code fences. Escape them defensively.
  let s = String(markdown ?? '');
  s = s.replaceAll('```', '``\\`').replaceAll('~~~', '~~\\~');
  if (s.length > maxChars) s = s.slice(0, maxChars) + '…';
  return s;
}

