import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/minecraft_security';

const pool = new Pool({
  connectionString,
});

let dbAuthFailed = false;

export const query = async (text, params) => {
  try {
    const result = await pool.query(text, params);
    dbAuthFailed = false;
    return result;
  } catch (error) {
    if (error?.code === '28P01') {
      dbAuthFailed = true;
    }
    throw error;
  }
};

export const getClient = () => pool.connect();
export const isDbAuthFailed = () => dbAuthFailed;
