import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from './db.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webhookToken = process.env.WEBHOOK_TOKEN;
const hubApiUrl = process.env.HUB_API_URL ?? 'http://127.0.0.1:8090';
const discordClientId = process.env.DISCORD_CLIENT_ID;
const discordClientSecret = process.env.DISCORD_CLIENT_SECRET;
const discordRedirectUri = process.env.DISCORD_REDIRECT_URI;
const port = Number(process.env.PORT ?? 8080);

app.use(cors());
app.use(express.json());
app.use(express.static(path.resolve(__dirname, '..', 'web')));

const hashPassword = (password, salt) => {
  const effectiveSalt = salt ?? crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, effectiveSalt, 64).toString('hex');
  return { salt: effectiveSalt, hash };
};

const formatPasswordHash = (password) => {
  const { salt, hash } = hashPassword(password);
  return `scrypt$${salt}$${hash}`;
};

const verifyPassword = (password, stored) => {
  if (!stored?.startsWith('scrypt$')) return false;
  const [, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const candidate = hashPassword(password, salt).hash;
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));
};

const getAuthToken = (req) => {
  const header = req.header('authorization');
  if (header?.startsWith('Bearer ')) {
    return header.slice(7);
  }
  return req.header('x-session-token') ?? null;
};

const loadSessionUser = async (token) => {
  if (!token) return null;
  const result = await query(
    `SELECT users.id, users.email, users.role, users.minecraft_nickname, users.discord_id, users.language, users.timezone
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token = $1 AND sessions.expires_at > NOW()`,
    [token],
  );
  return result.rows[0] ?? null;
};

const requireAuth = async (req, res, next) => {
  const token = getAuthToken(req);
  const user = await loadSessionUser(token);
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  req.user = user;
  next();
};

const requireInstaller = (req, res, next) => {
  if (req.user?.role !== 'installer') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  next();
};

const ensureSpaceAccess = async (userId, spaceId) => {
  const result = await query(
    'SELECT 1 FROM user_spaces WHERE user_id = $1 AND space_id = $2',
    [userId, spaceId],
  );
  return result.rows.length > 0;
};

const issueSession = async (userId) => {
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await query(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES ($1,$2,$3)',
    [token, userId, expiresAt],
  );
  return { token, expiresAt };
};

const buildDiscordAuthUrl = (mode) => {
  const state = Buffer.from(JSON.stringify({ mode })).toString('base64');
  const params = new URLSearchParams({
    client_id: discordClientId ?? '',
    redirect_uri: discordRedirectUri ?? '',
    response_type: 'code',
    scope: 'identify',
    state,
    prompt: 'consent',
  });
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
};

const exchangeDiscordCode = async (code) => {
  const params = new URLSearchParams({
    client_id: discordClientId ?? '',
    client_secret: discordClientSecret ?? '',
    grant_type: 'authorization_code',
    code,
    redirect_uri: discordRedirectUri ?? '',
  });
  const response = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  if (!response.ok) {
    throw new Error('discord_token_failed');
  }
  return response.json();
};

