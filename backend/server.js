import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from './db.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webhookToken = process.env.WEBHOOK_TOKEN;
const hubApiUrl = process.env.HUB_API_URL ?? 'http://127.0.0.1:8090';
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

const normalizeHubId = (hubId) => (hubId?.startsWith('HUB-') ? hubId.replace('HUB-', '') : hubId);
const formatHubIdForSend = (hubId) => (hubId?.startsWith('HUB-') ? hubId : `HUB-${hubId}`);

const loadDevices = async (spaceId, hubId, hubOnline) => {
  const devices = await query('SELECT * FROM devices WHERE space_id = $1 ORDER BY id', [spaceId]);
  const keys = await query('SELECT id, name, reader_id FROM keys WHERE space_id = $1 ORDER BY id', [spaceId]);

  const hubLabel = hubId ? `Хаб ${hubId}` : 'Хаб не привязан';
  const hubStatus = hubId ? (hubOnline ? 'В сети' : 'Не в сети') : 'Не привязан';
  const hubDevice = {
    id: hubId ? `hub-${hubId}` : 'hub-none',
    name: hubLabel,
    room: '—',
    status: hubStatus,
    type: 'hub',
    side: null,
    config: {},
  };

  const keyDevices = keys.rows.map((key) => ({
    id: `key-${key.id}`,
    name: `Ключ: ${key.name}`,
    room: '—',
    status: 'Активен',
    type: 'key',
    side: null,
    config: { keyId: key.id, readerId: key.reader_id ?? null },
  }));

  return [hubDevice, ...devices.rows.map(mapDevice), ...keyDevices];
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

const sendHubOutput = async (hubId, side, level) => {
  if (!hubId) return;
  const formattedHubId = formatHubIdForSend(hubId);
  const url = new URL(`/api/hub/${encodeURIComponent(formattedHubId)}/outputs`, hubApiUrl);
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ side, level }),
  });
};

const sendReaderOutput = async (readerId, level) => {
  if (!readerId) return;
  const url = new URL(`/api/reader/${encodeURIComponent(readerId)}/output`, hubApiUrl);
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level }),
  });
};

const sirenTimers = new Map();
const spaceAlarmState = new Map();

const stopSirenTimers = async (spaceId, hubId) => {
  const timers = sirenTimers.get(spaceId) ?? [];
  timers.forEach((timer) => clearInterval(timer));
  sirenTimers.delete(spaceId);
  if (hubId) {
    const sirens = await query('SELECT side FROM devices WHERE space_id = $1 AND type = $2', [spaceId, 'siren']);
    await Promise.all(
      sirens.rows.map((siren) => sendHubOutput(hubId, siren.side, 0).catch(() => null)),
    );
  }
};

const startSirenTimers = async (spaceId, hubId) => {
  if (!hubId) return;
  if (sirenTimers.has(spaceId)) return;
  const sirens = await query('SELECT id, side, config FROM devices WHERE space_id = $1 AND type = $2', [
    spaceId,
    'siren',
  ]);

  const timers = [];
  for (const siren of sirens.rows) {
    const intervalMs = Number(siren.config?.intervalMs ?? 1000);
    const level = Number(siren.config?.level ?? 15);
    let on = false;
    const timer = setInterval(() => {
      on = !on;
      sendHubOutput(hubId, siren.side, on ? level : 0).catch(() => null);
    }, Math.max(intervalMs, 100));
    timers.push(timer);
  }
  if (timers.length) {
    sirenTimers.set(spaceId, timers);
  }
};

