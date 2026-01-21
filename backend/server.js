import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from './db.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webhookToken = process.env.WEBHOOK_TOKEN;
const port = Number(process.env.PORT ?? 8080);

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
  photos: row.photos,
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

const requireWebhookToken = (req, res, next) => {
  if (!webhookToken) return next();
  const headerToken = req.header('x-webhook-token')
    ?? req.header('x-hub-token')
    ?? req.header('authorization')?.replace('Bearer ', '');
  if (headerToken !== webhookToken) {
    return res.status(401).json({ error: 'invalid_token' });
  }
  return next();
};

const normalizeHubId = (hubId) => (hubId?.startsWith('HUB-') ? hubId.replace('HUB-', '') : hubId);

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
  const { hubId, name, address, city, timezone } = req.body ?? {};
  if (!hubId || !name) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const normalizedHubId = normalizeHubId(hubId);
  const hub = await query('SELECT id FROM hubs WHERE id = $1', [normalizedHubId]);
  if (hub.rows.length) {
    return res.status(409).json({ error: 'hub_already_registered' });
  }

  const generatedId = `SPACE-${Date.now()}`;
  const company = { name: 'Не указано', country: '—', pcs: '—', site: '—', email: '—' };
  const contacts = [];
  const notes = [];
  const photos = [];

  await query('INSERT INTO hubs (id, space_id) VALUES ($1,$2)', [normalizedHubId, generatedId]);
  await query(
    `INSERT INTO spaces (id, hub_id, name, address, status, hub_online, issues, city, timezone, company, contacts, notes, photos)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      generatedId,
      normalizedHubId,
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
      JSON.stringify(photos),
    ],
  );

  await appendLog(generatedId, 'Создано пространство', 'UI', 'system');
  const space = await query('SELECT * FROM spaces WHERE id = $1', [generatedId]);
  const result = mapSpace(space.rows[0]);
  result.devices = [];
  res.status(201).json(result);
});

app.patch('/api/spaces/:id', async (req, res) => {
  const { name, address, city, timezone } = req.body ?? {};
  const existing = await query('SELECT * FROM spaces WHERE id = $1', [req.params.id]);
  if (!existing.rows.length) {
    return res.status(404).json({ error: 'space_not_found' });
  }

  const space = existing.rows[0];
  const updated = await query(
    'UPDATE spaces SET name = $1, address = $2, city = $3, timezone = $4 WHERE id = $5 RETURNING *',
    [
      name ?? space.name,
      address ?? space.address,
      city ?? space.city,
      timezone ?? space.timezone,
      req.params.id,
    ],
  );

  await appendLog(req.params.id, 'Обновлена информация об объекте', 'UI', 'system');
  const result = mapSpace(updated.rows[0]);
  result.devices = await loadDevices(req.params.id);
  res.json(result);
});

app.post('/api/spaces/:id/contacts', async (req, res) => {
  const { name, role, phone } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'missing_fields' });

  const result = await query('SELECT contacts FROM spaces WHERE id = $1', [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'space_not_found' });

  const contacts = result.rows[0].contacts ?? [];
  contacts.push({ name, role: role ?? '—', phone: phone ?? '—' });
  await query('UPDATE spaces SET contacts = $1 WHERE id = $2', [JSON.stringify(contacts), req.params.id]);
  await appendLog(req.params.id, `Добавлено контактное лицо: ${name}`, 'UI', 'system');
  res.status(201).json({ ok: true });
});

app.post('/api/spaces/:id/notes', async (req, res) => {
  const { text } = req.body ?? {};
  if (!text) return res.status(400).json({ error: 'missing_fields' });

  const result = await query('SELECT notes FROM spaces WHERE id = $1', [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'space_not_found' });

  const notes = result.rows[0].notes ?? [];
  notes.push(text);
  await query('UPDATE spaces SET notes = $1 WHERE id = $2', [JSON.stringify(notes), req.params.id]);
  await appendLog(req.params.id, 'Добавлено примечание', 'UI', 'system');
  res.status(201).json({ ok: true });
});

app.post('/api/spaces/:id/photos', async (req, res) => {
  const { url, label } = req.body ?? {};
  if (!url) return res.status(400).json({ error: 'missing_fields' });

  const result = await query('SELECT photos FROM spaces WHERE id = $1', [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'space_not_found' });

  const photos = result.rows[0].photos ?? [];
  photos.push({ url, label: label ?? 'Фото' });
  await query('UPDATE spaces SET photos = $1 WHERE id = $2', [JSON.stringify(photos), req.params.id]);
  await appendLog(req.params.id, 'Добавлено фото', 'UI', 'system');
  res.status(201).json({ ok: true });
});

app.post('/api/spaces/:id/attach-hub', async (req, res) => {
  const { hubId } = req.body ?? {};
  if (!hubId) return res.status(400).json({ error: 'missing_hub_id' });

  const normalizedHubId = normalizeHubId(hubId);
  const existing = await query('SELECT id FROM hubs WHERE id = $1', [normalizedHubId]);
  if (existing.rows.length) {
    return res.status(409).json({ error: 'hub_already_registered' });
  }

  await query('INSERT INTO hubs (id, space_id) VALUES ($1,$2)', [normalizedHubId, req.params.id]);
  await query('UPDATE spaces SET hub_id = $1 WHERE id = $2', [normalizedHubId, req.params.id]);
  await appendLog(req.params.id, 'Хаб привязан к пространству', 'UI', 'system');
  res.json({ ok: true });
});

const deviceConfigFromPayload = (payload) => {
  if (payload.type === 'output-light') {
    return { level: Number(payload.outputLevel ?? 15) };
  }
  if (payload.type === 'siren') {
    return { level: Number(payload.outputLevel ?? 15), intervalMs: Number(payload.intervalMs ?? 1000) };
  }
  if (payload.type === 'reader') {
    return {
      outputLevel: Number(payload.outputLevel ?? 6),
      inputSide: payload.inputSide ?? 'up',
      inputLevel: Number(payload.inputLevel ?? 6),
    };
  }
  if (payload.type === 'zone') {
    return {
      zoneType: payload.zoneType ?? 'instant',
      bypass: payload.bypass === 'true',
      normalLevel: Number(payload.normalLevel ?? 15),
    };
  }
  return {};
};

app.post('/api/spaces/:id/devices', async (req, res) => {
  const { id, name, room, status, type, side } = req.body ?? {};
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
      JSON.stringify(deviceConfigFromPayload(req.body)),
    ],
  );

  await appendLog(req.params.id, `Добавлено устройство: ${name}`, 'UI', 'system');
  res.status(201).json({ ok: true });
});

app.post('/api/spaces/:id/keys', async (req, res) => {
  const { name, readerId } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'missing_fields' });

  await query('INSERT INTO keys (space_id, name, reader_id, groups) VALUES ($1,$2,$3,$4)', [
    req.params.id,
    name,
    readerId ?? null,
    JSON.stringify(['all']),
  ]);
  await appendLog(req.params.id, `Добавлен ключ: ${name}`, 'UI', 'system');
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

app.post('/api/hub/events', requireWebhookToken, async (req, res) => {
  const { type, hubId, ts, payload } = req.body ?? {};
  if (!type || !hubId) {
    return res.status(400).json({ error: 'invalid_payload' });
  }

  const normalizedHubId = normalizeHubId(hubId);
  const spaceResult = await query('SELECT space_id FROM hubs WHERE id = $1', [normalizedHubId]);
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

  if (type === 'PORT_IN' && payload?.side && payload?.level !== undefined) {
    const sessions = await query(
      'SELECT id, input_side, input_level FROM reader_sessions WHERE space_id = $1 AND expires_at >= NOW() ORDER BY id DESC LIMIT 1',
      [spaceId],
    );
    if (sessions.rows.length) {
      const session = sessions.rows[0];
      if (session.input_side === payload.side && Number(session.input_level) === Number(payload.level)) {
        await updateStatus(spaceId, 'armed', 'Reader');
        await query('DELETE FROM reader_sessions WHERE id = $1', [session.id]);
      }
    }

    const zones = await query(
      'SELECT name, config FROM devices WHERE space_id = $1 AND type = $2 AND side = $3',
      [spaceId, 'zone', payload.side],
    );
    if (zones.rows.length) {
      const spaceRow = await query('SELECT status FROM spaces WHERE id = $1', [spaceId]);
      const status = spaceRow.rows[0]?.status ?? 'disarmed';

      for (const zone of zones.rows) {
        const config = zone.config ?? {};
        const normalLevel = Number(config.normalLevel ?? 15);
        const bypass = Boolean(config.bypass);
        const zoneType = config.zoneType ?? 'instant';
        const shouldCheck = zoneType === '24h' || status === 'armed';

        if (shouldCheck && !bypass && Number(payload.level) !== normalLevel) {
          await appendLog(spaceId, `Нарушение зоны: ${zone.name}`, 'Zone', 'security');
          await query('UPDATE spaces SET issues = true WHERE id = $1', [spaceId]);
        }
      }
    }
  }

  res.json({ ok: true });
});

app.post('/api/reader/events', requireWebhookToken, async (req, res) => {
  const { type, readerId, payload, ts } = req.body ?? {};
  if (type !== 'READER_SCAN' || !readerId) {
    return res.status(400).json({ error: 'invalid_payload' });
  }

  const device = await query('SELECT space_id, name, config FROM devices WHERE id = $1 AND type = $2', [readerId, 'reader']);
  if (!device.rows.length) {
    return res.status(202).json({ ok: true, ignored: true });
  }

  const { space_id: spaceId, name, config } = device.rows[0];
  const time = ts
    ? new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const keyName = payload?.keyName ?? 'Неизвестный ключ';

  await query(
    'INSERT INTO logs (space_id, time, text, who, type) VALUES ($1,$2,$3,$4,$5)',
    [spaceId, time, `Скан ключа: ${keyName}`, name ?? readerId, 'access'],
  );

  const inputSide = config?.inputSide ?? 'up';
  const inputLevel = Number(config?.inputLevel ?? 6);
  await query(
    'INSERT INTO reader_sessions (reader_id, space_id, input_side, input_level, expires_at) VALUES ($1,$2,$3,$4,NOW() + INTERVAL \'1 second\')',
    [readerId, spaceId, inputSide, inputLevel],
  );

  const key = await query(
    'SELECT name FROM keys WHERE space_id = $1 AND (reader_id IS NULL OR reader_id = $2)',
    [spaceId, readerId],
  );
  const hasKey = key.rows.some((row) => keyName.includes(row.name));
  if (hasKey) {
    await updateStatus(spaceId, 'disarmed', 'Key');
  }

  res.json({
    ok: true,
    output: {
      readerId,
      level: Number(config?.outputLevel ?? 6),
    },
  });
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
