export async function createPgClient({ connectionString }) {
  if (typeof connectionString !== 'string' || connectionString.length === 0) {
    throw new Error('connectionString is required');
  }

  let Pg;
  try {
    Pg = await import('pg');
  } catch {
    throw new Error(
      'pg_dependency_missing: install the "pg" package in the production deployment to use the Postgres store'
    );
  }

  const { Client } = Pg;
  const client = new Client({ connectionString });
  await client.connect();

  return {
    async query(text, params) {
      return client.query(text, params);
    },
    async close() {
      await client.end();
    }
  };
}

