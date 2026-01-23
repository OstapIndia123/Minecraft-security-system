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
const launcherApiUrl = process.env.LAUNCHER_API_URL;
const port = Number(process.env.PORT ?? 8080);

const MAX_NICKNAME_LENGTH = 16;
const NICKNAME_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
const MIN_INTERVAL_MS = 300;
const MAX_SIREN_DURATION_SEC = 120;
const MAX_DELAY_SECONDS = 120;
const MAX_NOTE_LENGTH = 100;
const MAX_SPACE_NAME_LENGTH = 16;
const MAX_ADDRESS_LENGTH = 120;
const MAX_SERVER_NAME_LENGTH = 16;
const MAX_CITY_LENGTH = 60;
const MAX_CONTACT_NAME_LENGTH = 40;
const MAX_CONTACT_ROLE_LENGTH = 40;
const MAX_CONTACT_PHONE_LENGTH = 40;
const MAX_DEVICE_NAME_LENGTH = 60;
const MAX_DEVICE_ROOM_LENGTH = 60;
const MAX_DEVICE_ID_LENGTH = 80;
const MAX_KEY_NAME_LENGTH = 60;
const MAX_PHOTO_LABEL_LENGTH = 60;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
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

const normalizeText = (value) => (value ?? '').toString().trim();

const isOverMaxLength = (value, maxLength) => {
  if (!value) return false;
  return value.length > maxLength;
};

const clampNumber = (value, min, max, fallback) => {
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return Math.min(max, Math.max(min, num));
};

const clampDelaySeconds = (value) => {
  if (value === null || value === undefined || value === '') return null;
  return clampNumber(value, 0, MAX_DELAY_SECONDS, 0);
};

const clampSirenDuration = (value) => {
  if (value === null || value === undefined || value === '') return null;
  return clampNumber(value, 0, MAX_SIREN_DURATION_SEC, 0);
};

const canChangeNickname = (lastChangedAt) => {
  if (!lastChangedAt) return { allowed: true, retryAfterMs: 0 };
  const lastTs = new Date(lastChangedAt).getTime();
  if (Number.isNaN(lastTs)) return { allowed: true, retryAfterMs: 0 };
  const elapsed = Date.now() - lastTs;
  if (elapsed >= NICKNAME_COOLDOWN_MS) return { allowed: true, retryAfterMs: 0 };
  return { allowed: false, retryAfterMs: NICKNAME_COOLDOWN_MS - elapsed };
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
    `SELECT users.id, users.email, users.role, users.minecraft_nickname, users.discord_id, users.discord_avatar_url,
            users.language, users.timezone, users.last_nickname_change_at
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
  const isProMode = req.header('x-app-mode') === 'pro';
  if (req.user?.role !== 'installer' && !isProMode) {
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

const ensureSpaceRole = async (userId, spaceId, role) => {
  const result = await query(
    'SELECT 1 FROM user_spaces WHERE user_id = $1 AND space_id = $2 AND role = $3',
    [userId, spaceId, role],
  );
  return result.rows.length > 0;
};

const ensureNicknameAvailable = async (nickname, userId) => {
  if (!nickname) return true;
  const result = await query(
    `SELECT id FROM users
     WHERE lower(minecraft_nickname) = lower($1) AND id <> $2`,
    [nickname, userId ?? 0],
  );
  return result.rows.length === 0;
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

const buildDiscordAvatarUrl = (discordUser) => {
  if (!discordUser?.id) return null;
  if (discordUser.avatar) {
    const extension = discordUser.avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.${extension}?size=128`;
  }
  const fallbackIndex = Number(BigInt(discordUser.id) % 5n);
  return `https://cdn.discordapp.com/embed/avatars/${fallbackIndex}.png`;
};

