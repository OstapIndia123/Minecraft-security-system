import { readFile } from 'node:fs/promises';
import { query } from './db.js';

const seed = async () => {
  const schema = await readFile(new URL('./schema.sql', import.meta.url));
  await query(schema.toString());

  await query('DELETE FROM logs');
  await query('DELETE FROM reader_keys');
  await query('DELETE FROM readers');
  await query('DELETE FROM devices');
  await query('DELETE FROM spaces');
  await query('DELETE FROM hubs');

  const spaces = [
    {
      id: '261156',
      hub_id: '0008951F',
      name: 'Без номера объекта',
      address: '—',
      status: 'armed',
      hub_online: true,
      issues: false,
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
      devices: [
        { id: 'hub-261156', name: 'Хаб 261156', room: 'Комната не выбрана', status: 'В сети', type: 'hub' },
        { id: 'zone-entrance', name: 'вхід', room: 'коридор', status: 'Норма', type: 'zone' },
        { id: 'zone-motion-1', name: 'рух 1', room: 'кухня', status: 'Норма', type: 'zone' },
        { id: 'zone-motion-2', name: 'рух 2', room: 'спальня', status: 'Норма', type: 'zone' },
        { id: 'reader-key', name: 'брелок', room: 'спальня дит', status: 'Норма', type: 'reader' },
      ],
    },
    {
      id: '261738',
      hub_id: '00230716',
      name: '261738',
      address: 'Калуш, вул. Січових Стрільців 3/31',
      status: 'disarmed',
      hub_online: false,
      issues: true,
      city: 'Калуш',
      timezone: 'Europe/Kyiv',
      company: {
        name: 'АО «Явир-2000»',
        country: 'Украина',
        pcs: '+380931702200',
        site: 'https://yavir2000.com',
        email: 'ajax@yavir2000.com',
      },
      contacts: [{ name: 'Владимир', role: 'Ответственное лицо', phone: '+380 50 111 22 33' }],
      notes: ['Тест канала каждые 5 минут.', 'Временно нет связи.'],
      devices: [
        { id: 'hub-261738', name: 'Хаб 261738', room: 'Склад', status: 'Не в сети', type: 'hub' },
        { id: 'zone-door', name: 'дверь', room: 'склад', status: 'Норма', type: 'zone' },
      ],
    },
    {
      id: '260696',
      hub_id: '00082578',
      name: 'Крамница',
      address: 'с. Цінева, вул. Залужна',
      status: 'night',
      hub_online: true,
      issues: false,
      city: 'Цінева',
      timezone: 'Europe/Kyiv',
      company: {
        name: 'АО «Явир-2000»',
        country: 'Украина',
        pcs: '+380931702200',
        site: 'https://yavir2000.com',
        email: 'ajax@yavir2000.com',
      },
      contacts: [{ name: 'Олег', role: 'Ответственное лицо', phone: '+380 67 555 44 22' }],
      notes: ['Ночной режим: только периметр.'],
      devices: [
        { id: 'hub-260696', name: 'Хаб 260696', room: 'Торговый зал', status: 'В сети', type: 'hub' },
        { id: 'zone-window', name: 'окно', room: 'зал', status: 'Норма', type: 'zone' },
        { id: 'reader-1', name: 'reader', room: 'вход', status: 'Норма', type: 'reader' },
      ],
    },
  ];

  for (const space of spaces) {
    await query('INSERT INTO hubs (id, space_id) VALUES ($1,$2)', [space.hub_id, space.id]);
    await query(
      `INSERT INTO spaces (id, hub_id, name, address, status, hub_online, issues, city, timezone, company, contacts, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        space.id,
        space.hub_id,
        space.name,
        space.address,
        space.status,
        space.hub_online,
        space.issues,
        space.city,
        space.timezone,
        JSON.stringify(space.company),
        JSON.stringify(space.contacts),
        JSON.stringify(space.notes),
      ],
    );

    for (const device of space.devices) {
      await query(
        'INSERT INTO devices (id, space_id, name, room, status, type, side, config) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [device.id, space.id, device.name, device.room, device.status, device.type, device.side ?? null, JSON.stringify(device.config ?? {})],
      );
    }
  }

  const logs = [
    ['261156', '04:11:43', 'Пользователь Aramaic поставил объект 261156 под охрану', 'Aramaic', 'security'],
    ['261156', '04:07:43', 'Добавлен новый пользователь Aramaic', 'АО «Явир-2000»', 'system'],
    ['261156', '03:11:14', 'Инженер Павлюк О. получил доступ к объекту', 'Явир2000', 'access'],
    ['261156', '12:01:33', 'Питание хаба подключено', '261156', 'system'],
    ['261156', '10:55:26', 'Снято с охраны пользователем Ivanna', 'Ivanna', 'security'],
    ['261738', '09:40:22', 'TEST_FAILED: хаб не в сети', 'Hub 261738', 'system'],
    ['261738', '08:12:10', 'Объект снят с охраны пользователем Владимир', 'Владимир', 'security'],
    ['260696', '21:10:01', 'Ночной режим включен через reader', 'reader', 'security'],
    ['260696', '20:48:17', 'PORT_IN: зона окно — норма', 'Hub 260696', 'system'],
  ];

  for (const [spaceId, time, text, who, type] of logs) {
    await query(
      'INSERT INTO logs (space_id, time, text, who, type) VALUES ($1,$2,$3,$4,$5)',
      [spaceId, time, text, who, type],
    );
  }

  console.log('Seed completed');
  process.exit(0);
};

seed().catch((error) => {
  console.error('Seed failed', error);
  process.exit(1);
});
