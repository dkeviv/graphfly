function hasCodeFence(markdown) {
  const text = String(markdown ?? '');
  return /(^|\n)\s{0,3}(```|~~~)/.test(text);
}

function hasIndentedCodeBlock(markdown) {
  const lines = String(markdown ?? '').split('\n');
  for (const line of lines) {
    if (/^\t/.test(line)) {
      const after = line.replace(/^\t+/, '');
      if (after.trim().length === 0) continue;
      if (/^([-*+]\s|\d+\.\s|>)/.test(after)) continue;
      return true;
    }
    if (/^ {4,}/.test(line)) {
      const after = line.replace(/^ {4,}/, '');
      if (after.trim().length === 0) continue;
      if (/^([-*+]\s|\d+\.\s|>)/.test(after)) continue;
      return true;
    }
  }
  return false;
}

function looksLikeCodeBody(markdown) {
  const text = String(markdown ?? '');
  if (hasCodeFence(text)) return true;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) return false;

  let keywordLines = 0;
  let semis = 0;
  let braces = 0;
  let arrows = 0;
  for (const raw of lines.slice(0, 400)) {
    const line = raw.replace(/^([-*+]\s+|\d+\.\s+)/, '');
    braces += (line.match(/[{}]/g) ?? []).length;
    semis += (line.match(/;/g) ?? []).length;
    if (line.includes('=>')) arrows += 1;
    if (/^(import|export|from|const|let|var|function|class|def|return|if|for|while|switch|case|try|catch|throw|using|namespace|package)\b/.test(line)) {
      keywordLines += 1;
    }
  }
  if (arrows >= 2) return true;
  if (braces >= 2 && semis >= 2) return true;
  if (semis >= 3) return true;
  return keywordLines >= 3;
}

export function validateDocBlockMarkdown(markdown) {
  const text = String(markdown ?? '');
  if (hasCodeFence(text)) return { ok: false, reason: 'code_fence_not_allowed' };
  // Avoid accidental inline code dumps: allow inline backticks but not long blocks.
  if (text.split('\n').some((l) => l.length > 2000)) return { ok: false, reason: 'line_too_long' };
  // Forbid Markdown indented code blocks (4 spaces or tab). Nested lists/quotes are allowed.
  if (hasIndentedCodeBlock(text)) return { ok: false, reason: 'indented_code_block_not_allowed' };
  // LLM-safe invariant: doc blocks should not contain code-like multi-line bodies.
  if (looksLikeCodeBody(text)) return { ok: false, reason: 'code_like_content_not_allowed' };
  return { ok: true };
}
