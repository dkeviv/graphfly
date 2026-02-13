export function validateDocBlockMarkdown(markdown) {
  const text = String(markdown ?? '');
  if (text.includes('```')) return { ok: false, reason: 'code_fence_not_allowed' };
  // Avoid accidental inline code dumps: allow inline backticks but not long blocks.
  if (text.split('\n').some((l) => l.length > 2000)) return { ok: false, reason: 'line_too_long' };
  return { ok: true };
}

