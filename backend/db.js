import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const query = async (text, params) => {
  const result = await pool.query(text, params);
  return result;
};

export const getClient = () => pool.connect();
