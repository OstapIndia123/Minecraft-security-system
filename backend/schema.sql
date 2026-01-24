DROP TABLE IF EXISTS reader_sessions CASCADE;
DROP TABLE IF EXISTS keys CASCADE;
DROP TABLE IF EXISTS devices CASCADE;
DROP TABLE IF EXISTS logs CASCADE;
DROP TABLE IF EXISTS user_spaces CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS spaces CASCADE;
DROP TABLE IF EXISTS hubs CASCADE;

CREATE TABLE hubs (
  id TEXT PRIMARY KEY,
  space_id TEXT UNIQUE
);

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  minecraft_nickname TEXT,
  discord_id TEXT,
  discord_avatar_url TEXT,
  language TEXT NOT NULL DEFAULT 'ru',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  last_nickname_change_at TIMESTAMP,
  last_space_create_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX users_minecraft_nickname_lower_uniq
  ON users (lower(minecraft_nickname))
  WHERE minecraft_nickname IS NOT NULL;

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL
);

CREATE TABLE spaces (
  id TEXT PRIMARY KEY,
  hub_id TEXT,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  status TEXT NOT NULL,
  hub_online BOOLEAN DEFAULT NULL,
  issues BOOLEAN NOT NULL DEFAULT false,
  server TEXT NOT NULL DEFAULT '—',
  city TEXT NOT NULL,
  timezone TEXT NOT NULL,
  company JSONB NOT NULL,
  contacts JSONB NOT NULL,
  notes JSONB NOT NULL,
  photos JSONB NOT NULL
);

CREATE TABLE user_spaces (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'user',
  PRIMARY KEY (user_id, space_id, role)
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  room TEXT NOT NULL,
  status TEXT NOT NULL,
  type TEXT NOT NULL,
  side TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE keys (
  id SERIAL PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  reader_id TEXT,
  groups JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE reader_sessions (
  id SERIAL PRIMARY KEY,
  reader_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  input_side TEXT NOT NULL,
  input_level INT NOT NULL,
  action TEXT NOT NULL,
  key_name TEXT NOT NULL,
  reader_name TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE logs (
  id SERIAL PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  time TEXT NOT NULL,
  text TEXT NOT NULL,
  who TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
