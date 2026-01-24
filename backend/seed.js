import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import { query } from './db.js';

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
};

const seed = async () => {
  const schema = await readFile(new URL('./schema.sql', import.meta.url));
  await query(schema.toString());

  const spaces = [
    {
      id: '261156',
      hub_id: '0008951F',
      name: 'Без номера',
      address: 'x:-8 y:79 z:23',
      status: 'armed',
      hub_online: true,
      issues: false,
      server: 'Основной',
      city: 'Калуш',
      timezone: 'Europe/Kyiv',
      company: {
        name: 'АО «Явир-2000»',
        country: 'Украина',
        pcs: '+380931702200',
        site: 'https://yavir2000.com',
        email: 'ajax@yavir2000.com',
      },
      contacts: [
        { name: 'Иванна', role: 'Ответственное лицо', phone: '+380 97 000 00 00' },
        { name: 'Павлюк О.', role: 'Инженер монтажа', phone: '+380 50 000 00 00' },
      ],
      notes: ['Постановка через reader на стороне EAST.', 'Сирена на стороне SOUTH.'],
      photos: [],
      devices: [
        {
          id: 'zone-entrance',
          name: 'вхід',
          room: 'коридор',
          status: 'Норма',
          type: 'zone',
          side: 'north',
          config: { zoneType: 'instant', bypass: false, silent: false, normalLevel: 15 },
        },
        {
          id: 'reader-key',
          name: 'брелок',
          room: 'спальня дит',
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
    ['261156', '04:11:43', 'Пользователь Aramaic поставил объект 261156 под охрану', 'Aramaic', 'security'],
    ['261156', '04:07:43', 'Добавлен новый пользователь Aramaic', 'АО «Явир-2000»', 'system'],
    ['261156', '03:11:14', 'Инженер Павлюк О. получил доступ к объекту', 'Явир2000', 'access'],
  ];

  for (const [spaceId, time, text, who, type] of logs) {
    await query(
      'INSERT INTO logs (space_id, time, text, who, type) VALUES ($1,$2,$3,$4,$5)',
      [spaceId, time, text, who, type],
    );
  }

  const users = [
    {
      email: 'pro@example.com',
      password: 'pro-demo',
      role: 'installer',
      nickname: 'Installer',
      language: 'ru',
      timezone: 'Europe/Kyiv',
    },
    {
      email: 'user@example.com',
      password: 'user-demo',
      role: 'user',
      nickname: 'User',
      language: 'ru',
      timezone: 'Europe/Kyiv',
    },
  ];

  const userIds = [];
  for (const user of users) {
    const result = await query(
      `INSERT INTO users (email, password_hash, role, minecraft_nickname, language, timezone, discord_avatar_url, last_nickname_change_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [
        user.email,
        hashPassword(user.password),
        user.role,
        user.nickname,
        user.language,
        user.timezone,
        null,
        null,
      ],
    );
    userIds.push(result.rows[0].id);
  }

  for (const userId of userIds) {
    for (const space of spaces) {
      await query('INSERT INTO user_spaces (user_id, space_id, role) VALUES ($1,$2,$3)', [userId, space.id, 'installer']);
    }
  }

  console.log('Seed completed');
  process.exit(0);
};

seed().catch((error) => {
  console.error('Seed failed', error);
  process.exit(1);
});
