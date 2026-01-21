import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from './db.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());
app.use(express.static(path.resolve(__dirname, '..', 'web')));

const mapSpace = (row) => ({
  id: row.id,
  hubId: row.hub_id,
  name: row.name,
  address: row.address,
  status: row.status,
  hubOnline: row.hub_online,
  issues: row.issues,
  city: row.city,
  timezone: row.timezone,
  company: row.company,
  contacts: row.contacts,
  notes: row.notes,
});

const mapDevice = (row) => ({
  id: row.id,
  name: row.name,
  room: row.room,
  status: row.status,
  type: row.type,
  side: row.side,
  config: row.config,
});

const mapLog = (row) => ({
  time: row.time,
  text: row.text,
  who: row.who,
  type: row.type,
});

const loadDevices = async (spaceId) => {
  const devices = await query('SELECT * FROM devices WHERE space_id = $1 ORDER BY id', [spaceId]);
  return devices.rows.map(mapDevice);
};

const appendLog = async (spaceId, text, who, type) => {
  const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  await query(
    'INSERT INTO logs (space_id, time, text, who, type) VALUES ($1,$2,$3,$4,$5)',
    [spaceId, time, text, who, type],
  );
};

app.get('/api/spaces', async (req, res) => {
  const result = await query('SELECT * FROM spaces ORDER BY id');
  const spaces = await Promise.all(
    result.rows.map(async (row) => ({
      ...mapSpace(row),
      devices: await loadDevices(row.id),
    })),
  );
  res.json(spaces);
});

app.get('/api/spaces/:id', async (req, res) => {
  const result = await query('SELECT * FROM spaces WHERE id = $1', [req.params.id]);
  if (!result.rows.length) {
    return res.status(404).json({ error: 'space_not_found' });
  }
  const space = mapSpace(result.rows[0]);
  space.devices = await loadDevices(space.id);
  res.json(space);
});

app.get('/api/spaces/:id/logs', async (req, res) => {
  const result = await query(
    'SELECT time, text, who, type FROM logs WHERE space_id = $1 ORDER BY id DESC LIMIT 200',
    [req.params.id],
  );
  res.json(result.rows.map(mapLog));
});

app.post('/api/spaces', async (req, res) => {
  const { id, hubId, name, address, city, timezone } = req.body ?? {};
  if (!id || !hubId || !name) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const hub = await query('SELECT id FROM hubs WHERE id = $1', [hubId]);
  if (hub.rows.length) {
    return res.status(409).json({ error: 'hub_already_registered' });
  }

  const company = { name: 'Не указано', country: '—', pcs: '—', site: '—', email: '—' };
  const contacts = [];
  const notes = [];

  await query('INSERT INTO hubs (id, space_id) VALUES ($1,$2)', [hubId, id]);
  await query(
    `INSERT INTO spaces (id, hub_id, name, address, status, hub_online, issues, city, timezone, company, contacts, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      id,
      hubId,
      name,
      address ?? '—',
      'disarmed',
      true,
      false,
      city ?? '—',
      timezone ?? 'Europe/Kyiv',
      JSON.stringify(company),
      JSON.stringify(contacts),
      JSON.stringify(notes),
    ],
  );

  await appendLog(id, 'Создано пространство', 'UI', 'system');
  const space = await query('SELECT * FROM spaces WHERE id = $1', [id]);
  const result = mapSpace(space.rows[0]);
  result.devices = [];
  res.status(201).json(result);
});

app.post('/api/spaces/:id/attach-hub', async (req, res) => {
  const { hubId } = req.body ?? {};
  if (!hubId) return res.status(400).json({ error: 'missing_hub_id' });

  const existing = await query('SELECT id FROM hubs WHERE id = $1', [hubId]);
  if (existing.rows.length) {
    return res.status(409).json({ error: 'hub_already_registered' });
  }

  await query('INSERT INTO hubs (id, space_id) VALUES ($1,$2)', [hubId, req.params.id]);
  await query('UPDATE spaces SET hub_id = $1 WHERE id = $2', [hubId, req.params.id]);
  await appendLog(req.params.id, 'Хаб привязан к пространству', 'UI', 'system');
  res.json({ ok: true });
});

app.post('/api/spaces/:id/devices', async (req, res) => {
  const { id, name, room, status, type, side, config } = req.body ?? {};
  if (!id || !name || !room || !type) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  await query(
    'INSERT INTO devices (id, space_id, name, room, status, type, side, config) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      id,
      req.params.id,
      name,
      room,
      status ?? 'Норма',
      type,
      side ?? null,
      JSON.stringify(config ?? {}),
    ],
  );

  await appendLog(req.params.id, `Добавлено устройство: ${name}`, 'UI', 'system');
  res.status(201).json({ ok: true });
});

const updateStatus = async (spaceId, status, who) => {
  const updated = await query('UPDATE spaces SET status = $1 WHERE id = $2 RETURNING *', [status, spaceId]);
  if (!updated.rows.length) return null;
  await appendLog(spaceId, status === 'armed' ? 'Объект поставлен под охрану' : 'Объект снят с охраны', who, 'security');
  const space = mapSpace(updated.rows[0]);
  space.devices = await loadDevices(spaceId);
  return space;
};

app.post('/api/spaces/:id/arm', async (req, res) => {
  const space = await updateStatus(req.params.id, 'armed', 'UI');
  if (!space) return res.status(404).json({ error: 'space_not_found' });
  res.json(space);
});

app.post('/api/spaces/:id/disarm', async (req, res) => {
  const space = await updateStatus(req.params.id, 'disarmed', 'UI');
  if (!space) return res.status(404).json({ error: 'space_not_found' });
  res.json(space);
});

app.post('/api/hub/events', async (req, res) => {
  const { type, hubId, ts } = req.body ?? {};
  if (!type || !hubId) {
    return res.status(400).json({ error: 'invalid_payload' });
  }

  const hubIdClean = hubId.startsWith('HUB-') ? hubId.replace('HUB-', '') : hubId;
  const spaceResult = await query('SELECT space_id FROM hubs WHERE id = $1', [hubIdClean]);
  if (!spaceResult.rows.length) {
    return res.status(202).json({ ok: true, ignored: true });
  }

  const spaceId = spaceResult.rows[0].space_id;
  const time = ts
    ? new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  await query(
    'INSERT INTO logs (space_id, time, text, who, type) VALUES ($1,$2,$3,$4,$5)',
    [spaceId, time, `Событие хаба: ${type}`, hubId, 'system'],
  );

  res.json({ ok: true });
});

app.post('/api/reader/events', async (req, res) => {
  const { type, readerId, payload, ts } = req.body ?? {};
  if (type !== 'READER_SCAN' || !readerId) {
    return res.status(400).json({ error: 'invalid_payload' });
  }

  const reader = await query('SELECT space_id, name FROM readers WHERE id = $1', [readerId]);
  if (!reader.rows.length) {
    return res.status(202).json({ ok: true, ignored: true });
  }

  const spaceId = reader.rows[0].space_id;
  const time = ts
    ? new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const keyName = payload?.keyName ?? 'Неизвестный ключ';

  await query(
    'INSERT INTO logs (space_id, time, text, who, type) VALUES ($1,$2,$3,$4,$5)',
    [spaceId, time, `Скан ключа: ${keyName}`, reader.rows[0].name ?? readerId, 'access'],
  );

  res.json({ ok: true });
});

app.listen(8080, () => {
  console.log('Backend listening on http://localhost:8080');
});
