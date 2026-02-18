function normalizeTrackedBranch(trackedBranch) {
  const s = String(trackedBranch ?? '').trim();
  if (!s) return null;
  return s.startsWith('refs/heads/') ? s.slice('refs/heads/'.length) : s;
}

export function shouldProcessPushForTrackedBranch({ trackedBranch, ref }) {
  const tb = normalizeTrackedBranch(trackedBranch);
  if (!tb) return true;
  const r = String(ref ?? '').trim();
  if (!r) return false;
  return r === `refs/heads/${tb}`;
}

