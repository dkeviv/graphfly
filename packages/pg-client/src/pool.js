export async function createPgPool({ connectionString, max = 10 }) {
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

  const { Pool } = Pg;
  const pool = new Pool({ connectionString, max });

  return {
    async connect() {
      return pool.connect();
    },
    async close() {
      await pool.end();
    }
  };
}