const fetchDiscordUser = async (tokenType, accessToken) => {
  const response = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `${tokenType} ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error('discord_user_failed');
  }
  return response.json();
};

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

const mapLog = (row) => {
  const createdAt = row.created_at;
  const createdAtMs = createdAt ? new Date(createdAt).getTime() : null;
  return {
    time: row.time,
    text: row.text,
    who: row.who,
    type: row.type,
    createdAt,
    createdAtMs,
  };
};

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

const formatHubPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return '';
  return JSON.stringify(payload, null, 2);
};

const trimHubLogs = async (hubId) => {
  await query(
    `DELETE FROM logs
     WHERE id IN (
       SELECT id FROM logs
       WHERE type = 'hub_raw' AND who = $1
       ORDER BY id DESC
       OFFSET 100
     )`,
    [hubId],
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

const ensureSpaceDisarmed = async (spaceId, res) => {
  const statusResult = await query('SELECT status FROM spaces WHERE id = $1', [spaceId]);
  if (!statusResult.rows.length) {
    res.status(404).json({ error: 'space_not_found' });
    return false;
  }
  if (statusResult.rows[0].status === 'armed') {
    res.status(409).json({ error: 'space_armed' });
    return false;
  }
  return true;
};

const mapOutputSide = (side) => {
  if (side === 'up') return 'down';
  if (side === 'down') return 'up';
  return side;
};

const hubOutputState = new Map();

const sendHubOutput = async (hubId, side, level) => {
  if (!hubId) return;
  const formattedHubId = formatHubIdForSend(hubId);
  const outputSide = mapOutputSide(side);
  const stateKey = `${formattedHubId}:${outputSide}`;
  if (hubOutputState.get(stateKey) === level) {
    return;
  }
  hubOutputState.set(stateKey, level);
  const url = new URL(`/api/hub/${encodeURIComponent(formattedHubId)}/outputs`, hubApiUrl);
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ side: outputSide, level }),
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

const pulseReaderOutput = async (readerId, level, durationMs = 250) => {
  await sendReaderOutput(readerId, level);
  setTimeout(() => {
    sendReaderOutput(readerId, 0).catch(() => null);
  }, durationMs);
};

const sirenTimers = new Map();
const sirenStopTimeouts = new Map();
const spaceAlarmState = new Map();
const pendingArmTimers = new Map();
const entryDelayTimers = new Map();
const entryDelayFailed = new Map();
const lightBlinkTimers = new Map();
const lastKeyScans = new Map();
const keyScanWaiters = new Map();

const stopSirenTimers = async (spaceId, hubId) => {
  const timers = sirenTimers.get(spaceId) ?? [];
  timers.forEach((timer) => clearInterval(timer));
  sirenTimers.delete(spaceId);
  const stopTimeout = sirenStopTimeouts.get(spaceId);
  if (stopTimeout) {
    clearTimeout(stopTimeout);
    sirenStopTimeouts.delete(spaceId);
  }
  if (hubId) {
    const sirens = await query('SELECT side FROM devices WHERE space_id = $1 AND type = $2', [spaceId, 'siren']);
    await Promise.all(
      sirens.rows.map((siren) => sendHubOutput(hubId, siren.side, 0).catch(() => null)),
    );
  }
};

const startBlinkingLights = async (spaceId, hubId, reason) => {
  if (!hubId) return;
  const existing = lightBlinkTimers.get(spaceId);
  if (existing) {
    existing.reasons.add(reason);
    return;
  }
  const outputs = await query(
    'SELECT side, config FROM devices WHERE space_id = $1 AND type = $2',
    [spaceId, 'output-light'],
  );
  if (!outputs.rows.length) return;
  let on = false;
  const timer = setInterval(() => {
    on = !on;
    outputs.rows.forEach((output) => {
      const level = Number(output.config?.level ?? 15);
      sendHubOutput(hubId, output.side, on ? level : 0).catch(() => null);
    });
  }, 500);
  lightBlinkTimers.set(spaceId, { timer, reasons: new Set([reason]) });
};

const stopBlinkingLights = async (spaceId, hubId, reason) => {
  const existing = lightBlinkTimers.get(spaceId);
  if (!existing) return;
  existing.reasons.delete(reason);
  if (existing.reasons.size) return;
  clearInterval(existing.timer);
  lightBlinkTimers.delete(spaceId);
  const spaceRow = await query('SELECT status, hub_id FROM spaces WHERE id = $1', [spaceId]);
  const status = spaceRow.rows[0]?.status ?? 'disarmed';
  const resolvedHubId = hubId ?? spaceRow.rows[0]?.hub_id;
  await applyLightOutputs(spaceId, resolvedHubId, status);
};

const scheduleSirenStop = (spaceId, hubId, durationMs) => {
  if (!hubId || !durationMs || durationMs <= 0) return;
  const existing = sirenStopTimeouts.get(spaceId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    stopSirenTimers(spaceId, hubId).catch(() => null);
  }, durationMs);
  sirenStopTimeouts.set(spaceId, timer);
};

const getMaxSirenDuration = (sirens) => sirens.reduce((max, siren) => {
  const seconds = Number(siren.config?.alarmDuration ?? 0);
  const durationMs = seconds > 0 ? seconds * 1000 : 0;
  return Math.max(max, durationMs);
}, 0);

const getExitDelaySeconds = (zones) => zones.reduce((max, zone) => {
  const zoneType = zone.config?.zoneType;
  if (zoneType !== 'delayed') return max;
  const delaySeconds = Number(zone.config?.delaySeconds ?? 30);
  return Math.max(max, delaySeconds);
}, 0);

const clearPendingArm = async (spaceId, hubId) => {
  const timer = pendingArmTimers.get(spaceId);
  if (timer) {
    clearTimeout(timer);
    pendingArmTimers.delete(spaceId);
    await stopBlinkingLights(spaceId, hubId, 'exit-delay');
  }
};

const clearEntryDelay = async (spaceId, hubId) => {
  const entry = entryDelayTimers.get(spaceId);
  if (!entry) return;
  clearTimeout(entry.timer);
  entryDelayTimers.delete(spaceId);
  await stopBlinkingLights(spaceId, hubId, 'entry-delay');
};

const startSirenTimers = async (spaceId, hubId) => {
  if (!hubId) return;
  const sirens = await query('SELECT id, side, config FROM devices WHERE space_id = $1 AND type = $2', [
    spaceId,
    'siren',
  ]);

  if (!sirenTimers.has(spaceId)) {
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
  }

  const maxDurationMs = getMaxSirenDuration(sirens.rows);
  scheduleSirenStop(spaceId, hubId, maxDurationMs);
};

const startPendingArm = async (spaceId, hubId, delaySeconds, who, logMessage) => {
  if (!hubId || pendingArmTimers.has(spaceId)) return;
  await startBlinkingLights(spaceId, hubId, 'exit-delay');
  const timer = setTimeout(async () => {
    pendingArmTimers.delete(spaceId);
    await stopBlinkingLights(spaceId, hubId, 'exit-delay');
    const zones = await query('SELECT status, config FROM devices WHERE space_id = $1 AND type = $2', [
      spaceId,
      'zone',
    ]);
    const hasViolations = zones.rows.some((zone) => {
      const zoneType = zone.config?.zoneType;
      if (zoneType !== 'delayed' && zoneType !== 'pass') return false;
      return zone.status !== 'Норма';
    });
    if (hasViolations) {
      await appendLog(spaceId, 'Неудачная попытка постановки под охрану', 'Zone', 'security');
      await applyLightOutputs(spaceId, hubId, 'disarmed');
      return;
    }
    await updateStatus(spaceId, 'armed', who, logMessage);
  }, delaySeconds * 1000);
  pendingArmTimers.set(spaceId, timer);
};

const startEntryDelay = async (spaceId, hubId, delaySeconds, zoneName) => {
  if (!hubId || entryDelayTimers.has(spaceId) || entryDelayFailed.get(spaceId)) return;
  await appendLog(spaceId, 'Начало снятия', 'Zone', 'security');
  await startBlinkingLights(spaceId, hubId, 'entry-delay');
  const timer = setTimeout(async () => {
    entryDelayTimers.delete(spaceId);
    await stopBlinkingLights(spaceId, hubId, 'entry-delay');
    const spaceRow = await query('SELECT status, hub_id FROM spaces WHERE id = $1', [spaceId]);
    const status = spaceRow.rows[0]?.status ?? 'disarmed';
    if (status === 'armed') {
      entryDelayFailed.set(spaceId, true);
      await appendLog(
        spaceId,
        'Неудачное снятие с охраны, выслать группу реагирования!',
        'Zone',
        'alarm',
      );
      if (zoneName) {
        await appendLog(spaceId, `Тревога шлейфа: ${zoneName}`, 'Zone', 'alarm');
      }
      spaceAlarmState.set(spaceId, true);
      await startSirenTimers(spaceId, spaceRow.rows[0]?.hub_id);
      await query('UPDATE spaces SET issues = true WHERE id = $1', [spaceId]);
    }
  }, delaySeconds * 1000);
  entryDelayTimers.set(spaceId, { timer, zoneName });
};

const handleExpiredReaderSessions = async () => {
  const expired = await query(
    `SELECT id, space_id, action, key_name, reader_name
     FROM reader_sessions
     WHERE expires_at < NOW()`,
  );
  if (!expired.rows.length) return;

  for (const session of expired.rows) {
    const message = session.action === 'arm'
      ? `Неудачная постановка (нет подтверждения от хаба): ${session.key_name}`
      : `Неудачное снятие (нет подтверждения от хаба): ${session.key_name}`;
    await appendLog(session.space_id, message, session.reader_name, 'security');
  }
  await query('DELETE FROM reader_sessions WHERE expires_at < NOW()');
};

setInterval(() => {
  handleExpiredReaderSessions().catch(() => null);
}, 1000);

app.post('/api/auth/register', async (req, res) => {
  const { email, password, role, nickname, language, timezone } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: 'missing_credentials' });
    return;
  }
  const resolvedRole = role === 'installer' ? 'installer' : 'user';
  const passwordHash = formatPasswordHash(String(password));
  try {
    const result = await query(
      `INSERT INTO users (email, password_hash, role, minecraft_nickname, language, timezone)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, email, role, minecraft_nickname, language, timezone`,
      [
        String(email).toLowerCase(),
        passwordHash,
        resolvedRole,
        nickname ?? null,
        language ?? 'ru',
        timezone ?? 'UTC',
      ],
    );
    const session = await issueSession(result.rows[0].id);
    res.json({ token: session.token, user: result.rows[0] });
  } catch (error) {
    res.status(400).json({ error: 'user_exists' });
  }
});

app.get('/api/auth/discord/start', async (req, res) => {
  if (!discordClientId || !discordClientSecret || !discordRedirectUri) {
    res.status(500).json({ error: 'discord_not_configured' });
    return;
  }
  const mode = req.query.mode === 'register' ? 'register' : 'login';
  res.redirect(buildDiscordAuthUrl(mode));
});

app.get('/api/auth/discord/callback', async (req, res) => {
  if (!discordClientId || !discordClientSecret || !discordRedirectUri) {
    res.status(500).json({ error: 'discord_not_configured' });
    return;
  }
  const code = req.query.code;
  const rawState = req.query.state ? Buffer.from(String(req.query.state), 'base64').toString('utf8') : '{}';
  let mode = 'login';
  try {
    const parsed = JSON.parse(rawState);
    mode = parsed.mode === 'register' ? 'register' : 'login';
  } catch {
    mode = 'login';
  }
  if (!code) {
    res.redirect('/login.html?error=discord');
    return;
  }
  try {
    const tokenPayload = await exchangeDiscordCode(String(code));
    const discordUser = await fetchDiscordUser(tokenPayload.token_type, tokenPayload.access_token);
    const discordId = String(discordUser.id);
    const userResult = await query('SELECT * FROM users WHERE discord_id = $1', [discordId]);
    if (!userResult.rows.length && mode === 'login') {
      res.redirect('/login.html?error=discord-not-linked');
      return;
    }
    let user = userResult.rows[0];
    if (!user) {
      const insert = await query(
        `INSERT INTO users (email, password_hash, role, minecraft_nickname, discord_id, language, timezone)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, email, role, minecraft_nickname, language, timezone`,
        [
          `discord:${discordId}`,
          formatPasswordHash(crypto.randomUUID()),
          'user',
          null,
          discordId,
          'ru',
          'UTC',
        ],
      );
      user = insert.rows[0];
    }
    const session = await issueSession(user.id);
    const params = new URLSearchParams({ token: session.token, role: user.role });
    res.redirect(`/login.html?${params.toString()}`);
  } catch (error) {
    res.redirect('/login.html?error=discord');
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: 'missing_credentials' });
    return;
  }
  const result = await query('SELECT * FROM users WHERE email = $1', [String(email).toLowerCase()]);
  const user = result.rows[0];
  if (!user || !verifyPassword(String(password), user.password_hash)) {
    res.status(401).json({ error: 'invalid_credentials' });
    return;
  }
  const session = await issueSession(user.id);
  res.json({
    token: session.token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      minecraft_nickname: user.minecraft_nickname,
      language: user.language,
      timezone: user.timezone,
    },
  });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

app.patch('/api/auth/me', requireAuth, async (req, res) => {
  const { minecraft_nickname, language, timezone } = req.body ?? {};
  const updated = await query(
    `UPDATE users
     SET minecraft_nickname = $1,
         language = $2,
         timezone = $3
     WHERE id = $4
     RETURNING id, email, role, minecraft_nickname, language, timezone`,
    [
      minecraft_nickname ?? req.user.minecraft_nickname,
      language ?? req.user.language,
      timezone ?? req.user.timezone,
      req.user.id,
    ],
  );
  res.json({ user: updated.rows[0] });
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  const token = getAuthToken(req);
  if (token) {
    await query('DELETE FROM sessions WHERE token = $1', [token]);
  }
  res.json({ ok: true });
});

app.get('/api/spaces', requireAuth, async (req, res) => {
  const result = await query(
    `SELECT spaces.* FROM spaces
     JOIN user_spaces ON user_spaces.space_id = spaces.id
     WHERE user_spaces.user_id = $1
     ORDER BY spaces.id`,
    [req.user.id],
  );
  const spaces = await Promise.all(
    result.rows.map(async (row) => ({
      ...mapSpace(row),
      devices: await loadDevices(row.id, row.hub_id, row.hub_online),
    })),
  );
  res.json(spaces);
});

app.get('/api/spaces/:id', requireAuth, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const result = await query('SELECT * FROM spaces WHERE id = $1', [req.params.id]);
  if (!result.rows.length) {
    return res.status(404).json({ error: 'space_not_found' });
  }
  const space = mapSpace(result.rows[0]);
  space.devices = await loadDevices(space.id, space.hubId, space.hubOnline);
  res.json(space);
});

app.get('/api/spaces/:id/last-key-scan', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const entry = lastKeyScans.get(req.params.id);
  if (!entry || Date.now() - entry.ts > 60000) {
    return res.status(404).json({ error: 'no_recent_scan' });
  }
  res.json({ readerId: entry.readerId, keyName: entry.keyName });
});

app.get('/api/spaces/:id/await-key-scan', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const spaceId = req.params.id;
  const waiters = keyScanWaiters.get(spaceId) ?? [];
  const timeout = setTimeout(() => {
    const updated = (keyScanWaiters.get(spaceId) ?? []).filter((waiter) => waiter.timeout !== timeout);
    if (updated.length) {
      keyScanWaiters.set(spaceId, updated);
    } else {
      keyScanWaiters.delete(spaceId);
    }
    res.status(404).json({ error: 'no_recent_scan' });
  }, 60000);

  waiters.push({
    timeout,
    resolve: (payload) => {
      res.json(payload);
    },
  });
  keyScanWaiters.set(spaceId, waiters);
});

app.get('/api/spaces/:id/logs', requireAuth, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const result = await query(
    `SELECT time,
            text,
            who,
            type,
            created_at
     FROM logs
     WHERE space_id = $1
     ORDER BY id DESC
     LIMIT 200`,
    [req.params.id],
  );
  res.json(result.rows.map(mapLog));
});

app.get('/api/logs', requireAuth, async (req, res) => {
  const result = await query(
    `SELECT logs.time,
            logs.text,
            logs.who,
            logs.type,
            logs.created_at,
            spaces.name AS space_name,
            spaces.id AS space_id
     FROM logs
     JOIN spaces ON spaces.id = logs.space_id
     JOIN user_spaces ON user_spaces.space_id = spaces.id
     WHERE user_spaces.user_id = $1
     ORDER BY logs.id DESC
     LIMIT 300`,
    [req.user.id],
  );
  res.json(result.rows.map((row) => {
    const createdAt = row.created_at;
    const createdAtMs = createdAt ? new Date(createdAt).getTime() : null;
    return {
      time: row.time,
      text: row.text,
      who: row.who,
      type: row.type,
      createdAt,
      createdAtMs,
      spaceName: row.space_name,
      spaceId: row.space_id,
    };
  }));
});

app.post('/api/spaces', requireAuth, requireInstaller, async (req, res) => {
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
  await query('INSERT INTO user_spaces (user_id, space_id) VALUES ($1,$2)', [req.user.id, generatedId]);
  const space = await query('SELECT * FROM spaces WHERE id = $1', [generatedId]);
  const result = mapSpace(space.rows[0]);
  result.devices = await loadDevices(result.id, result.hubId, result.hubOnline);
  res.status(201).json(result);
});

app.patch('/api/spaces/:id', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  if (!await ensureSpaceDisarmed(req.params.id, res)) return;
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

app.post('/api/spaces/:id/contacts', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  if (!await ensureSpaceDisarmed(req.params.id, res)) return;
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

app.post('/api/spaces/:id/notes', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  if (!await ensureSpaceDisarmed(req.params.id, res)) return;
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

app.post('/api/spaces/:id/photos', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  if (!await ensureSpaceDisarmed(req.params.id, res)) return;
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

app.get('/api/spaces/:id/members', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const members = await query(
    `SELECT users.id, users.email, users.role, users.minecraft_nickname, users.discord_id
     FROM user_spaces
     JOIN users ON users.id = user_spaces.user_id
     WHERE user_spaces.space_id = $1
     ORDER BY users.role, users.id`,
    [req.params.id],
  );
  res.json(members.rows);
});

app.post('/api/spaces/:id/members', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const { email, role } = req.body ?? {};
  if (!email) {
    res.status(400).json({ error: 'missing_email' });
    return;
  }
  const userResult = await query('SELECT id, role FROM users WHERE email = $1', [String(email).toLowerCase()]);
  if (!userResult.rows.length) {
    res.status(404).json({ error: 'user_not_found' });
    return;
  }
  const target = userResult.rows[0];
  const desiredRole = role === 'installer' ? 'installer' : 'user';
  if (target.role !== desiredRole) {
    await query('UPDATE users SET role = $1 WHERE id = $2', [desiredRole, target.id]);
  }
  await query(
    'INSERT INTO user_spaces (user_id, space_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [target.id, req.params.id],
  );
  res.json({ ok: true });
});

app.delete('/api/spaces/:id/members/:userId', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: 'invalid_user' });
    return;
  }
  const targetResult = await query('SELECT id, role FROM users WHERE id = $1', [userId]);
  if (!targetResult.rows.length) {
    res.status(404).json({ error: 'user_not_found' });
    return;
  }
  const targetRole = targetResult.rows[0].role;
  if (targetRole === 'installer') {
    const installers = await query(
      `SELECT COUNT(*)::int AS count
       FROM user_spaces
       JOIN users ON users.id = user_spaces.user_id
       WHERE user_spaces.space_id = $1 AND users.role = 'installer'`,
      [req.params.id],
    );
    if (installers.rows[0].count <= 1) {
      res.status(409).json({ error: 'last_installer' });
      return;
    }
  }
  await query('DELETE FROM user_spaces WHERE user_id = $1 AND space_id = $2', [userId, req.params.id]);
  res.json({ ok: true });
});

app.post('/api/spaces/:id/attach-hub', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  if (!await ensureSpaceDisarmed(req.params.id, res)) return;
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

app.delete('/api/spaces/:id/hub', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  if (!await ensureSpaceDisarmed(req.params.id, res)) return;
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
    return {
      level: Number(payload.outputLevel ?? 15),
      intervalMs: Number(payload.intervalMs ?? 1000),
      alarmDuration: payload.alarmDuration ? Number(payload.alarmDuration) : null,
    };
  }
  if (payload.type === 'reader') {
    return {
      outputLevel: Number(payload.outputLevel ?? 6),
      inputSide: payload.side ?? 'up',
      inputLevel: Number(payload.inputLevel ?? 6),
    };
  }
  if (payload.type === 'zone') {
    return {
      zoneType: payload.zoneType ?? 'instant',
      bypass: payload.bypass === 'true',
      silent: payload.silent === 'true',
      delaySeconds: payload.delaySeconds ? Number(payload.delaySeconds) : null,
      normalLevel: Number(payload.normalLevel ?? 15),
    };
  }
  return {};
};

app.post('/api/spaces/:id/devices', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  if (!await ensureSpaceDisarmed(req.params.id, res)) return;
  const { id, name, room, status, type, side } = req.body ?? {};
  if (!name || !room || !type) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const generatedId = id ?? `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await query(
    'INSERT INTO devices (id, space_id, name, room, status, type, side, config) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      generatedId,
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

app.post('/api/spaces/:id/keys', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  if (!await ensureSpaceDisarmed(req.params.id, res)) return;
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

app.delete('/api/spaces/:id', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  if (!await ensureSpaceDisarmed(req.params.id, res)) return;
  const existing = await query('SELECT id FROM spaces WHERE id = $1', [req.params.id]);
  if (!existing.rows.length) return res.status(404).json({ error: 'space_not_found' });

  await stopSirenTimers(req.params.id);
  await query('DELETE FROM hubs WHERE space_id = $1', [req.params.id]);
  await query('DELETE FROM spaces WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/spaces/:id/devices/:deviceId', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  if (!await ensureSpaceDisarmed(req.params.id, res)) return;
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

app.delete('/api/spaces/:id/keys/:keyId', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  if (!await ensureSpaceDisarmed(req.params.id, res)) return;
  const { id, keyId } = req.params;
  const existing = await query('SELECT id FROM keys WHERE id = $1 AND space_id = $2', [keyId, id]);
  if (!existing.rows.length) return res.status(404).json({ error: 'key_not_found' });

  await query('DELETE FROM keys WHERE id = $1 AND space_id = $2', [keyId, id]);
  await appendLog(id, `Удалён ключ: ${keyId}`, 'UI', 'system');
  res.json({ ok: true });
});

app.patch('/api/spaces/:id/devices/:deviceId', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  if (!await ensureSpaceDisarmed(req.params.id, res)) return;
  const { id, deviceId } = req.params;
  const existing = await query('SELECT * FROM devices WHERE id = $1 AND space_id = $2', [deviceId, id]);
  if (!existing.rows.length) return res.status(404).json({ error: 'device_not_found' });

  const device = existing.rows[0];
  const name = req.body?.name ?? device.name;
  const room = req.body?.room ?? device.room;
  const side = req.body?.side ?? device.side;
  const config = deviceConfigFromPayload({ ...req.body, type: device.type });

  await query(
    'UPDATE devices SET name = $1, room = $2, side = $3, config = $4 WHERE id = $5 AND space_id = $6',
    [name, room, side, JSON.stringify({ ...device.config, ...config }), deviceId, id],
  );

  await appendLog(id, `Обновлено устройство: ${deviceId}`, 'UI', 'system');
  res.json({ ok: true });
});

app.patch('/api/spaces/:id/keys/:keyId', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  if (!await ensureSpaceDisarmed(req.params.id, res)) return;
  const { id, keyId } = req.params;
  const existing = await query('SELECT * FROM keys WHERE id = $1 AND space_id = $2', [keyId, id]);
  if (!existing.rows.length) return res.status(404).json({ error: 'key_not_found' });

  const name = req.body?.name ?? existing.rows[0].name;
  const readerId = req.body?.readerId ?? existing.rows[0].reader_id;
  await query('UPDATE keys SET name = $1, reader_id = $2 WHERE id = $3 AND space_id = $4', [
    name,
    readerId,
    keyId,
    id,
  ]);

  await appendLog(id, `Обновлён ключ: ${keyId}`, 'UI', 'system');
  res.json({ ok: true });
});

app.delete('/api/spaces/:id/contacts/:index', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  if (!await ensureSpaceDisarmed(req.params.id, res)) return;
  const index = Number(req.params.index);
  const result = await query('SELECT contacts FROM spaces WHERE id = $1', [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'space_not_found' });

  const contacts = result.rows[0].contacts ?? [];
  if (!Number.isInteger(index) || index < 0 || index >= contacts.length) {
    return res.status(400).json({ error: 'invalid_index' });
  }
  const removed = contacts.splice(index, 1);
  await query('UPDATE spaces SET contacts = $1 WHERE id = $2', [JSON.stringify(contacts), req.params.id]);
  await appendLog(req.params.id, `Удалено контактное лицо: ${removed[0]?.name ?? '—'}`, 'UI', 'system');
  res.json({ ok: true });
});

app.patch('/api/spaces/:id/contacts/:index', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  if (!await ensureSpaceDisarmed(req.params.id, res)) return;
  const index = Number(req.params.index);
  const result = await query('SELECT contacts FROM spaces WHERE id = $1', [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'space_not_found' });

  const contacts = result.rows[0].contacts ?? [];
  if (!Number.isInteger(index) || index < 0 || index >= contacts.length) {
    return res.status(400).json({ error: 'invalid_index' });
  }
  const current = contacts[index];
  contacts[index] = {
    name: req.body?.name ?? current.name,
    role: req.body?.role ?? current.role,
    phone: req.body?.phone ?? current.phone,
  };
  await query('UPDATE spaces SET contacts = $1 WHERE id = $2', [JSON.stringify(contacts), req.params.id]);
  await appendLog(req.params.id, `Обновлено контактное лицо: ${contacts[index].name}`, 'UI', 'system');
  res.json({ ok: true });
});