app.get('/api/spaces', async (req, res) => {
  const result = await query('SELECT * FROM spaces ORDER BY id');
  const spaces = await Promise.all(
    result.rows.map(async (row) => ({
      ...mapSpace(row),
      devices: await loadDevices(row.id, row.hub_id, row.hub_online),
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
  space.devices = await loadDevices(space.id, space.hubId, space.hubOnline);
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
  result.devices = await loadDevices(result.id, result.hubId, result.hubOnline);
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
  result.devices = await loadDevices(req.params.id, result.hubId, result.hubOnline);
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

app.delete('/api/spaces/:id/hub', async (req, res) => {
  const existing = await query('SELECT hub_id FROM spaces WHERE id = $1', [req.params.id]);
  if (!existing.rows.length) return res.status(404).json({ error: 'space_not_found' });

  await query('DELETE FROM hubs WHERE space_id = $1', [req.params.id]);
  await query('UPDATE spaces SET hub_id = $1, hub_online = $2 WHERE id = $3', [null, false, req.params.id]);
  await appendLog(req.params.id, 'Хаб удалён из пространства', 'UI', 'system');
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

  if (type === 'output-light') {
    const spaceRow = await query('SELECT status, hub_id FROM spaces WHERE id = $1', [req.params.id]);
    const status = spaceRow.rows[0]?.status ?? 'disarmed';
    await applyLightOutputs(req.params.id, spaceRow.rows[0]?.hub_id, status);
  }

  if (type === 'siren' && spaceAlarmState.get(req.params.id)) {
    const spaceRow = await query('SELECT hub_id FROM spaces WHERE id = $1', [req.params.id]);
    await startSirenTimers(req.params.id, spaceRow.rows[0]?.hub_id);
  }

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

app.delete('/api/spaces/:id', async (req, res) => {
  const existing = await query('SELECT id FROM spaces WHERE id = $1', [req.params.id]);
  if (!existing.rows.length) return res.status(404).json({ error: 'space_not_found' });

  await stopSirenTimers(req.params.id);
  await query('DELETE FROM hubs WHERE space_id = $1', [req.params.id]);
  await query('DELETE FROM spaces WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/spaces/:id/devices/:deviceId', async (req, res) => {
  const { id, deviceId } = req.params;
  const existing = await query('SELECT id, type FROM devices WHERE id = $1 AND space_id = $2', [deviceId, id]);
  if (!existing.rows.length) return res.status(404).json({ error: 'device_not_found' });

  const deviceType = existing.rows[0].type;
  await query('DELETE FROM devices WHERE id = $1 AND space_id = $2', [deviceId, id]);
  if (deviceType === 'zone') {
    await evaluateZoneIssues(id);
  }
  if (deviceType === 'siren') {
    const spaceRow = await query('SELECT hub_id FROM spaces WHERE id = $1', [id]);
    await stopSirenTimers(id, spaceRow.rows[0]?.hub_id);
  }
  await appendLog(id, `Удалено устройство: ${deviceId}`, 'UI', 'system');
  res.json({ ok: true });
});

app.delete('/api/spaces/:id/keys/:keyId', async (req, res) => {
  const { id, keyId } = req.params;
  const existing = await query('SELECT id FROM keys WHERE id = $1 AND space_id = $2', [keyId, id]);
  if (!existing.rows.length) return res.status(404).json({ error: 'key_not_found' });

  await query('DELETE FROM keys WHERE id = $1 AND space_id = $2', [keyId, id]);
  await appendLog(id, `Удалён ключ: ${keyId}`, 'UI', 'system');
  res.json({ ok: true });
});

async function applyLightOutputs(spaceId, hubId, status) {
  if (!hubId) return;
  const outputs = await query(
    'SELECT side, config FROM devices WHERE space_id = $1 AND type = $2',
    [spaceId, 'output-light'],
  );
  await Promise.all(
    outputs.rows.map((output) => {
      const level = Number(output.config?.level ?? 15);
      return sendHubOutput(hubId, output.side, status === 'armed' ? level : 0).catch(() => null);
    }),
  );
}

const updateStatus = async (spaceId, status, who) => {
  const updated = await query('UPDATE spaces SET status = $1 WHERE id = $2 RETURNING *', [status, spaceId]);
  if (!updated.rows.length) return null;
  await appendLog(spaceId, status === 'armed' ? 'Объект поставлен под охрану' : 'Объект снят с охраны', who, 'security');
  const space = mapSpace(updated.rows[0]);
  await applyLightOutputs(spaceId, space.hubId, status);
  if (status !== 'armed') {
    await stopSirenTimers(spaceId, space.hubId);
    spaceAlarmState.set(spaceId, false);
  }
  space.devices = await loadDevices(spaceId, space.hubId, space.hubOnline);
  return space;
};

const evaluateZoneIssues = async (spaceId) => {
  const zones = await query(
    "SELECT status FROM devices WHERE space_id = $1 AND type = 'zone'",
    [spaceId],
  );
  const hasIssues = zones.rows.some((zone) => zone.status !== 'Норма');
  await query('UPDATE spaces SET issues = $1 WHERE id = $2', [hasIssues, spaceId]);
  return hasIssues;
};

const handleReaderScan = async ({ readerId, payload, ts }) => {
  const device = await query('SELECT space_id, name, config FROM devices WHERE id = $1 AND type = $2', [
    readerId,
    'reader',
  ]);
  if (!device.rows.length) {
    return { ok: true, ignored: true };
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

  const outputLevel = Number(config?.outputLevel ?? 6);
  await sendReaderOutput(readerId, outputLevel).catch(() => null);

  return {
    ok: true,
    output: {
      readerId,
      level: outputLevel,
    },
  };
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
  const { type, hubId, ts, payload, readerId } = req.body ?? {};
  if (!type) {
    return res.status(400).json({ error: 'invalid_payload' });
  }

  if (type === 'READER_SCAN') {
    const result = await handleReaderScan({ readerId, payload, ts });
    return res.json(result);
  }

  if (!hubId) {
    return res.status(202).json({ ok: true, ignored: true });
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

  if (type === 'TEST_FAIL') {
    await query('UPDATE spaces SET hub_online = $1 WHERE id = $2', [false, spaceId]);
  }

  if (type === 'TEST_OK' || type === 'HUB_PING' || type === 'PORT_IN' || type === 'HUB_ONLINE') {
    await query('UPDATE spaces SET hub_online = $1 WHERE id = $2', [true, spaceId]);
  }

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
      'SELECT id, name, config FROM devices WHERE space_id = $1 AND type = $2 AND side = $3',
      [spaceId, 'zone', payload.side],
    );

    for (const zone of zones.rows) {
      const config = zone.config ?? {};
      const normalLevel = Number(config.normalLevel ?? 15);
      const isNormal = Number(payload.level) === normalLevel;
      const newStatus = isNormal ? 'Норма' : 'Нарушение';
      await query('UPDATE devices SET status = $1 WHERE id = $2', [newStatus, zone.id]);

      const spaceRow = await query('SELECT status, hub_id FROM spaces WHERE id = $1', [spaceId]);
      const status = spaceRow.rows[0]?.status ?? 'disarmed';
      const zoneType = config.zoneType ?? 'instant';
      const bypass = Boolean(config.bypass);
      const shouldCheck = zoneType === '24h' || status === 'armed';

      if (shouldCheck && !bypass && !isNormal) {
        await appendLog(spaceId, `Нарушение зоны: ${zone.name}`, 'Zone', 'security');
        spaceAlarmState.set(spaceId, true);
        await startSirenTimers(spaceId, spaceRow.rows[0]?.hub_id);
      }
    }

    const hasIssues = await evaluateZoneIssues(spaceId);
    if (!hasIssues) {
      const spaceRow = await query('SELECT hub_id FROM spaces WHERE id = $1', [spaceId]);
      spaceAlarmState.set(spaceId, false);
      await stopSirenTimers(spaceId, spaceRow.rows[0]?.hub_id);
    }
  }

  res.json({ ok: true });
});

app.post('/api/reader/events', requireWebhookToken, async (req, res) => {
  const { type, readerId, payload, ts } = req.body ?? {};
  if (type !== 'READER_SCAN' || !readerId) {
    return res.status(400).json({ error: 'invalid_payload' });
  }
  const result = await handleReaderScan({ readerId, payload, ts });
  res.json(result);
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
