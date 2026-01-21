import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/minecraft_security';

const pool = new Pool({
  connectionString,
});

export const query = async (text, params) => {
  const result = await pool.query(text, params);
  return result;
};

export const getClient = () => pool.connect();