app.delete('/api/spaces/:id/notes/:index', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  if (!await ensureSpaceDisarmed(req.params.id, res)) return;
  const index = Number(req.params.index);
  const result = await query('SELECT notes FROM spaces WHERE id = $1', [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'space_not_found' });

  const notes = result.rows[0].notes ?? [];
  if (!Number.isInteger(index) || index < 0 || index >= notes.length) {
    return res.status(400).json({ error: 'invalid_index' });
  }
  const removed = notes.splice(index, 1);
  await query('UPDATE spaces SET notes = $1 WHERE id = $2', [JSON.stringify(notes), req.params.id]);
  await appendLog(req.params.id, `Удалено примечание: ${removed[0] ?? '—'}`, 'UI', 'system');
  res.json({ ok: true });
});

app.patch('/api/spaces/:id/notes/:index', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  if (!await ensureSpaceDisarmed(req.params.id, res)) return;
  const index = Number(req.params.index);
  const result = await query('SELECT notes FROM spaces WHERE id = $1', [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'space_not_found' });

  const notes = result.rows[0].notes ?? [];
  if (!Number.isInteger(index) || index < 0 || index >= notes.length) {
    return res.status(400).json({ error: 'invalid_index' });
  }
  notes[index] = req.body?.text ?? notes[index];
  await query('UPDATE spaces SET notes = $1 WHERE id = $2', [JSON.stringify(notes), req.params.id]);
  await appendLog(req.params.id, 'Обновлено примечание', 'UI', 'system');
  res.json({ ok: true });
});

