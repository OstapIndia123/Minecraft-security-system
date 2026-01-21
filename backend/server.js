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
  devices: row.devices,
});

app.get('/api/spaces', async (req, res) => {
  const result = await query('SELECT * FROM spaces ORDER BY id');
  res.json(result.rows.map(mapSpace));
});

app.get('/api/spaces/:id', async (req, res) => {
  const result = await query('SELECT * FROM spaces WHERE id = $1', [req.params.id]);
  if (!result.rows.length) {
    return res.status(404).json({ error: 'space_not_found' });
  }
  res.json(mapSpace(result.rows[0]));
});

app.get('/api/spaces/:id/logs', async (req, res) => {
  const result = await query(
    'SELECT time, text, who, type FROM logs WHERE space_id = $1 ORDER BY id DESC LIMIT 200',
    [req.params.id],
  );
  res.json(result.rows);
});

const updateStatus = async (spaceId, status, who) => {
  const updated = await query('UPDATE spaces SET status = $1 WHERE id = $2 RETURNING *', [status, spaceId]);
  if (!updated.rows.length) return null;
  await query(
    'INSERT INTO logs (space_id, time, text, who, type) VALUES ($1,$2,$3,$4,$5)',
    [
      spaceId,
      new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      status === 'armed' ? 'Объект поставлен под охрану' : 'Объект снят с охраны',
      who,
      'security',
    ],
  );
  return mapSpace(updated.rows[0]);
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

  const spaceResult = await query('SELECT id FROM spaces WHERE hub_id = $1', [hubId.replace('HUB-', '')]);
  if (!spaceResult.rows.length) {
    return res.status(202).json({ ok: true, ignored: true });
  }

  const spaceId = spaceResult.rows[0].id;
  const time = ts
    ? new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  await query(
    'INSERT INTO logs (space_id, time, text, who, type) VALUES ($1,$2,$3,$4,$5)',
    [spaceId, time, `Событие хаба: ${type}`, hubId, 'system'],
  );

  res.json({ ok: true });
});

app.listen(8080, () => {
  console.log('Backend listening on http://localhost:8080');
});
