import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import { query } from './db.js';

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
};

const normalizeText = (value) => (value ?? '').toString().trim();
const MAX_NICKNAME_LENGTH = 16;

const buildUniqueNickname = async (nickname) => {
  const base = normalizeText(nickname) || 'User';
  const exists = await query(
    'SELECT 1 FROM users WHERE minecraft_nickname IS NOT NULL AND lower(minecraft_nickname) = lower($1) LIMIT 1',
    [base],
  );
  if (!exists.rows.length) {
    return base.slice(0, MAX_NICKNAME_LENGTH);
  }
  for (let counter = 1; counter < 100; counter += 1) {
    const suffix = `-${counter}`;
    const trimmedBase = base.slice(0, Math.max(1, MAX_NICKNAME_LENGTH - suffix.length));
    const candidate = `${trimmedBase}${suffix}`;
    const result = await query(
      'SELECT 1 FROM users WHERE minecraft_nickname IS NOT NULL AND lower(minecraft_nickname) = lower($1) LIMIT 1',
      [candidate],
    );
    if (!result.rows.length) {
      return candidate;
    }
  }
  return `${base.slice(0, MAX_NICKNAME_LENGTH - 5)}-${crypto.randomInt(1000, 9999)}`;
};

const seed = async () => {
  const schema = await readFile(new URL('./schema.sql', import.meta.url));
  await query(schema.toString());
  try {
    await query(
      'TRUNCATE reader_sessions, keys, devices, logs, user_spaces, sessions, users, spaces, hubs RESTART IDENTITY CASCADE',
    );
  } catch (error) {
    if (error?.code !== '42P01') {
      throw error;
    }
  }

  const spaces = [
    {
      id: '452354',
      hub_id: '00543651F',
      name: 'Без номера',
      address: 'x:-8 y:79 z:23',
      status: 'armed',
      hub_online: true,
      issues: false,
      server: 'Основной',
      city: 'Насрал',
      timezone: 'Europe/Kyiv',
      company: {
        name: 'Насрал2000',
        country: 'satirize',
        pcs: '@discord',
        site: 'нет',
        email: 'нет',
      },
      contacts: [
        { name: 'Питер', role: 'Ответственное лицо', phone: '@discord' },
        { name: 'Питер', role: 'Инженер монтажа', phone: '@discord' },
      ],
      notes: ['Постановка через reader на стороне EAST.', 'Сирена на стороне SOUTH.'],
      photos: [],
      devices: [
        {
          id: 'zone-entrance',
          name: 'вход',
          room: 'корридор',
          status: 'Норма',
          type: 'zone',
          side: 'north',
          config: { zoneType: 'instant', bypass: false, silent: false, normalLevel: 15 },
        },
        {
          id: 'reader-key',
          name: 'брелок',
          room: 'спальняя',
          status: 'Норма',
          type: 'reader',
          side: 'east',
          config: { outputLevel: 6, inputSide: 'up', inputLevel: 6 },
        },
      ],
      keys: [{ name: 'Наблюдатель', reader_id: 'reader-key', groups: ['all'] }],
    },
  ];

  for (const space of spaces) {
    await query('INSERT INTO hubs (id, space_id) VALUES ($1,$2)', [space.hub_id.replace('HUB-', ''), space.id]);
    await query(
      `INSERT INTO spaces (id, hub_id, name, address, status, hub_online, issues, server, city, timezone, company, contacts, notes, photos)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        space.id,
        space.hub_id.replace('HUB-', ''),
        space.name,
        space.address,
        space.status,
        space.hub_online,
        space.issues,
        space.server ?? '—',
        space.city,
        space.timezone,
        JSON.stringify(space.company),
        JSON.stringify(space.contacts),
        JSON.stringify(space.notes),
        JSON.stringify(space.photos),
      ],
    );

    for (const device of space.devices) {
      await query(
        'INSERT INTO devices (id, space_id, name, room, status, type, side, config) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          device.id,
          space.id,
          device.name,
          device.room,
          device.status,
          device.type,
          device.side ?? null,
          JSON.stringify(device.config ?? {}),
        ],
      );
    }

    for (const key of space.keys ?? []) {
      await query(
        'INSERT INTO keys (space_id, name, reader_id, groups) VALUES ($1,$2,$3,$4)',
        [space.id, key.name, key.reader_id ?? null, JSON.stringify(key.groups ?? [])],
      );
    }
  }

  const logs = [
    ['452354', '04:11:43', 'Пользователь Питер поставил объект 452354 под охрану', 'Питер', 'security'],
    ['452354', '04:07:43', 'Добавлен новый пользователь Питер', 'Насрал2000', 'system'],
    ['452354', '03:11:14', 'Инженер Питер получил доступ к объекту', 'Насрал2000', 'access'],
  ];

  for (const [spaceId, time, text, who, type] of logs) {
    await query(
      'INSERT INTO logs (space_id, time, text, who, type) VALUES ($1,$2,$3,$4,$5)',
      [spaceId, time, text, who, type],
    );
  }

  const seedDiscordId = normalizeText(process.env.SEED_DISCORD_ID);
  const seedDiscordNickname = normalizeText(process.env.SEED_DISCORD_NICKNAME) || 'Installer';

  const users = seedDiscordId
    ? [
        {
          email: `discord:${seedDiscordId}`,
          password: `discord-${seedDiscordId}`,
          role: 'installer',
          nickname: seedDiscordNickname,
          language: 'ru',
          timezone: 'Europe/Kyiv',
          discordId: seedDiscordId,
        },
      ]
    : [
        {
          email: 'pro@example.com',
          password: 'pro-demo',
          role: 'installer',
          nickname: 'Installer',
          language: 'ru',
          timezone: 'Europe/Kyiv',
          discordId: null,
        },
        {
          email: 'user@example.com',
          password: 'user-demo',
          role: 'user',
          nickname: 'User',
          language: 'ru',
          timezone: 'Europe/Kyiv',
          discordId: null,
        },
      ];

  const userRecords = [];
  for (const user of users) {
    const uniqueNickname = await buildUniqueNickname(user.nickname);
    const result = await query(
      `INSERT INTO users (email, password_hash, role, minecraft_nickname, discord_id, language, timezone, discord_avatar_url, last_nickname_change_at, last_space_create_at, is_blocked)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        user.email,
        hashPassword(user.password),
        user.role,
        uniqueNickname,
        user.discordId,
        user.language,
        user.timezone,
        null,
        null,
        null,
        false,
      ],
    );
    userRecords.push({ id: result.rows[0].id, role: user.role });
  }

  for (const userRecord of userRecords) {
    for (const space of spaces) {
      if (seedDiscordId) {
        await query(
          'INSERT INTO user_spaces (user_id, space_id, role) VALUES ($1,$2,$3)',
          [userRecord.id, space.id, 'installer'],
        );
        await query(
          'INSERT INTO user_spaces (user_id, space_id, role) VALUES ($1,$2,$3)',
          [userRecord.id, space.id, 'user'],
        );
      } else {
        await query(
          'INSERT INTO user_spaces (user_id, space_id, role) VALUES ($1,$2,$3)',
          [userRecord.id, space.id, userRecord.role],
        );
      }
    }
  }

  console.log('Seed completed');
  process.exit(0);
};

seed().catch((error) => {
  if (error?.code === '28P01') {
    console.error('Seed failed: invalid database credentials (code 28P01).');
    console.error('Check POSTGRES_PASSWORD / DATABASE_URL and note that existing Postgres volumes keep the old password.');
    console.error('For Docker Compose you can reset the database with: docker compose down -v');
  }
  console.error('Seed failed', error);
  process.exit(1);
});