const mapSpace = (row) => ({
  id: row.id,
  hubId: row.hub_id,
  name: row.name,
  address: row.address,
  server: row.server,
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
  const createdAtMs = createdAt ? Date.parse(`${createdAt}Z`) : null;
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
  const hubStatus = hubId
    ? (hubOnline === null ? '— —' : (hubOnline ? 'В сети' : 'Не в сети'))
    : 'Не привязан';
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

const pulseReaderOutput = async (readerId, level, durationMs = MIN_INTERVAL_MS) => {
  const resolvedDuration = Math.max(durationMs, MIN_INTERVAL_MS);
  await sendReaderOutput(readerId, level);
  setTimeout(() => {
    sendReaderOutput(readerId, 0).catch(() => null);
  }, resolvedDuration);
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
const pendingHubRegistrations = new Map();

const cleanupExpiredHubRegistrations = () => {
  const now = Date.now();
  for (const [spaceId, registration] of pendingHubRegistrations.entries()) {
    if (registration.expiresAt <= now) {
      pendingHubRegistrations.delete(spaceId);
    }
  }
};

const getPendingHubRegistration = (spaceId) => {
  cleanupExpiredHubRegistrations();
  return pendingHubRegistrations.get(spaceId) ?? null;
};

const startHubRegistration = (spaceId) => {
  cleanupExpiredHubRegistrations();
  if (pendingHubRegistrations.size && !pendingHubRegistrations.has(spaceId)) {
    return { error: 'hub_pending' };
  }
  const expiresAt = Date.now() + 60_000;
  const registration = { pending: true, spaceId, expiresAt };
  pendingHubRegistrations.set(spaceId, registration);
  return registration;
};

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

const registerPendingHub = async (hubId) => {
  cleanupExpiredHubRegistrations();
  const registration = pendingHubRegistrations.values().next().value;
  if (!registration) return false;
  const existing = await query('SELECT id FROM hubs WHERE id = $1', [hubId]);
  if (existing.rows.length) {
    pendingHubRegistrations.delete(registration.spaceId);
    return false;
  }
  const spaceRow = await query('SELECT hub_id FROM spaces WHERE id = $1', [registration.spaceId]);
  if (!spaceRow.rows.length) {
    pendingHubRegistrations.delete(registration.spaceId);
    return false;
  }
  if (spaceRow.rows[0].hub_id) {
    pendingHubRegistrations.delete(registration.spaceId);
    return false;
  }
  await query('INSERT INTO hubs (id, space_id) VALUES ($1,$2)', [hubId, registration.spaceId]);
  await query('UPDATE spaces SET hub_id = $1, hub_online = $2 WHERE id = $3', [hubId, true, registration.spaceId]);
  await appendLog(registration.spaceId, 'Хаб установлен и зарегистрирован', 'Hub', 'system');
  pendingHubRegistrations.delete(registration.spaceId);
  return true;
};

const getMaxSirenDuration = (sirens) => sirens.reduce((max, siren) => {
  const seconds = clampSirenDuration(siren.config?.alarmDuration ?? 0) ?? 0;
  const durationMs = seconds > 0 ? seconds * 1000 : 0;
  return Math.max(max, durationMs);
}, 0);

const getExitDelaySeconds = (zones) => zones.reduce((max, zone) => {
  const zoneType = zone.config?.zoneType;
  if (zoneType !== 'delayed') return max;
  const delaySeconds = clampDelaySeconds(zone.config?.delaySeconds ?? 30) ?? 0;
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
      const intervalMs = clampNumber(siren.config?.intervalMs ?? 1000, MIN_INTERVAL_MS, 60_000, 1000);
      const level = Number(siren.config?.level ?? 15);
      let on = false;
      const timer = setInterval(() => {
        on = !on;
        sendHubOutput(hubId, siren.side, on ? level : 0).catch(() => null);
      }, Math.max(intervalMs, MIN_INTERVAL_MS));
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
  const resolvedDelay = clampDelaySeconds(delaySeconds) ?? 0;
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
  }, resolvedDelay * 1000);
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
  res.status(410).json({ error: 'discord_only' });
});

app.get('/api/auth/discord/start', async (req, res) => {
  if (!discordClientId || !discordClientSecret || !discordRedirectUri) {
    res.status(500).json({ error: 'discord_not_configured' });
    return;
  }
  res.redirect(buildDiscordAuthUrl('login'));
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
    const discordAvatarUrl = buildDiscordAvatarUrl(discordUser);
    const userResult = await query('SELECT * FROM users WHERE discord_id = $1', [discordId]);
    if (!userResult.rows.length && mode === 'login') {
      mode = 'register';
    }
    let user = userResult.rows[0];
    if (!user) {
      const insert = await query(
        `INSERT INTO users (email, password_hash, role, minecraft_nickname, discord_id, discord_avatar_url, language, timezone, last_nickname_change_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, email, role, minecraft_nickname, language, timezone, discord_avatar_url, last_nickname_change_at`,
        [
          `discord:${discordId}`,
          formatPasswordHash(crypto.randomUUID()),
          'user',
          null,
          discordId,
          discordAvatarUrl,
          'ru',
          'UTC',
          null,
        ],
      );
      user = insert.rows[0];
    } else if (discordAvatarUrl && user.discord_avatar_url !== discordAvatarUrl) {
      const update = await query(
        'UPDATE users SET discord_avatar_url = $1 WHERE id = $2 RETURNING id, email, role, minecraft_nickname, language, timezone, discord_avatar_url',
        [discordAvatarUrl, user.id],
      );
      user = update.rows[0] ?? user;
    }
    const session = await issueSession(user.id);
    const params = new URLSearchParams({ token: session.token, role: user.role });
    res.redirect(`/login.html?${params.toString()}`);
  } catch (error) {
    res.redirect('/login.html?error=discord');
  }
});