app.delete('/api/spaces/:id/photos/:index', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  if (!await ensureSpaceDisarmed(req.params.id, res)) return;
  const index = Number(req.params.index);
  const result = await query('SELECT photos FROM spaces WHERE id = $1', [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'space_not_found' });

  const photos = result.rows[0].photos ?? [];
  if (!Number.isInteger(index) || index < 0 || index >= photos.length) {
    return res.status(400).json({ error: 'invalid_index' });
  }
  const removed = photos.splice(index, 1);
  await query('UPDATE spaces SET photos = $1 WHERE id = $2', [JSON.stringify(photos), req.params.id]);
  await appendLog(req.params.id, `Удалено фото: ${removed[0]?.label ?? 'Фото'}`, 'UI', 'system');
  res.json({ ok: true });
});

app.patch('/api/spaces/:id/photos/:index', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  if (!await ensureSpaceDisarmed(req.params.id, res)) return;
  const index = Number(req.params.index);
  const result = await query('SELECT photos FROM spaces WHERE id = $1', [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'space_not_found' });

  const photos = result.rows[0].photos ?? [];
  if (!Number.isInteger(index) || index < 0 || index >= photos.length) {
    return res.status(400).json({ error: 'invalid_index' });
  }
  const current = photos[index];
  photos[index] = {
    url: req.body?.url ?? current.url,
    label: req.body?.label ?? current.label,
  };
  await query('UPDATE spaces SET photos = $1 WHERE id = $2', [JSON.stringify(photos), req.params.id]);
  await appendLog(req.params.id, 'Обновлено фото', 'UI', 'system');
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

const updateStatus = async (spaceId, status, who, logMessage) => {
  const updated = await query('UPDATE spaces SET status = $1 WHERE id = $2 RETURNING *', [status, spaceId]);
  if (!updated.rows.length) return null;
  const defaultMessage = status === 'armed' ? 'Объект поставлен под охрану' : 'Объект снят с охраны';
  await appendLog(spaceId, logMessage ?? defaultMessage, who, 'security');
  const space = mapSpace(updated.rows[0]);
  await applyLightOutputs(spaceId, space.hubId, status);
  if (status !== 'armed') {
    await stopSirenTimers(spaceId, space.hubId);
    spaceAlarmState.set(spaceId, false);
    await clearEntryDelay(spaceId, space.hubId);
    await clearPendingArm(spaceId, space.hubId);
    entryDelayFailed.delete(spaceId);
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
  const scannedKeyName = payload?.keyName ?? 'Неизвестный ключ';
  lastKeyScans.set(spaceId, { readerId, keyName: scannedKeyName, ts: Date.now() });
  const waiters = keyScanWaiters.get(spaceId);
  if (waiters?.length) {
    waiters.forEach((waiter) => {
      clearTimeout(waiter.timeout);
      waiter.resolve({ readerId, keyName: scannedKeyName });
    });
    keyScanWaiters.delete(spaceId);
  }
  const spaceRow = await query('SELECT status FROM spaces WHERE id = $1', [spaceId]);
  const spaceStatus = spaceRow.rows[0]?.status ?? 'disarmed';
  const time = ts
    ? new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const keyName = scannedKeyName;

  await query(
    'INSERT INTO logs (space_id, time, text, who, type) VALUES ($1,$2,$3,$4,$5)',
    [spaceId, time, `Скан ключа: ${keyName}`, name ?? readerId, 'access'],
  );

  const key = await query(
    'SELECT name FROM keys WHERE space_id = $1 AND (reader_id IS NULL OR reader_id = $2)',
    [spaceId, readerId],
  );
  const hasKey = key.rows.some((row) => keyName.includes(row.name));
  if (!hasKey) {
    await appendLog(spaceId, `Неизвестный ключ: ${keyName}`, name ?? readerId, 'access');
    return { ok: true, ignored: true };
  }

  const action = spaceStatus === 'armed' ? 'disarm' : 'arm';
  if (action === 'arm') {
    const zones = await query('SELECT name, status, config FROM devices WHERE space_id = $1 AND type = $2', [
      spaceId,
      'zone',
    ]);
    const hasBypass = zones.rows.some((zone) => zone.config?.bypass);
    const hasViolations = zones.rows.some((zone) => zone.status !== 'Норма');
    if (hasBypass) {
      await appendLog(
        spaceId,
        `Неудачная постановка (обход зоны активен): ${keyName}`,
        name ?? readerId,
        'security',
      );
      return { ok: true, blocked: 'bypass' };
    }
    if (hasViolations) {
      await appendLog(
        spaceId,
        `Неудачная постановка (зоны не в норме): ${keyName}`,
        name ?? readerId,
        'security',
      );
      return { ok: true, blocked: 'zone_state' };
    }
  }

  const inputSide = config?.inputSide ?? 'up';
  const inputLevel = Number(config?.inputLevel ?? 6);
  const outputLevel = Number(config?.outputLevel ?? 6);
  await query(
    'INSERT INTO reader_sessions (reader_id, space_id, input_side, input_level, action, key_name, reader_name, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW() + INTERVAL \'1 second\')',
    [readerId, spaceId, inputSide, inputLevel, action, keyName, name ?? readerId],
  );

  await pulseReaderOutput(readerId, outputLevel, 250).catch(() => null);

  return {
    ok: true,
    output: {
      readerId,
      level: outputLevel,
    },
  };
};

app.post('/api/spaces/:id/arm', requireAuth, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const updated = await updateStatus(req.params.id, 'armed', req.user.minecraft_nickname ?? 'UI');
  if (!updated) return res.status(404).json({ error: 'space_not_found' });
  res.json(updated);
});

app.post('/api/spaces/:id/disarm', requireAuth, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const space = await updateStatus(req.params.id, 'disarmed', req.user.minecraft_nickname ?? 'UI');
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

  const payloadText = formatHubPayload(payload);
  const hubLogText = `Событие хаба: ${type}\n${hubId}${payloadText ? `\n${payloadText}` : ''}`;
  await query(
    'INSERT INTO logs (space_id, time, text, who, type) VALUES ($1,$2,$3,$4,$5)',
    [spaceId, time, hubLogText, hubId, 'hub_raw'],
  );
  await trimHubLogs(hubId);

  if (type === 'TEST_FAIL') {
    await query('UPDATE spaces SET hub_online = $1 WHERE id = $2', [false, spaceId]);
  }

  if (type === 'TEST_OK' || type === 'HUB_PING' || type === 'PORT_IN' || type === 'HUB_ONLINE') {
    await query('UPDATE spaces SET hub_online = $1 WHERE id = $2', [true, spaceId]);
  }

  if (type === 'PORT_IN' && payload?.side && payload?.level !== undefined) {
    const sessions = await query(
      `SELECT id, input_side, input_level, action, key_name, reader_name
       FROM reader_sessions
       WHERE space_id = $1 AND expires_at >= NOW()
       ORDER BY id DESC
       LIMIT 1`,
      [spaceId],
    );
    if (sessions.rows.length) {
      const session = sessions.rows[0];
      if (session.input_side === payload.side && Number(session.input_level) === Number(payload.level)) {
        if (session.action === 'arm') {
          const zones = await query('SELECT name, status, config FROM devices WHERE space_id = $1 AND type = $2', [
            spaceId,
            'zone',
          ]);
          const hasBypass = zones.rows.some((zone) => zone.config?.bypass);
          const hasViolations = zones.rows.some((zone) => zone.status !== 'Норма');
          if (hasBypass) {
            await appendLog(
              spaceId,
              `Неудачная постановка (обход зоны активен): ${session.key_name}`,
              session.reader_name,
              'security',
            );
          } else if (hasViolations) {
            await appendLog(
              spaceId,
              `Неудачная постановка (зоны не в норме): ${session.key_name}`,
              session.reader_name,
              'security',
            );
          } else {
            const delaySeconds = getExitDelaySeconds(zones.rows);
            if (delaySeconds > 0) {
              const spaceRow = await query('SELECT hub_id FROM spaces WHERE id = $1', [spaceId]);
              await startPendingArm(
                spaceId,
                spaceRow.rows[0]?.hub_id,
                delaySeconds,
                session.reader_name,
                `Постановка на охрану ключом: ${session.key_name}`,
              );
            } else {
              await updateStatus(
                spaceId,
                'armed',
                session.reader_name,
                `Постановка на охрану ключом: ${session.key_name}`,
              );
            }
          }
        } else {
          await updateStatus(
            spaceId,
            'disarmed',
            session.reader_name,
            `Снятие с охраны ключом: ${session.key_name}`,
          );
        }
        await query('DELETE FROM reader_sessions WHERE id = $1', [session.id]);
      }
    }

    const zones = await query(
      'SELECT id, name, status, config FROM devices WHERE space_id = $1 AND type = $2 AND side = $3',
      [spaceId, 'zone', payload.side],
    );

    for (const zone of zones.rows) {
      const config = zone.config ?? {};
      const normalLevel = Number(config.normalLevel ?? 15);
      const isNormal = Number(payload.level) === normalLevel;
      const currentStatus = zone.status ?? 'Норма';
      const newStatus = isNormal ? 'Норма' : 'Нарушение';
      await query('UPDATE devices SET status = $1 WHERE id = $2', [newStatus, zone.id]);

      const spaceRow = await query('SELECT status, hub_id FROM spaces WHERE id = $1', [spaceId]);
      const status = spaceRow.rows[0]?.status ?? 'disarmed';
      const zoneType = config.zoneType ?? 'instant';
      const bypass = Boolean(config.bypass);
      const silent = Boolean(config.silent);
      const shouldCheck = zoneType === '24h' || status === 'armed';

      if (shouldCheck && !bypass && !isNormal) {
        if (entryDelayFailed.get(spaceId)) {
          await appendLog(spaceId, `Тревога шлейфа: ${zone.name}`, 'Zone', 'alarm');
          spaceAlarmState.set(spaceId, true);
          if (!silent) {
            await startSirenTimers(spaceId, spaceRow.rows[0]?.hub_id);
          }
          await query('UPDATE spaces SET issues = true WHERE id = $1', [spaceId]);
          continue;
        }
        if (zoneType === 'delayed' && status === 'armed' && !entryDelayTimers.has(spaceId)) {
          const delaySeconds = Number(config.delaySeconds ?? 30);
          await startEntryDelay(spaceId, spaceRow.rows[0]?.hub_id, delaySeconds, zone.name);
          continue;
        }
        if (zoneType === 'pass' && entryDelayTimers.has(spaceId)) {
          continue;
        }
        await appendLog(spaceId, `Тревога шлейфа: ${zone.name}`, 'Zone', 'alarm');
        spaceAlarmState.set(spaceId, true);
        if (!silent) {
          await startSirenTimers(spaceId, spaceRow.rows[0]?.hub_id);
        }
        await query('UPDATE spaces SET issues = true WHERE id = $1', [spaceId]);
      }

      if (isNormal && currentStatus === 'Нарушение') {
        await appendLog(spaceId, `Восстановление шлейфа: ${zone.name}`, 'Zone', 'restore');
      }
    }

    const hasIssues = await evaluateZoneIssues(spaceId);
    if (!hasIssues) {
      const spaceRow = await query('SELECT hub_id FROM spaces WHERE id = $1', [spaceId]);
      spaceAlarmState.set(spaceId, false);
      const sirens = await query('SELECT config FROM devices WHERE space_id = $1 AND type = $2', [spaceId, 'siren']);
      const maxDurationMs = getMaxSirenDuration(sirens.rows);
      if (!maxDurationMs) {
        await stopSirenTimers(spaceId, spaceRow.rows[0]?.hub_id);
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
  const result = await handleReaderScan({ readerId, payload, ts });
  res.json(result);
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
