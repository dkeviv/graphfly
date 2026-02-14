function splitSqlStatements(sql) {
  const out = [];
  let buf = '';
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      buf += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      buf += ch;
      if (ch === '*' && next === '/') {
        buf += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }

    if (!inSingle && !inDouble) {
      if (ch === '-' && next === '-') {
        buf += ch + next;
        i++;
        inLineComment = true;
        continue;
      }
      if (ch === '/' && next === '*') {
        buf += ch + next;
        i++;
        inBlockComment = true;
        continue;
      }
    }

    if (!inDouble && ch === "'" && sql[i - 1] !== '\\') {
      inSingle = !inSingle;
      buf += ch;
      continue;
    }
    if (!inSingle && ch === '"' && sql[i - 1] !== '\\') {
      inDouble = !inDouble;
      buf += ch;
      continue;
    }

    if (!inSingle && !inDouble && ch === ';') {
      const stmt = buf.trim();
      if (stmt) out.push(stmt);
      buf = '';
      continue;
    }

    buf += ch;
  }

  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

export async function applySqlMigration({ client, sqlText }) {
  if (!client || typeof client.query !== 'function') throw new Error('client.query is required');
  const sql = String(sqlText ?? '');
  if (!sql.trim()) throw new Error('sqlText is empty');

  const statements = splitSqlStatements(sql);
  for (const stmt of statements) {
    await client.query(stmt);
  }
}