app.post('/api/auth/login', async (req, res) => {
  res.status(410).json({ error: 'discord_only' });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

app.patch('/api/auth/me', requireAuth, async (req, res) => {
  const { minecraft_nickname, language, timezone } = req.body ?? {};
  const trimmedNickname = minecraft_nickname ? normalizeText(minecraft_nickname) : null;
  if (trimmedNickname) {
    if (isOverMaxLength(trimmedNickname, MAX_NICKNAME_LENGTH)) {
      res.status(400).json({ error: 'nickname_too_long' });
      return;
    }
    const nicknameChange = trimmedNickname !== req.user.minecraft_nickname;
    if (nicknameChange) {
      const cooldown = canChangeNickname(req.user.last_nickname_change_at);
      if (!cooldown.allowed) {
        res.status(429).json({ error: 'nickname_cooldown', retryAfterMs: cooldown.retryAfterMs });
        return;
      }
    }
    const available = await ensureNicknameAvailable(trimmedNickname, req.user.id);
    if (!available) {
      res.status(409).json({ error: 'nickname_taken' });
      return;
    }
  } else if (minecraft_nickname !== undefined) {
    res.status(400).json({ error: 'invalid_nickname' });
    return;
  }
  const nicknameChanged = trimmedNickname && trimmedNickname !== req.user.minecraft_nickname;
  const updated = await query(
    `UPDATE users
     SET minecraft_nickname = $1,
         language = $2,
         timezone = $3,
         last_nickname_change_at = $4
     WHERE id = $5
     RETURNING id, email, role, minecraft_nickname, language, timezone, discord_avatar_url, last_nickname_change_at`,
    [
      trimmedNickname ?? req.user.minecraft_nickname,
      language ?? req.user.language,
      timezone ?? req.user.timezone,
      nicknameChanged ? new Date() : req.user.last_nickname_change_at,
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

app.get('/api/auth/launcher', async (req, res) => {
  if (!launcherApiUrl) {
    res.status(500).json({ error: 'launcher_not_configured' });
    return;
  }
  const token = req.query.token;
  if (!token) {
    res.status(400).json({ error: 'missing_token' });
    return;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(
      `${launcherApiUrl.replace(/\/$/, '')}/Key/AccountData/${encodeURIComponent(String(token))}`,
      { signal: controller.signal },
    );
    clearTimeout(timeout);
    if (!response.ok) {
      res.status(502).json({ error: 'launcher_fetch_failed' });
      return;
    }
    const payload = await response.json();
    const minecraft = payload?.minecraft ?? {};
    const discord = payload?.discord ?? {};
    const nickname = normalizeText(minecraft.nickname);
    if (!nickname) {
      res.status(400).json({ error: 'nickname_missing' });
      return;
    }
    if (isOverMaxLength(nickname, MAX_NICKNAME_LENGTH)) {
      res.status(400).json({ error: 'nickname_too_long' });
      return;
    }
    const discordId = discord.id ? String(discord.id) : null;
    const discordAvatarUrl = discord.avatar?.url ?? null;

    let user = null;
    if (discordId) {
      const byDiscord = await query('SELECT * FROM users WHERE discord_id = $1', [discordId]);
      user = byDiscord.rows[0] ?? null;
    }
    if (!user) {
      const byNickname = await query(
        'SELECT * FROM users WHERE lower(minecraft_nickname) = lower($1)',
        [nickname],
      );
      user = byNickname.rows[0] ?? null;
    }

    if (user) {
      const available = await ensureNicknameAvailable(nickname, user.id);
      if (!available) {
        res.status(409).json({ error: 'nickname_taken' });
        return;
      }
      const nicknameChange = nickname !== user.minecraft_nickname;
      if (nicknameChange) {
        const cooldown = canChangeNickname(user.last_nickname_change_at);
        if (!cooldown.allowed) {
          res.status(429).json({ error: 'nickname_cooldown', retryAfterMs: cooldown.retryAfterMs });
          return;
        }
      }
      const updated = await query(
        `UPDATE users
         SET minecraft_nickname = $1,
             discord_id = COALESCE($2, discord_id),
             discord_avatar_url = COALESCE($3, discord_avatar_url),
             last_nickname_change_at = $4
         WHERE id = $5
         RETURNING id, email, role, minecraft_nickname, language, timezone, discord_avatar_url, last_nickname_change_at`,
        [nickname, discordId, discordAvatarUrl, nicknameChange ? new Date() : user.last_nickname_change_at, user.id],
      );
      user = updated.rows[0];
    } else {
      const email = `launcher:${minecraft.uuid ?? token}`;
      const insert = await query(
        `INSERT INTO users (email, password_hash, role, minecraft_nickname, discord_id, discord_avatar_url, language, timezone, last_nickname_change_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, email, role, minecraft_nickname, language, timezone, discord_avatar_url, last_nickname_change_at`,
        [
          email,
          formatPasswordHash(crypto.randomUUID()),
          'user',
          nickname,
          discordId,
          discordAvatarUrl,
          'ru',
          'UTC',
          new Date(),
        ],
      );
      user = insert.rows[0];
    }

    const session = await issueSession(user.id);
    res.json({ token: session.token, role: user.role, user });
  } catch (error) {
    res.status(502).json({ error: 'launcher_fetch_failed' });
  }
});

app.get('/api/spaces', requireAuth, async (req, res) => {
  const appMode = req.header('x-app-mode');
  const roleFilter = appMode === 'pro' ? 'installer' : 'user';
  const result = await query(
    `SELECT spaces.* FROM spaces
     JOIN user_spaces ON user_spaces.space_id = spaces.id
     WHERE user_spaces.user_id = $1 AND user_spaces.role = $2
     ORDER BY spaces.id`,
    [req.user.id, roleFilter],
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
  const appMode = req.header('x-app-mode');
  const roleFilter = appMode === 'pro' ? 'installer' : 'user';
  const allowed = await ensureSpaceRole(req.user.id, req.params.id, roleFilter);
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
  const appMode = req.header('x-app-mode');
  const roleFilter = appMode === 'pro' ? 'installer' : 'user';
  const allowed = await ensureSpaceRole(req.user.id, req.params.id, roleFilter);
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
  const appMode = req.header('x-app-mode');
  const roleFilter = appMode === 'pro' ? 'installer' : 'user';
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
     WHERE user_spaces.user_id = $1 AND user_spaces.role = $2
     ORDER BY logs.id DESC
     LIMIT 300`,
    [req.user.id, roleFilter],
  );
  res.json(result.rows.map((row) => {
    const createdAt = row.created_at;
    const createdAtMs = createdAt ? Date.parse(`${createdAt}Z`) : null;
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
  const { name, address, server, city, timezone } = req.body ?? {};
  const normalizedName = normalizeText(name);
  const normalizedAddress = normalizeText(address) || '—';
  const normalizedServer = normalizeText(server) || '—';
  const normalizedCity = normalizeText(city) || '—';
  if (!normalizedName) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (isOverMaxLength(normalizedName, MAX_SPACE_NAME_LENGTH)
    || isOverMaxLength(normalizedAddress, MAX_ADDRESS_LENGTH)
    || isOverMaxLength(normalizedServer, MAX_SERVER_NAME_LENGTH)
    || isOverMaxLength(normalizedCity, MAX_CITY_LENGTH)) {
    return res.status(400).json({ error: 'field_too_long' });
  }

  cleanupExpiredHubRegistrations();
  if (pendingHubRegistrations.size) {
    return res.status(409).json({ error: 'hub_pending' });
  }

  const generatedId = `SPACE-${Date.now()}`;
  const company = { name: 'Не указано', country: '—', pcs: '—', site: '—', email: '—' };
  const contacts = [];
  const notes = [];
  const photos = [];

  await query(
    `INSERT INTO spaces (id, hub_id, name, address, status, hub_online, issues, server, city, timezone, company, contacts, notes, photos)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      generatedId,
      null,
      normalizedName,
      normalizedAddress,
      'disarmed',
      null,
      false,
      normalizedServer,
      normalizedCity,
      timezone ?? 'Europe/Kyiv',
      JSON.stringify(company),
      JSON.stringify(contacts),
      JSON.stringify(notes),
      JSON.stringify(photos),
    ],
  );

  await appendLog(generatedId, 'Создано пространство', 'UI', 'system');
  await appendLog(generatedId, 'Ожидание установки хаба', 'UI', 'system');
  await query('INSERT INTO user_spaces (user_id, space_id, role) VALUES ($1,$2,$3)', [req.user.id, generatedId, 'installer']);
  const space = await query('SELECT * FROM spaces WHERE id = $1', [generatedId]);
  const result = mapSpace(space.rows[0]);
  result.devices = await loadDevices(result.id, result.hubId, result.hubOnline);
  const registration = startHubRegistration(generatedId);
  res.status(201).json({ ...result, hubRegistration: registration });
});

app.patch('/api/spaces/:id', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  if (!await ensureSpaceDisarmed(req.params.id, res)) return;
  const { name, address, server, city, timezone } = req.body ?? {};
  const existing = await query('SELECT * FROM spaces WHERE id = $1', [req.params.id]);
  if (!existing.rows.length) {
    return res.status(404).json({ error: 'space_not_found' });
  }

  const space = existing.rows[0];
  const normalizedName = name ? normalizeText(name) : space.name;
  const normalizedAddress = address ? normalizeText(address) : space.address;
  const normalizedServer = server ? normalizeText(server) : space.server;
  const normalizedCity = city ? normalizeText(city) : space.city;
  if (!normalizedName) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (isOverMaxLength(normalizedName, MAX_SPACE_NAME_LENGTH)
    || isOverMaxLength(normalizedAddress, MAX_ADDRESS_LENGTH)
    || isOverMaxLength(normalizedServer, MAX_SERVER_NAME_LENGTH)
    || isOverMaxLength(normalizedCity, MAX_CITY_LENGTH)) {
    return res.status(400).json({ error: 'field_too_long' });
  }
  const updated = await query(
    'UPDATE spaces SET name = $1, address = $2, server = $3, city = $4, timezone = $5 WHERE id = $6 RETURNING *',
    [
      normalizedName,
      normalizedAddress,
      normalizedServer,
      normalizedCity,
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
  const normalizedName = normalizeText(name);
  const normalizedRole = normalizeText(role) || '—';
  const normalizedPhone = normalizeText(phone) || '—';
  if (!normalizedName) return res.status(400).json({ error: 'missing_fields' });
  if (isOverMaxLength(normalizedName, MAX_CONTACT_NAME_LENGTH)
    || isOverMaxLength(normalizedRole, MAX_CONTACT_ROLE_LENGTH)
    || isOverMaxLength(normalizedPhone, MAX_CONTACT_PHONE_LENGTH)) {
    return res.status(400).json({ error: 'field_too_long' });
  }

  const result = await query('SELECT contacts FROM spaces WHERE id = $1', [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'space_not_found' });

  const contacts = result.rows[0].contacts ?? [];
  contacts.push({ name: normalizedName, role: normalizedRole, phone: normalizedPhone });
  await query('UPDATE spaces SET contacts = $1 WHERE id = $2', [JSON.stringify(contacts), req.params.id]);
  await appendLog(req.params.id, `Добавлено контактное лицо: ${normalizedName}`, 'UI', 'system');
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
  const normalizedText = normalizeText(text);
  if (!normalizedText) return res.status(400).json({ error: 'missing_fields' });
  if (isOverMaxLength(normalizedText, MAX_NOTE_LENGTH)) {
    return res.status(400).json({ error: 'note_too_long' });
  }

  const result = await query('SELECT notes FROM spaces WHERE id = $1', [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'space_not_found' });

  const notes = result.rows[0].notes ?? [];
  notes.push(normalizedText);
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
  const normalizedUrl = normalizeText(url);
  const normalizedLabel = normalizeText(label) || 'Фото';
  if (!normalizedUrl) return res.status(400).json({ error: 'missing_fields' });
  if (isOverMaxLength(normalizedLabel, MAX_PHOTO_LABEL_LENGTH)) {
    return res.status(400).json({ error: 'field_too_long' });
  }
  try {
    new URL(normalizedUrl);
  } catch {
    return res.status(400).json({ error: 'invalid_url' });
  }

  const result = await query('SELECT photos FROM spaces WHERE id = $1', [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'space_not_found' });

  const photos = result.rows[0].photos ?? [];
  photos.push({ url: normalizedUrl, label: normalizedLabel });
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
    `SELECT users.id, users.email, users.role, users.minecraft_nickname, users.discord_id, user_spaces.role AS space_role
     FROM user_spaces
     JOIN users ON users.id = user_spaces.user_id
     WHERE user_spaces.space_id = $1
     ORDER BY user_spaces.role, users.id`,
    [req.params.id],
  );
  res.json(members.rows.map((member) => ({
    ...member,
    is_self: member.id === req.user.id,
  })));
});

app.post('/api/spaces/:id/members', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const { nickname, role, identifier } = req.body ?? {};
  const value = identifier ?? nickname;
  if (!value) {
    res.status(400).json({ error: 'missing_identifier' });
    return;
  }
  const normalized = normalizeText(value);
  if (isOverMaxLength(normalized, MAX_NICKNAME_LENGTH)) {
    res.status(400).json({ error: 'nickname_too_long' });
    return;
  }
  const desiredRole = role === 'installer' ? 'installer' : 'user';
  const userResult = await query(
    'SELECT id, role, minecraft_nickname FROM users WHERE lower(minecraft_nickname) = lower($1)',
    [normalized],
  );
  const target = userResult.rows[0];
  if (!target) {
    res.status(404).json({ error: 'user_not_found' });
    return;
  }
  await query(
    'INSERT INTO user_spaces (user_id, space_id, role) VALUES ($1,$2,$3) ON CONFLICT (user_id, space_id) DO UPDATE SET role = EXCLUDED.role',
    [target.id, req.params.id, desiredRole],
  );
  const roleLabel = desiredRole === 'installer' ? 'Инженер монтажа' : 'Пользователь';
  const targetName = target.minecraft_nickname ?? normalized;
  await appendLog(req.params.id, `${roleLabel} ${targetName} получил доступ`, 'UI', 'access');
  res.json({ ok: true });
});

app.post('/api/spaces/:id/leave', requireAuth, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const membership = await query(
    'SELECT role FROM user_spaces WHERE user_id = $1 AND space_id = $2',
    [req.user.id, req.params.id],
  );
  const membershipRole = membership.rows[0]?.role ?? 'user';
  if (membershipRole === 'installer') {
    const installers = await query(
      `SELECT COUNT(*)::int AS count
       FROM user_spaces
       WHERE user_spaces.space_id = $1 AND user_spaces.role = 'installer'`,
      [req.params.id],
    );
    if (installers.rows[0].count <= 1) {
      res.status(409).json({ error: 'last_installer' });
      return;
    }
  }
  await query('DELETE FROM user_spaces WHERE user_id = $1 AND space_id = $2', [req.user.id, req.params.id]);
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
  const targetResult = await query(
    `SELECT users.id, users.role, user_spaces.role AS space_role
     FROM users
     JOIN user_spaces ON user_spaces.user_id = users.id
     WHERE users.id = $1 AND user_spaces.space_id = $2`,
    [userId, req.params.id],
  );
  if (!targetResult.rows.length) {
    res.status(404).json({ error: 'user_not_found' });
    return;
  }
  const targetRole = targetResult.rows[0].space_role ?? targetResult.rows[0].role;
  if (targetRole === 'installer') {
    const installers = await query(
      `SELECT COUNT(*)::int AS count
       FROM user_spaces
       WHERE user_spaces.space_id = $1 AND user_spaces.role = 'installer'`,
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
  const existing = await query('SELECT hub_id FROM spaces WHERE id = $1', [req.params.id]);
  if (!existing.rows.length) return res.status(404).json({ error: 'space_not_found' });
  if (existing.rows[0].hub_id) {
    return res.status(409).json({ error: 'hub_already_registered' });
  }
  cleanupExpiredHubRegistrations();
  if (pendingHubRegistrations.size && !pendingHubRegistrations.has(req.params.id)) {
    return res.status(409).json({ error: 'hub_pending' });
  }

  const registration = startHubRegistration(req.params.id);
  await appendLog(req.params.id, 'Ожидание установки хаба', 'UI', 'system');
  res.json({ ok: true, hubRegistration: registration });
});

app.get('/api/spaces/:id/hub-registration', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const hadPending = pendingHubRegistrations.has(req.params.id);
  cleanupExpiredHubRegistrations();
  const pending = getPendingHubRegistration(req.params.id);
  if (pending) {
    res.json({ pending: true, expiresAt: pending.expiresAt });
    return;
  }
  const expired = hadPending;
  const spaceResult = await query('SELECT hub_id FROM spaces WHERE id = $1', [req.params.id]);
  if (!spaceResult.rows.length) {
    res.status(404).json({ error: 'space_not_found' });
    return;
  }
  res.json({ pending: false, expired, hubId: spaceResult.rows[0].hub_id ?? null });
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
    return { level: clampNumber(payload.outputLevel ?? 15, 0, 15, 15) };
  }
  if (payload.type === 'siren') {
    return {
      level: clampNumber(payload.outputLevel ?? 15, 0, 15, 15),
      intervalMs: clampNumber(payload.intervalMs ?? 1000, MIN_INTERVAL_MS, 60_000, 1000),
      alarmDuration: clampSirenDuration(payload.alarmDuration),
    };
  }
  if (payload.type === 'reader') {
    return {
      outputLevel: clampNumber(payload.outputLevel ?? 6, 0, 15, 6),
      inputSide: payload.side ?? 'up',
      inputLevel: clampNumber(payload.inputLevel ?? 6, 0, 15, 6),
    };
  }
  if (payload.type === 'zone') {
    return {
      zoneType: payload.zoneType ?? 'instant',
      bypass: payload.bypass === 'true',
      silent: payload.silent === 'true',
      delaySeconds: clampDelaySeconds(payload.delaySeconds),
      normalLevel: clampNumber(payload.normalLevel ?? 15, 0, 15, 15),
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
  const normalizedName = normalizeText(name);
  const normalizedRoom = normalizeText(room);
  if (!normalizedName || !normalizedRoom || !type) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (isOverMaxLength(normalizedName, MAX_DEVICE_NAME_LENGTH)
    || isOverMaxLength(normalizedRoom, MAX_DEVICE_ROOM_LENGTH)
    || isOverMaxLength(side, MAX_DEVICE_ID_LENGTH)
    || isOverMaxLength(id, MAX_DEVICE_ID_LENGTH)) {
    return res.status(400).json({ error: 'field_too_long' });
  }

  const generatedId = id ?? `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await query(
    'INSERT INTO devices (id, space_id, name, room, status, type, side, config) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      generatedId,
      req.params.id,
      normalizedName,
      normalizedRoom,
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

  await appendLog(req.params.id, `Добавлено устройство: ${normalizedName}`, 'UI', 'system');
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
  const normalizedName = normalizeText(name);
  const normalizedReaderId = normalizeText(readerId);
  if (!normalizedName) return res.status(400).json({ error: 'missing_fields' });
  if (isOverMaxLength(normalizedName, MAX_KEY_NAME_LENGTH)
    || isOverMaxLength(normalizedReaderId, MAX_DEVICE_ID_LENGTH)) {
    return res.status(400).json({ error: 'field_too_long' });
  }

  await query('INSERT INTO keys (space_id, name, reader_id, groups) VALUES ($1,$2,$3,$4)', [
    req.params.id,
    normalizedName,
    normalizedReaderId || null,
    JSON.stringify(['all']),
  ]);
  await appendLog(req.params.id, `Добавлен ключ: ${normalizedName}`, 'UI', 'system');
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
  const normalizedName = normalizeText(name);
  const normalizedRoom = normalizeText(room);
  if (!normalizedName || !normalizedRoom) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (isOverMaxLength(normalizedName, MAX_DEVICE_NAME_LENGTH)
    || isOverMaxLength(normalizedRoom, MAX_DEVICE_ROOM_LENGTH)
    || isOverMaxLength(side, MAX_DEVICE_ID_LENGTH)) {
    return res.status(400).json({ error: 'field_too_long' });
  }
  const config = deviceConfigFromPayload({ ...req.body, type: device.type });

  await query(
    'UPDATE devices SET name = $1, room = $2, side = $3, config = $4 WHERE id = $5 AND space_id = $6',
    [normalizedName, normalizedRoom, side, JSON.stringify({ ...device.config, ...config }), deviceId, id],
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
  const normalizedName = normalizeText(name);
  const normalizedReaderId = normalizeText(readerId);
  if (!normalizedName) return res.status(400).json({ error: 'missing_fields' });
  if (isOverMaxLength(normalizedName, MAX_KEY_NAME_LENGTH)
    || isOverMaxLength(normalizedReaderId, MAX_DEVICE_ID_LENGTH)) {
    return res.status(400).json({ error: 'field_too_long' });
  }
  await query('UPDATE keys SET name = $1, reader_id = $2 WHERE id = $3 AND space_id = $4', [
    normalizedName,
    normalizedReaderId || null,
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
  const nextName = normalizeText(req.body?.name ?? current.name);
  const nextRole = normalizeText(req.body?.role ?? current.role) || '—';
  const nextPhone = normalizeText(req.body?.phone ?? current.phone) || '—';
  if (!nextName) return res.status(400).json({ error: 'missing_fields' });
  if (isOverMaxLength(nextName, MAX_CONTACT_NAME_LENGTH)
    || isOverMaxLength(nextRole, MAX_CONTACT_ROLE_LENGTH)
    || isOverMaxLength(nextPhone, MAX_CONTACT_PHONE_LENGTH)) {
    return res.status(400).json({ error: 'field_too_long' });
  }
  contacts[index] = { name: nextName, role: nextRole, phone: nextPhone };
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
  const normalizedText = normalizeText(req.body?.text ?? notes[index]);
  if (!normalizedText) return res.status(400).json({ error: 'missing_fields' });
  if (isOverMaxLength(normalizedText, MAX_NOTE_LENGTH)) {
    return res.status(400).json({ error: 'note_too_long' });
  }
  notes[index] = normalizedText;
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
  const nextUrl = normalizeText(req.body?.url ?? current.url);
  const nextLabel = normalizeText(req.body?.label ?? current.label) || 'Фото';
  if (!nextUrl) return res.status(400).json({ error: 'missing_fields' });
  if (isOverMaxLength(nextLabel, MAX_PHOTO_LABEL_LENGTH)) {
    return res.status(400).json({ error: 'field_too_long' });
  }
  try {
    new URL(nextUrl);
  } catch {
    return res.status(400).json({ error: 'invalid_url' });
  }
  photos[index] = { url: nextUrl, label: nextLabel };
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

  await pulseReaderOutput(readerId, outputLevel, MIN_INTERVAL_MS).catch(() => null);

  return {
    ok: true,
    output: {
      readerId,
      level: outputLevel,
    },
  };
};

app.post('/api/spaces/:id/arm', requireAuth, async (req, res) => {
  const appMode = req.header('x-app-mode');
  const roleFilter = appMode === 'pro' ? 'installer' : 'user';
  const allowed = await ensureSpaceRole(req.user.id, req.params.id, roleFilter);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const updated = await updateStatus(req.params.id, 'armed', req.user.minecraft_nickname ?? 'UI');
  if (!updated) return res.status(404).json({ error: 'space_not_found' });
  res.json(updated);
});

app.post('/api/spaces/:id/disarm', requireAuth, async (req, res) => {
  const appMode = req.header('x-app-mode');
  const roleFilter = appMode === 'pro' ? 'installer' : 'user';
  const allowed = await ensureSpaceRole(req.user.id, req.params.id, roleFilter);
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
  let spaceResult = await query('SELECT space_id FROM hubs WHERE id = $1', [normalizedHubId]);
  if (!spaceResult.rows.length && (type === 'HUB_ONLINE' || type === 'TEST_OK')) {
    const registered = await registerPendingHub(normalizedHubId);
    if (registered) {
      spaceResult = await query('SELECT space_id FROM hubs WHERE id = $1', [normalizedHubId]);
    }
  }
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
          const delaySeconds = clampDelaySeconds(config.delaySeconds ?? 30) ?? 0;
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
