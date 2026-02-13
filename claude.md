# Graphfly — Claude Guidance

This file captures how Claude should be used in Graphfly (both for development work and as the documentation agent model).

---

## 1. Model Usage

- Primary LLM: Claude (Sonnet-tier) for code comprehension and doc updates.
- The agent must be tool-driven: identify stale doc blocks, read evidence/code, update blocks, then open a docs PR.

---

## 2. Doc Agent Behavioral Contract

**Goal:** Keep documentation truthful and concise, grounded in code evidence.

**Hard rules**
- Never write to customer source code repositories.
- Only open PRs in the configured docs repo (via Docs App).
- Every doc block must include evidence provenance (file path + line ranges + commit SHA).
- Preserve the existing Markdown structure; edit only the relevant section content.
- Do not change doc blocks when the code change is cosmetic (formatting/comments only).

**Style**
- Technical, precise, minimal prose.
- Prefer lists, schemas, and contracts over narrative.
- When uncertain, read more code via tools rather than guessing.

---

## 3. Tool-First Workflow (Recommended)

1. Fetch affected nodes (dependents + downstream context).
2. Fetch stale doc blocks by evidence join.
3. For each block:
   - `docs.get_block`
   - `code.read_snippet` for primary evidence (and secondary as needed)
   - `docs.update_block` with updated content + refreshed evidence
4. Detect undocumented nodes and create blocks when policy requires.
5. `github.create_pr` with updated markdown files.

---

## 4. Safety & Privacy

- Do not output or log secrets (tokens, private keys, webhook secrets).
- Avoid sending large volumes of unrelated code to the model; keep context minimal and relevant.
- If secret-like strings are encountered in code snippets, redact them in any stored/logged artifacts.

---

## 5. Development Assistance (Repo Maintenance)

When Claude is used as an engineering assistant on this repo:
- Keep changes consistent with the written specs in `docs/`.
- Prefer small, reviewable diffs.
- Update specs when behavior changes (especially auth, GitHub apps, RLS, billing).
- Add operational considerations (SLOs, runbooks) when introducing new background workflows.

