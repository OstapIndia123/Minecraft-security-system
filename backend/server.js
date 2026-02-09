import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDbAuthFailed, query } from './db.js';

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
const adminPanelPassword = process.env.ADMIN_PANEL_PASSWORD;
const ADMIN_USER_ID = 0;
const adminSessions = new Map();
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 60 * 1000;

const MAX_NICKNAME_LENGTH = 16;
const NICKNAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const SPACE_CREATE_COOLDOWN_MS = 15 * 60 * 1000;
const MIN_INTERVAL_MS = 300;
const MAX_SIREN_DURATION_SEC = 120;
const MAX_DELAY_SECONDS = 120;
const MAX_NOTE_LENGTH = 100;
const MAX_SPACE_NAME_LENGTH = 16;
const MAX_ADDRESS_LENGTH = 15;
const MAX_HUB_ID_LENGTH = 40;
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

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

const wrapAppMethods = (instance) => {
  ['get', 'post', 'put', 'patch', 'delete', 'all'].forEach((method) => {
    const original = instance[method].bind(instance);
    instance[method] = (path, ...handlers) => {
      const wrapped = handlers.map((handler) =>
        typeof handler === 'function' ? asyncHandler(handler) : handler,
      );
      return original(path, ...wrapped);
    };
  });
};

wrapAppMethods(app);

const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
  : null;
app.use(cors(allowedOrigins ? { origin: allowedOrigins } : undefined));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.resolve(__dirname, '..', 'web')));
app.get(['/blocked', '/blocked.html'], (req, res) => {
  res.sendFile(path.resolve(__dirname, '..', 'web', 'blocked.html'));
});
app.use((req, res, next) => {
  if (req.path.startsWith('/api') && isDbAuthFailed() && req.path !== '/api/admin/login') {
    res.status(503).json({ error: 'db_auth_failed' });
    return;
  }
  next();
});

const { promisify } = await import('node:util');
const scryptAsync = promisify(crypto.scrypt);

const hashPassword = async (password, salt) => {
  const effectiveSalt = salt ?? crypto.randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, effectiveSalt, 64)).toString('hex');
  return { salt: effectiveSalt, hash };
};

const formatPasswordHash = async (password) => {
  const { salt, hash } = await hashPassword(password);
  return `scrypt$${salt}$${hash}`;
};

const verifyPassword = async (password, stored) => {
  if (!stored?.startsWith('scrypt$')) return false;
  const [, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const candidate = (await hashPassword(password, salt)).hash;
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

const canCreateSpace = (lastCreatedAt) => {
  if (!lastCreatedAt) return { allowed: true, retryAfterMs: 0 };
  const lastTs = new Date(lastCreatedAt).getTime();
  if (Number.isNaN(lastTs)) return { allowed: true, retryAfterMs: 0 };
  const elapsed = Date.now() - lastTs;
  if (elapsed >= SPACE_CREATE_COOLDOWN_MS) return { allowed: true, retryAfterMs: 0 };
  return { allowed: false, retryAfterMs: SPACE_CREATE_COOLDOWN_MS - elapsed };
};

const getAuthToken = (req) => {
  const header = req.header('authorization');
  if (header?.startsWith('Bearer ')) {
    return header.slice(7);
  }
  return req.header('x-session-token') ?? null;
};

const getAdminToken = (req) => req.header('x-admin-token') ?? null;

const isAdminTokenValid = (token) => {
  if (!token) return false;
  const session = adminSessions.get(token);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    adminSessions.delete(token);
    return false;
  }
  return true;
};

const loadSessionUser = async (token) => {
  if (!token) return null;
  const result = await query(
    `SELECT users.id, users.email, users.role, users.minecraft_nickname, users.discord_id, users.discord_avatar_url,
            users.language, users.timezone, users.last_nickname_change_at, users.last_space_create_at, users.is_blocked
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token = $1 AND sessions.expires_at > NOW()`,
    [token],
  );
  return result.rows[0] ?? null;
};

const requireAuth = async (req, res, next) => {
  try {
    const adminToken = getAdminToken(req);
    if (isAdminTokenValid(adminToken)) {
      req.user = {
        id: ADMIN_USER_ID,
        email: 'admin@local',
        role: 'installer',
        minecraft_nickname: 'Admin',
        discord_id: null,
        discord_avatar_url: null,
        language: 'ru',
        timezone: 'UTC',
        last_nickname_change_at: null,
        last_space_create_at: null,
        is_admin: true,
        is_blocked: false,
      };
      next();
      return;
    }
    const token = getAuthToken(req);
    const user = await loadSessionUser(token);
    if (!user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    if (user.is_blocked) {
      res.status(403).json({ error: 'user_blocked' });
      return;
    }
    req.user = user;
    next();
  } catch (error) {
    console.error('Auth check failed', error);
    if (error?.code === '28P01') {
      res.status(503).json({ error: 'db_auth_failed' });
      return;
    }
    res.status(500).json({ error: 'auth_failed' });
  }
};

const requireInstaller = (req, res, next) => {
  const isProMode = req.header('x-app-mode') === 'pro';
  if (req.user?.role !== 'installer' && !isProMode) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  next();
};

const requireAdmin = (req, res, next) => {
  if (!isAdminTokenValid(getAdminToken(req))) {
    res.status(403).json({ error: 'admin_forbidden' });
    return;
  }
  next();
};

const ensureSpaceAccess = async (userId, spaceId) => {
  if (userId === ADMIN_USER_ID) return true;
  const result = await query(
    'SELECT 1 FROM user_spaces WHERE user_id = $1 AND space_id = $2',
    [userId, spaceId],
  );
  return result.rows.length > 0;
};

const ensureSpaceRole = async (userId, spaceId, role) => {
  if (userId === ADMIN_USER_ID) return true;
  const result = await query(
    'SELECT 1 FROM user_spaces WHERE user_id = $1 AND space_id = $2 AND role = $3',
    [userId, spaceId, role],
  );
  return result.rows.length > 0;
};

const resolveMembershipRole = (roles, requestedRole, preferredRole) => {
  if (!roles.length) return null;
  if (requestedRole) {
    return roles.includes(requestedRole) ? requestedRole : null;
  }
  if (roles.includes('user')) return 'user';
  if (roles.length === 1) return roles[0];
  if (preferredRole && roles.includes(preferredRole)) return preferredRole;
  return roles[0];
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

const oauthStateSecret = process.env.OAUTH_STATE_SECRET ?? crypto.randomBytes(32).toString('hex');

const signOAuthState = (data) => {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const sig = crypto.createHmac('sha256', oauthStateSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
};

const verifyOAuthState = (state) => {
  if (!state || typeof state !== 'string') return null;
  const dotIdx = state.indexOf('.');
  if (dotIdx < 0) return null;
  const payload = state.slice(0, dotIdx);
  const sig = state.slice(dotIdx + 1);
  const expectedSig = crypto.createHmac('sha256', oauthStateSecret).update(payload).digest('base64url');
  if (sig.length !== expectedSig.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
};

const buildDiscordAuthUrl = (mode) => {
  const state = signOAuthState({ mode, ts: Date.now() });
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
  groupsEnabled: row.groups_enabled ?? false,
});

const HUB_EXTENSION_TYPES = [
  'hub_extension',
  'hub-extension',
  'hub extension',
  'hubextension',
  'extension',
];

const normalizeDeviceType = (type) => {
  if (typeof type !== 'string') return type;
  const normalized = type.trim().toLowerCase();
  if (HUB_EXTENSION_TYPES.includes(normalized)) return 'hub_extension';
  return normalized;
};

const mapDevice = (row) => ({
  id: row.id,
  name: row.name,
  room: row.room,
  status: row.status,
  type: normalizeDeviceType(row.type),
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
    groupId: row.group_id ?? null,
    createdAt,
    createdAtMs,
  };
};

const HUB_EXTENSION_PREFIX = 'HUB_EXT-';
const EXTENSION_TEST_WINDOW_MS = 2000;
const EXTENSION_TEST_GRACE_MS = 2000;
const EXTENSION_TEST_SKEW_MS = 500;
const normalizeHubId = (hubId) => (hubId?.startsWith('HUB-') ? hubId.replace('HUB-', '') : hubId);
const normalizeHubExtensionId = (hubId) => {
  const normalized = normalizeText(hubId);
  if (!normalized) return null;
  if (normalized.startsWith(HUB_EXTENSION_PREFIX)) return normalized;
  return `${HUB_EXTENSION_PREFIX}${normalized.replace(/^HUB_EXT-/, '')}`;
};
const formatHubIdForSend = (hubId) => {
  if (!hubId) return hubId;
  if (hubId.startsWith(HUB_EXTENSION_PREFIX)) return hubId;
  return hubId.startsWith('HUB-') ? hubId : `HUB-${hubId}`;
};
const normalizeSideValue = (side) => {
  if (typeof side !== 'string') return null;
  const normalized = side.trim().toLowerCase();
  if (!normalized) return null;
  const shortMap = {
    n: 'north',
    s: 'south',
    e: 'east',
    w: 'west',
    u: 'up',
    d: 'down',
  };
  return shortMap[normalized] ?? normalized;
};

const mirrorOutputSide = (side) => {
  if (!side) return side;
  const normalized = normalizeSideValue(side);
  const mirrorMap = {
    north: 'south',
    south: 'north',
    east: 'west',
    west: 'east',
    up: 'down',
    down: 'up',
  };
  return mirrorMap[normalized] ?? normalized;
};

const loadDevices = async (spaceId, hubId, hubOnline) => {
  const devices = await query('SELECT * FROM devices WHERE space_id = $1 ORDER BY id', [spaceId]);
  const keys = await query('SELECT id, name, reader_id, groups FROM keys WHERE space_id = $1 ORDER BY id', [spaceId]);

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
    config: { keyId: key.id, readerId: key.reader_id ?? null, groups: key.groups ?? [] },
  }));

  return [hubDevice, ...devices.rows.map(mapDevice), ...keyDevices];
};

const sanitizeLogText = (str) => str.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]);

const appendLog = async (spaceId, text, who, type, groupId = null) => {
  const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  await query(
    'INSERT INTO logs (space_id, time, text, who, type, group_id) VALUES ($1,$2,$3,$4,$5,$6)',
    [spaceId, time, sanitizeLogText(text), sanitizeLogText(who), type, groupId],
  );
};

const formatUserLabel = (user) => user?.minecraft_nickname ?? user?.email ?? (user?.id ? `ID ${user.id}` : '—');

const formatHubPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return '';
  return JSON.stringify(payload, null, 2);
};

const parsePagination = (req, defaultLimit = 200, maxLimit = 500) => {
  const requestedLimit = Number(req.query.limit ?? defaultLimit);
  const requestedOffset = Number(req.query.offset ?? 0);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), maxLimit)
    : defaultLimit;
  const offset = Number.isFinite(requestedOffset)
    ? Math.max(Math.trunc(requestedOffset), 0)
    : 0;
  return { limit, offset };
};

const requireWebhookToken = (req, res, next) => {
  if (!webhookToken) {
    return res.status(503).json({ error: 'webhook_not_configured' });
  }
  const headerToken = req.header('x-webhook-token')
    ?? req.header('x-hub-token')
    ?? req.header('authorization')?.replace('Bearer ', '');
  if (!headerToken || typeof headerToken !== 'string') {
    return res.status(401).json({ error: 'invalid_token' });
  }
  const tokenBuf = Buffer.from(headerToken);
  const expectedBuf = Buffer.from(webhookToken);
  if (tokenBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(tokenBuf, expectedBuf)) {
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
  const status = statusResult.rows[0].status;
  if (status === 'armed' || status === 'partial') {
    res.status(409).json({ error: 'space_armed' });
    return false;
  }
  return true;
};

const hubOutputState = new Map();
const extensionLinkChecks = new Map();

const sendHubOutput = async (hubId, side, level, { force = false, mirror = true } = {}) => {
  if (!hubId) return;
  const formattedHubId = formatHubIdForSend(hubId);
  const outputSide = mirror ? mirrorOutputSide(side) : normalizeSideValue(side);
  const stateKey = `${formattedHubId}:${outputSide}`;
  if (!force && hubOutputState.get(stateKey) === level) {
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

const pulseHubOutput = async (hubId, side, level, durationMs = MIN_INTERVAL_MS, { mirror = true } = {}) => {
  const resolvedDuration = Math.max(durationMs, MIN_INTERVAL_MS);
  await sendHubOutput(hubId, side, level, { force: true, mirror });
  setTimeout(() => {
    sendHubOutput(hubId, side, 0, { force: true, mirror }).catch(() => null);
  }, resolvedDuration);
};

const getExtensionDeviceById = async (spaceId, extensionId) => {
  if (!spaceId || !extensionId) return null;
  const normalizedExtensionId = normalizeHubExtensionId(extensionId);
  if (!normalizedExtensionId) return null;
  const result = await query(
    "SELECT * FROM devices WHERE space_id = $1 AND LOWER(type) = ANY($2) AND config->>'extensionId' = $3 LIMIT 1",
    [spaceId, HUB_EXTENSION_TYPES, normalizedExtensionId],
  );
  return result.rows[0] ?? null;
};

const sendHubOutputChecked = async (spaceId, hubId, side, level, { force = false } = {}) => {
  if (!hubId) return;
  if (hubId.startsWith(HUB_EXTENSION_PREFIX)) {
    const extensionDevice = await getExtensionDeviceById(spaceId, hubId);
    if (!extensionDevice) return;
    const ok = await checkHubExtensionLink(spaceId, extensionDevice);
    if (!ok) return;
  }
  await sendHubOutput(hubId, side, level, { force });
};

const ensureExtensionLinksForOutputs = async (spaceId, groupId = null) => {
  const outputs = groupId
    ? await query("SELECT config FROM devices WHERE space_id = $1 AND type = $2 AND (config->>'groupId')::int = $3", [spaceId, 'output-light', groupId])
    : await query('SELECT config FROM devices WHERE space_id = $1 AND type = $2', [spaceId, 'output-light']);
  if (!outputs.rows.length) return true;
  const extensionIds = new Set();
  outputs.rows.forEach((output) => {
    if (output.config?.bindTarget !== 'hub_extension') return;
    const extensionId = normalizeHubExtensionId(output.config?.extensionId);
    extensionIds.add(extensionId ?? null);
  });
  if (!extensionIds.size) return true;
  if (extensionIds.has(null)) return false;
  for (const extensionId of extensionIds) {
    const extensionDevice = await getExtensionDeviceById(spaceId, extensionId);
    if (!extensionDevice) return false;
    const ok = await checkHubExtensionLink(spaceId, extensionDevice);
    if (!ok) return false;
  }
  return true;
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
const alarmSinceArmed = new Map();
const pendingArmTimers = new Map();
const entryDelayTimers = new Map();
const entryDelayFailed = new Map();
const zoneAlarmState = new Map();
const lightBlinkTimers = new Map();
const lastKeyScans = new Map();
const keyScanWaiters = new Map();
const extensionPortWaiters = new Map();
const logExtensionTest = () => {};

const stateKey = (spaceId, groupId) => groupId ? `${spaceId}:g${groupId}` : spaceId;

const loadGroups = async (spaceId) => {
  const { rows } = await query('SELECT id, name, status FROM groups WHERE space_id = $1 ORDER BY id', [spaceId]);
  return rows;
};

const loadUserGroupAccess = async (spaceId, userId) => {
  const { rows } = await query(
    'SELECT group_id FROM user_group_access WHERE space_id = $1 AND user_id = $2 ORDER BY group_id',
    [spaceId, userId],
  );
  return rows.map((row) => row.group_id);
};

const computeSpaceStatusFromGroups = async (spaceId) => {
  const { rows } = await query('SELECT status FROM groups WHERE space_id = $1', [spaceId]);
  if (!rows.length) return 'disarmed';
  const allArmed = rows.every((g) => g.status === 'armed');
  const anyArmed = rows.some((g) => g.status === 'armed');
  return allArmed ? 'armed' : anyArmed ? 'partial' : 'disarmed';
};

const buildExtensionWaiterKey = (spaceId, extensionKey, side, level) => (
  `${spaceId}:${extensionKey}:${side}:${level}`
);

const waitForHubPort = (
  spaceId,
  extensionKey,
  side,
  level,
  timeoutMs = 1500,
  afterTimestamp = null,
) => new Promise((resolve) => {
  if (!spaceId || !extensionKey || !side || level === undefined || level === null) {
    logExtensionTest('wait_for_hub_port_skip_invalid', {
      spaceId,
      extensionKey,
      side,
      level,
      timeoutMs,
      afterTimestamp,
    });
    resolve(false);
    return;
  }
  const key = buildExtensionWaiterKey(spaceId, extensionKey, side, level);
  const expiresAt = afterTimestamp ? afterTimestamp + timeoutMs : null;
  logExtensionTest('wait_for_hub_port_start', {
    key,
    spaceId,
    extensionKey,
    side,
    level,
    timeoutMs,
    afterTimestamp,
    expiresAt,
  });
  const waiters = extensionPortWaiters.get(key) ?? [];
  const timeout = setTimeout(() => {
    const updated = (extensionPortWaiters.get(key) ?? []).filter((entry) => entry.timeout !== timeout);
    if (updated.length) {
      extensionPortWaiters.set(key, updated);
    } else {
      extensionPortWaiters.delete(key);
    }
    logExtensionTest('wait_for_hub_port_timeout', {
      key,
      spaceId,
      extensionKey,
      side,
      level,
      timeoutMs,
      afterTimestamp,
      expiresAt,
    });
    resolve(false);
  }, timeoutMs + EXTENSION_TEST_GRACE_MS);
  waiters.push({
    timeout,
    afterTimestamp,
    expiresAt,
    resolve: (resolvedAt = Date.now()) => {
      clearTimeout(timeout);
      logExtensionTest('wait_for_hub_port_resolve', {
        key,
        spaceId,
        extensionKey,
        side,
        level,
        afterTimestamp,
        expiresAt,
        resolvedAt,
      });
      resolve(resolvedAt);
    },
  });
  extensionPortWaiters.set(key, waiters);
});

const resolveHubPortWaiter = (spaceId, extensionKey, side, level, eventTime = Date.now()) => {
  const key = buildExtensionWaiterKey(spaceId, extensionKey, side, level);
  const waiters = extensionPortWaiters.get(key);
  if (!waiters?.length) {
    logExtensionTest('resolve_hub_port_no_waiters', {
      key,
      spaceId,
      extensionKey,
      side,
      level,
      eventTime,
    });
    return false;
  }
  const nextIndex = waiters.findIndex((waiter) => {
    const isAfterStart = waiter.afterTimestamp === null
      || (eventTime + EXTENSION_TEST_SKEW_MS) >= waiter.afterTimestamp;
    const isBeforeExpiry = waiter.expiresAt === null || waiter.expiresAt === undefined || eventTime <= waiter.expiresAt;
    return isAfterStart && isBeforeExpiry;
  });
  if (nextIndex === -1) {
    logExtensionTest('resolve_hub_port_no_match', {
      key,
      spaceId,
      extensionKey,
      side,
      level,
      eventTime,
      waiters: waiters.map((waiter) => ({
        afterTimestamp: waiter.afterTimestamp,
        expiresAt: waiter.expiresAt,
      })),
    });
    return false;
  }
  const [waiter] = waiters.splice(nextIndex, 1);
  waiter.resolve(eventTime);
  if (waiters.length) {
    extensionPortWaiters.set(key, waiters);
  } else {
    extensionPortWaiters.delete(key);
  }
  return true;
};
const resolveDeviceTargetId = (config, hubId) => {
  if (config?.bindTarget === 'hub_extension') {
    return normalizeHubExtensionId(config.extensionId);
  }
  return hubId;
};

const stopSirenTimers = async (spaceId, hubId, groupId = null) => {
  const sk = stateKey(spaceId, groupId);
  const timers = sirenTimers.get(sk) ?? [];
  timers.forEach((timer) => clearInterval(timer));
  sirenTimers.delete(sk);
  const stopTimeout = sirenStopTimeouts.get(sk);
  if (stopTimeout) {
    clearTimeout(stopTimeout);
    sirenStopTimeouts.delete(sk);
  }
  const sirenQuery = groupId
    ? await query("SELECT side, config FROM devices WHERE space_id = $1 AND type = $2 AND (config->>'groupId')::int = $3", [spaceId, 'siren', groupId])
    : await query('SELECT side, config FROM devices WHERE space_id = $1 AND type = $2', [spaceId, 'siren']);
  await Promise.all(
    sirenQuery.rows.map((siren) => {
      const targetId = resolveDeviceTargetId(siren.config, hubId);
      if (!targetId) return null;
      return sendHubOutputChecked(spaceId, targetId, siren.side, 0).catch(() => null);
    }),
  );
};

const startBlinkingLights = async (spaceId, hubId, reason, groupId = null) => {
  const sk = stateKey(spaceId, groupId);
  const existing = lightBlinkTimers.get(sk);
  if (existing) {
    existing.reasons.add(reason);
    return;
  }
  const outputs = groupId
    ? await query("SELECT side, config FROM devices WHERE space_id = $1 AND type = $2 AND (config->>'groupId')::int = $3", [spaceId, 'output-light', groupId])
    : await query('SELECT side, config FROM devices WHERE space_id = $1 AND type = $2', [spaceId, 'output-light']);
  if (!outputs.rows.length) return;
  const targets = outputs.rows
    .map((output) => ({
      side: output.side,
      level: Number(output.config?.level ?? 15),
      targetId: resolveDeviceTargetId(output.config, hubId),
    }))
    .filter((output) => output.targetId);
  if (!targets.length) return;
  let on = true;
  targets.forEach((output) => {
    sendHubOutputChecked(spaceId, output.targetId, output.side, output.level).catch(() => null);
  });
  const timer = setInterval(() => {
    on = !on;
    targets.forEach((output) => {
      sendHubOutputChecked(spaceId, output.targetId, output.side, on ? output.level : 0).catch(() => null);
    });
  }, 500);
  lightBlinkTimers.set(sk, { timer, reasons: new Set([reason]) });
};

const stopBlinkingLights = async (spaceId, hubId, reason, groupId = null) => {
  const sk = stateKey(spaceId, groupId);
  const existing = lightBlinkTimers.get(sk);
  if (!existing) return;
  existing.reasons.delete(reason);
  if (existing.reasons.size) return;
  clearInterval(existing.timer);
  lightBlinkTimers.delete(sk);
  let status;
  const spaceRow = await query('SELECT status, hub_id FROM spaces WHERE id = $1', [spaceId]);
  const resolvedHubId = hubId ?? spaceRow.rows[0]?.hub_id;
  if (groupId) {
    const groupRow = await query('SELECT status FROM groups WHERE id = $1 AND space_id = $2', [groupId, spaceId]);
    status = groupRow.rows[0]?.status ?? 'disarmed';
  } else {
    status = spaceRow.rows[0]?.status ?? 'disarmed';
  }
  await applyLightOutputs(spaceId, resolvedHubId, status, groupId);
};

const scheduleSirenStop = (spaceId, hubId, durationMs, groupId = null) => {
  if (!durationMs || durationMs <= 0) return;
  const sk = stateKey(spaceId, groupId);
  const existing = sirenStopTimeouts.get(sk);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    stopSirenTimers(spaceId, hubId, groupId).catch(() => null);
  }, durationMs);
  sirenStopTimeouts.set(sk, timer);
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

const clearPendingArm = async (spaceId, hubId, groupId = null) => {
  const sk = stateKey(spaceId, groupId);
  const timer = pendingArmTimers.get(sk);
  if (timer) {
    clearTimeout(timer);
    pendingArmTimers.delete(sk);
    await stopBlinkingLights(spaceId, hubId, 'exit-delay', groupId);
  }
};

const clearEntryDelay = async (spaceId, hubId, groupId = null) => {
  const sk = stateKey(spaceId, groupId);
  const entry = entryDelayTimers.get(sk);
  if (!entry) return;
  clearTimeout(entry.timer);
  entryDelayTimers.delete(sk);
  await stopBlinkingLights(spaceId, hubId, 'entry-delay', groupId);
};

const startSirenTimers = async (spaceId, hubId, groupId = null) => {
  const sk = stateKey(spaceId, groupId);
  const sirens = groupId
    ? await query("SELECT id, side, config FROM devices WHERE space_id = $1 AND type = $2 AND (config->>'groupId')::int = $3", [spaceId, 'siren', groupId])
    : await query('SELECT id, side, config FROM devices WHERE space_id = $1 AND type = $2', [spaceId, 'siren']);

  if (!sirenTimers.has(sk)) {
    const timers = [];
    for (const siren of sirens.rows) {
      const intervalMs = clampNumber(siren.config?.intervalMs ?? 1000, MIN_INTERVAL_MS, 60_000, 1000);
      const level = Number(siren.config?.level ?? 15);
      const targetId = resolveDeviceTargetId(siren.config, hubId);
      if (!targetId) continue;
      let on = false;
      const timer = setInterval(() => {
        on = !on;
        sendHubOutputChecked(spaceId, targetId, siren.side, on ? level : 0).catch(() => null);
      }, Math.max(intervalMs, MIN_INTERVAL_MS));
      timers.push(timer);
    }
    if (timers.length) {
      sirenTimers.set(sk, timers);
    }
  }

  const maxDurationMs = getMaxSirenDuration(sirens.rows);
  scheduleSirenStop(spaceId, hubId, maxDurationMs, groupId);
};

const startPendingArm = async (spaceId, hubId, delaySeconds, who, logMessage, groupId = null) => {
  const sk = stateKey(spaceId, groupId);
  if (!hubId || pendingArmTimers.has(sk)) return;
  await startBlinkingLights(spaceId, hubId, 'exit-delay', groupId);
  const timer = setTimeout(async () => {
    pendingArmTimers.delete(sk);
    await stopBlinkingLights(spaceId, hubId, 'exit-delay', groupId);
    const zonesQuery = groupId
      ? await query("SELECT status, config FROM devices WHERE space_id = $1 AND type = $2 AND (config->>'groupId')::int = $3", [spaceId, 'zone', groupId])
      : await query('SELECT status, config FROM devices WHERE space_id = $1 AND type = $2', [spaceId, 'zone']);
    const hasViolations = zonesQuery.rows.some((zone) => {
      const zoneType = zone.config?.zoneType ?? 'instant';
      if (zoneType === 'delayed' || zoneType === 'pass') return false;
      return zone.status !== 'Норма';
    });
    if (hasViolations) {
      await appendLog(spaceId, 'Неудачная попытка постановки под охрану', 'Zone', 'security', groupId);
      await applyLightOutputs(spaceId, hubId, 'disarmed', groupId);
      return;
    }
    if (groupId) {
      await query('UPDATE groups SET status = $1 WHERE id = $2 AND space_id = $3', ['armed', groupId, spaceId]);
      const computedStatus = await computeSpaceStatusFromGroups(spaceId);
      await query('UPDATE spaces SET status = $1 WHERE id = $2', [computedStatus, spaceId]);
      await appendLog(spaceId, logMessage ?? 'Группа поставлена под охрану', who, 'security', groupId);
      entryDelayFailed.delete(sk);
      await applyLightOutputs(spaceId, hubId, 'armed', groupId);
    } else {
      await updateStatus(spaceId, 'armed', who, logMessage);
    }
  }, delaySeconds * 1000);
  pendingArmTimers.set(sk, timer);
};

const startEntryDelay = async (spaceId, hubId, delaySeconds, zoneName, zoneId, groupId = null) => {
  const sk = stateKey(spaceId, groupId);
  if (!hubId || entryDelayTimers.has(sk) || entryDelayFailed.get(sk)) return;
  const resolvedDelay = clampDelaySeconds(delaySeconds) ?? 0;
  await appendLog(spaceId, 'Начало снятия', 'Zone', 'security', groupId);
  await startBlinkingLights(spaceId, hubId, 'entry-delay', groupId);
  const timer = setTimeout(async () => {
    entryDelayTimers.delete(sk);
    await stopBlinkingLights(spaceId, hubId, 'entry-delay', groupId);
    entryDelayFailed.set(sk, true);
    alarmSinceArmed.set(sk, true);
    let groupSuffix = '';
    if (groupId) {
      const gNameRow = await query('SELECT name FROM groups WHERE id = $1', [groupId]);
      if (gNameRow.rows.length) groupSuffix = ` [${gNameRow.rows[0].name}]`;
    }
    await appendLog(spaceId, 'Неудачное снятие с охраны, выслать группу реагирования!', 'Zone', 'alarm', groupId);
    if (zoneName) {
      await appendLog(spaceId, `Тревога шлейфа: ${zoneName}${groupSuffix}`, 'Zone', 'alarm', groupId);
    }
    if (zoneId) {
      zoneAlarmState.set(`${spaceId}:${zoneId}`, true);
    }
    spaceAlarmState.set(sk, true);
    const spaceRow = await query('SELECT hub_id FROM spaces WHERE id = $1', [spaceId]);
    await startSirenTimers(spaceId, spaceRow.rows[0]?.hub_id, groupId);
    await query('UPDATE spaces SET issues = true WHERE id = $1', [spaceId]);
  }, resolvedDelay * 1000);
  entryDelayTimers.set(sk, { timer, zoneName });
};

const handleExpiredReaderSessions = async () => {
  const expired = await query(
    `SELECT id, space_id, action, key_name, reader_name
     FROM reader_sessions
     WHERE expires_at < NOW()`,
  );
  if (!expired.rows.length) return;

  for (const session of expired.rows) {
    const isArmAction = session.action === 'arm' || session.action === 'group_arm';
    const message = isArmAction
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
  const stateData = verifyOAuthState(req.query.state);
  let mode = 'login';
  if (stateData) {
    mode = stateData.mode === 'register' ? 'register' : 'login';
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
          await formatPasswordHash(crypto.randomUUID()),
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
  const shouldRecordNicknameChange = nicknameChanged && req.user.minecraft_nickname;
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
      shouldRecordNicknameChange ? new Date() : req.user.last_nickname_change_at,
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

app.post('/api/admin/login', (req, res) => {
  if (!adminPanelPassword) {
    res.status(503).json({ error: 'admin_disabled' });
    return;
  }
  const ip = req.ip ?? 'unknown';
  const now = Date.now();
  const attempts = loginAttempts.get(ip) ?? [];
  const recent = attempts.filter((ts) => now - ts < LOGIN_WINDOW_MS);
  if (recent.length >= MAX_LOGIN_ATTEMPTS) {
    res.status(429).json({ error: 'too_many_attempts' });
    return;
  }
  const { password } = req.body ?? {};
  if (!password || typeof password !== 'string') {
    recent.push(now);
    loginAttempts.set(ip, recent);
    res.status(403).json({ error: 'admin_forbidden' });
    return;
  }
  const passwordBuf = Buffer.from(password);
  const storedBuf = Buffer.from(adminPanelPassword);
  if (passwordBuf.length !== storedBuf.length || !crypto.timingSafeEqual(passwordBuf, storedBuf)) {
    recent.push(now);
    loginAttempts.set(ip, recent);
    res.status(403).json({ error: 'admin_forbidden' });
    return;
  }
  loginAttempts.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  adminSessions.set(token, { expiresAt });
  res.json({ token });
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const result = await query(
    `SELECT id, email, role, minecraft_nickname, discord_id, is_blocked, created_at
     FROM users
     ORDER BY id`,
  );
  res.json(result.rows);
});

app.post('/api/admin/users/:id/block', requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: 'invalid_user' });
    return;
  }
  const updated = await query(
    'UPDATE users SET is_blocked = true WHERE id = $1 RETURNING id, is_blocked',
    [userId],
  );
  await query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  res.json(updated.rows[0] ?? { id: userId, is_blocked: true });
});

app.post('/api/admin/users/:id/unblock', requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: 'invalid_user' });
    return;
  }
  const updated = await query(
    'UPDATE users SET is_blocked = false WHERE id = $1 RETURNING id, is_blocked',
    [userId],
  );
  res.json(updated.rows[0] ?? { id: userId, is_blocked: false });
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: 'invalid_user' });
    return;
  }
  await query('DELETE FROM users WHERE id = $1', [userId]);
  res.json({ ok: true });
});

app.post('/api/admin/logs/purge', requireAdmin, async (req, res) => {
  const days = Number(req.body?.days ?? 0);
  if (!Number.isFinite(days) || days <= 0) {
    res.status(400).json({ error: 'invalid_days' });
    return;
  }
  const normalizedDays = Math.min(Math.trunc(days), 3650);
  const result = await query(
    'DELETE FROM logs WHERE created_at < NOW() - ($1 * INTERVAL \'1 day\') RETURNING id',
    [normalizedDays],
  );
  res.json({ ok: true, deleted: result.rowCount });
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
      const shouldRecordNicknameChange = nicknameChange && user.minecraft_nickname;
      const updated = await query(
        `UPDATE users
         SET minecraft_nickname = $1,
             discord_id = COALESCE($2, discord_id),
             discord_avatar_url = COALESCE($3, discord_avatar_url),
             last_nickname_change_at = $4
         WHERE id = $5
         RETURNING id, email, role, minecraft_nickname, language, timezone, discord_avatar_url, last_nickname_change_at`,
        [nickname, discordId, discordAvatarUrl, shouldRecordNicknameChange ? new Date() : user.last_nickname_change_at, user.id],
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
          await formatPasswordHash(crypto.randomUUID()),
          'user',
          nickname,
          discordId,
          discordAvatarUrl,
          'ru',
          'UTC',
          null,
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
  if (req.user.is_admin) {
    const result = await query('SELECT * FROM spaces ORDER BY id');
    const spaces = await Promise.all(
      result.rows.map(async (row) => ({
        ...mapSpace(row),
        devices: await loadDevices(row.id, row.hub_id, row.hub_online),
        groups: await loadGroups(row.id),
      })),
    );
    res.json(spaces);
    return;
  }
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
      groups: appMode === 'pro'
        ? await loadGroups(row.id)
        : await loadGroups(row.id).then(async (groups) => {
          const allowedGroups = await loadUserGroupAccess(row.id, req.user.id);
          return groups.filter((group) => allowedGroups.includes(group.id));
        }),
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
  if (appMode === 'pro') {
    space.groups = await loadGroups(space.id);
  } else {
    const groups = await loadGroups(space.id);
    const allowedGroups = await loadUserGroupAccess(space.id, req.user.id);
    space.groups = groups.filter((group) => allowedGroups.includes(group.id));
  }
  res.json(space);
});

app.get('/api/spaces/:id/extensions', requireAuth, async (req, res) => {
  const appMode = req.header('x-app-mode');
  const roleFilter = appMode === 'pro' ? 'installer' : 'user';
  const allowed = await ensureSpaceRole(req.user.id, req.params.id, roleFilter);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const result = await query(
    `SELECT id, name, config
     FROM devices
     WHERE space_id = $1 AND LOWER(type) = ANY($2)
     ORDER BY name`,
    [req.params.id, HUB_EXTENSION_TYPES],
  );
  const extensions = result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    extensionId: row.config?.extensionId ?? row.id,
  }));
  res.json({ extensions });
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
  const whereClauses = ['space_id = $1'];
  const params = [req.params.id];
  if (appMode !== 'pro') {
    whereClauses.push("type <> 'hub_raw'", "type <> 'hub'");
    const spaceRow = await query('SELECT groups_enabled FROM spaces WHERE id = $1', [req.params.id]);
    const groupsEnabled = spaceRow.rows[0]?.groups_enabled ?? false;
    if (groupsEnabled) {
      const allowedGroups = await loadUserGroupAccess(req.params.id, req.user.id);
      if (allowedGroups.length) {
        params.push(allowedGroups);
        whereClauses.push(`(group_id IS NULL OR group_id = ANY($${params.length}))`);
      } else {
        whereClauses.push('group_id IS NULL');
      }
    }
  }
  const { limit, offset } = parsePagination(req, 200, 500);
  const result = await query(
    `SELECT time,
            text,
            who,
            type,
            group_id,
            created_at
     FROM logs
     WHERE ${whereClauses.join(' AND ')}
     ORDER BY id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit + 1, offset],
  );
  const mapped = result.rows.map(mapLog);
  res.json({ logs: mapped.slice(0, limit), hasMore: mapped.length > limit });
});

app.get('/api/logs', requireAuth, async (req, res) => {
  const { limit, offset } = parsePagination(req, 200, 500);
  if (req.user.is_admin) {
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
       ORDER BY logs.id DESC
       LIMIT $1 OFFSET $2`,
      [limit + 1, offset],
    );
    const mapped = result.rows.map((row) => {
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
    });
    res.json({ logs: mapped.slice(0, limit), hasMore: mapped.length > limit });
    return;
  }
  const appMode = req.header('x-app-mode');
  const roleFilter = appMode === 'pro' ? 'installer' : 'user';
  const whereClauses = ['user_spaces.user_id = $1', 'user_spaces.role = $2'];
  if (appMode !== 'pro') {
    whereClauses.push("logs.type <> 'hub_raw'", "logs.type <> 'hub'");
  }
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
     WHERE ${whereClauses.join(' AND ')}
     ORDER BY logs.id DESC
     LIMIT $3 OFFSET $4`,
    [req.user.id, roleFilter, limit + 1, offset],
  );
  const mapped = result.rows.map((row) => {
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
  });
  res.json({ logs: mapped.slice(0, limit), hasMore: mapped.length > limit });
});

app.post('/api/spaces', requireAuth, requireInstaller, async (req, res) => {
  const { hubId, name, address, server, city, timezone } = req.body ?? {};
  const cooldown = canCreateSpace(req.user.last_space_create_at);
  if (!cooldown.allowed) {
    res.status(429).json({ error: 'space_create_cooldown', retryAfterMs: cooldown.retryAfterMs });
    return;
  }
  const normalizedName = normalizeText(name);
  const normalizedAddress = normalizeText(address) || '—';
  const normalizedServer = normalizeText(server) || '—';
  const normalizedCity = normalizeText(city) || '—';
  if (!hubId || !normalizedName) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  const normalizedHubId = normalizeHubId(normalizeText(hubId));
  if (!normalizedHubId) {
    return res.status(400).json({ error: 'invalid_hub_id' });
  }
  if (isOverMaxLength(normalizedName, MAX_SPACE_NAME_LENGTH)
    || isOverMaxLength(normalizedAddress, MAX_ADDRESS_LENGTH)
    || isOverMaxLength(normalizedServer, MAX_SERVER_NAME_LENGTH)
    || isOverMaxLength(normalizedCity, MAX_CITY_LENGTH)
    || isOverMaxLength(normalizedHubId, MAX_HUB_ID_LENGTH)) {
    return res.status(400).json({ error: 'field_too_long' });
  }
  const hubCheck = await query('SELECT id FROM hubs WHERE id = $1', [normalizedHubId]);
  if (hubCheck.rows.length) {
    return res.status(409).json({ error: 'hub_already_registered' });
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
      normalizedHubId,
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
  await appendLog(generatedId, 'Хаб привязан к пространству', 'UI', 'system');
  await query('INSERT INTO user_spaces (user_id, space_id, role) VALUES ($1,$2,$3)', [req.user.id, generatedId, 'installer']);
  await query('UPDATE users SET last_space_create_at = $1 WHERE id = $2', [new Date(), req.user.id]);
  await query('INSERT INTO hubs (id, space_id) VALUES ($1,$2)', [normalizedHubId, generatedId]);
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
  if (contacts.length >= 32) return res.status(409).json({ error: 'contact_limit' });
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
  if (notes.length >= 32) return res.status(409).json({ error: 'note_limit' });
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
  if (normalizedUrl.length > 2048) return res.status(400).json({ error: 'field_too_long' });
  try {
    const parsed = new URL(normalizedUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return res.status(400).json({ error: 'invalid_url' });
    }
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
    `SELECT users.id,
            users.email,
            users.role,
            users.minecraft_nickname,
            users.discord_id,
            user_spaces.role AS space_role,
            COALESCE(array_agg(user_group_access.group_id) FILTER (WHERE user_group_access.group_id IS NOT NULL), '{}') AS group_ids
     FROM user_spaces
     JOIN users ON users.id = user_spaces.user_id
     LEFT JOIN user_group_access
       ON user_group_access.user_id = users.id
      AND user_group_access.space_id = user_spaces.space_id
     WHERE user_spaces.space_id = $1
     GROUP BY users.id, users.email, users.role, users.minecraft_nickname, users.discord_id, user_spaces.role
     ORDER BY user_spaces.role, users.id`,
    [req.params.id],
  );
  res.json(members.rows.map((member) => ({
    ...member,
    group_ids: member.group_ids ?? [],
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
  const insertResult = await query(
    'INSERT INTO user_spaces (user_id, space_id, role) VALUES ($1,$2,$3) ON CONFLICT (user_id, space_id, role) DO NOTHING RETURNING role',
    [target.id, req.params.id, desiredRole],
  );
  if (insertResult.rows.length) {
    const roleLabel = desiredRole === 'installer' ? 'Инженер монтажа' : 'Пользователь';
    const targetName = target.minecraft_nickname ?? normalized;
    await appendLog(req.params.id, `${roleLabel} ${targetName} получил доступ`, 'UI', 'access');
  }
  res.json({ ok: true });
});

app.patch('/api/spaces/:id/members/:userId/groups', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const groupIds = Array.isArray(req.body?.groups) ? req.body.groups : [];
  const normalizedGroups = groupIds.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  const uniqueGroups = Array.from(new Set(normalizedGroups));

  if (uniqueGroups.length) {
    const groupCheck = await query(
      'SELECT id FROM groups WHERE space_id = $1 AND id = ANY($2)',
      [req.params.id, uniqueGroups],
    );
    const validGroupIds = new Set(groupCheck.rows.map((row) => row.id));
    if (validGroupIds.size !== uniqueGroups.length) {
      return res.status(400).json({ error: 'group_not_found' });
    }
  }

  await query('DELETE FROM user_group_access WHERE user_id = $1 AND space_id = $2', [req.params.userId, req.params.id]);
  if (uniqueGroups.length) {
    const values = uniqueGroups.map((groupId, index) => `($1, $2, $${index + 3})`).join(',');
    await query(
      `INSERT INTO user_group_access (user_id, space_id, group_id) VALUES ${values}`,
      [req.params.userId, req.params.id, ...uniqueGroups],
    );
  }

  res.json({ ok: true, groups: uniqueGroups });
});

app.post('/api/spaces/:id/leave', requireAuth, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const appMode = req.header('x-app-mode');
  const requestedRole = req.query.role === 'installer' ? 'installer' : req.query.role === 'user' ? 'user' : null;
  const roleRows = await query(
    'SELECT role FROM user_spaces WHERE user_id = $1 AND space_id = $2',
    [req.user.id, req.params.id],
  );
  const roles = roleRows.rows.map((row) => row.role);
  if (!roles.length) {
    res.status(404).json({ error: 'user_not_found' });
    return;
  }
  const preferredRole = appMode === 'pro' ? 'installer' : 'user';
  const membershipRole = resolveMembershipRole(roles, requestedRole, preferredRole);
  if (!membershipRole) {
    res.json({ ok: true });
    return;
  }
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
  await query(
    'DELETE FROM user_spaces WHERE user_id = $1 AND space_id = $2 AND role = $3',
    [req.user.id, req.params.id, membershipRole],
  );
  await appendLog(
    req.params.id,
    `Пользователь покинул пространство: ${formatUserLabel(req.user)}`,
    formatUserLabel(req.user),
    'system',
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
  const roleRows = await query(
    'SELECT role FROM user_spaces WHERE user_id = $1 AND space_id = $2',
    [userId, req.params.id],
  );
  const roles = roleRows.rows.map((row) => row.role);
  if (!roles.length) {
    res.status(404).json({ error: 'user_not_found' });
    return;
  }
  const requestedRole = req.query.role === 'installer' ? 'installer' : req.query.role === 'user' ? 'user' : null;
  const preferredRole = requestedRole ? null : 'user';
  const targetRole = resolveMembershipRole(roles, requestedRole, preferredRole);
  if (!targetRole) {
    res.json({ ok: true });
    return;
  }
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
  const userInfo = await query('SELECT minecraft_nickname, email FROM users WHERE id = $1', [userId]);
  const targetLabel = formatUserLabel({ ...userInfo.rows[0], id: userId });
  await query(
    'DELETE FROM user_spaces WHERE user_id = $1 AND space_id = $2 AND role = $3',
    [userId, req.params.id, targetRole],
  );
  await query('DELETE FROM user_group_access WHERE user_id = $1 AND space_id = $2', [userId, req.params.id]);
  await appendLog(
    req.params.id,
    `Пользователь удалён из пространства: ${targetLabel}`,
    targetLabel,
    'system',
  );
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
  const normalizedHubId = normalizeHubId(normalizeText(hubId));
  if (!normalizedHubId) {
    return res.status(400).json({ error: 'invalid_hub_id' });
  }
  if (isOverMaxLength(normalizedHubId, MAX_HUB_ID_LENGTH)) {
    return res.status(400).json({ error: 'field_too_long' });
  }
  const existing = await query('SELECT hub_id FROM spaces WHERE id = $1', [req.params.id]);
  if (!existing.rows.length) return res.status(404).json({ error: 'space_not_found' });
  if (existing.rows[0].hub_id) {
    return res.status(409).json({ error: 'hub_already_registered' });
  }
  const hubCheck = await query('SELECT id FROM hubs WHERE id = $1', [normalizedHubId]);
  if (hubCheck.rows.length) {
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

const deviceBindingFromPayload = (payload) => {
  const bindTarget = payload.bindTarget === 'hub_extension' ? 'hub_extension' : 'hub';
  const extensionId = bindTarget === 'hub_extension'
    ? normalizeHubExtensionId(payload.bindExtensionId ?? payload.extensionId)
    : null;
  return { bindTarget, extensionId };
};

const parseGroupId = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
};

const deviceConfigFromPayload = (payload) => {
  const groupId = parseGroupId(payload.groupId);
  if (payload.type === 'hub_extension') {
    return {
      extensionId: normalizeHubExtensionId(payload.extensionId),
      hubSide: normalizeSideValue(payload.hubSide),
      extensionSide: normalizeSideValue(payload.extensionSide),
    };
  }
  if (payload.type === 'output-light') {
    return { ...deviceBindingFromPayload(payload), level: clampNumber(payload.outputLevel ?? 15, 0, 15, 15), groupId };
  }
  if (payload.type === 'siren') {
    return {
      ...deviceBindingFromPayload(payload),
      level: clampNumber(payload.outputLevel ?? 15, 0, 15, 15),
      intervalMs: clampNumber(payload.intervalMs ?? 1000, MIN_INTERVAL_MS, 60_000, 1000),
      alarmDuration: clampSirenDuration(payload.alarmDuration),
      groupId,
    };
  }
  if (payload.type === 'reader') {
    return {
      outputLevel: clampNumber(payload.outputLevel ?? 6, 0, 15, 6),
      inputSide: normalizeSideValue(payload.side) ?? 'up',
      inputLevel: clampNumber(payload.inputLevel ?? 6, 0, 15, 6),
    };
  }
  if (payload.type === 'zone') {
    return {
      ...deviceBindingFromPayload(payload),
      zoneType: payload.zoneType ?? 'instant',
      bypass: payload.bypass === 'true',
      silent: payload.silent === 'true',
      delaySeconds: clampDelaySeconds(payload.delaySeconds),
      normalLevel: clampNumber(payload.normalLevel ?? 15, 0, 15, 15),
      groupId,
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
  const normalizedType = normalizeDeviceType(type);
  const normalizedSide = normalizeSideValue(side) ?? side;
  if (!normalizedName || !normalizedRoom || !type) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (isOverMaxLength(normalizedName, MAX_DEVICE_NAME_LENGTH)
    || isOverMaxLength(normalizedRoom, MAX_DEVICE_ROOM_LENGTH)
    || isOverMaxLength(normalizedSide, MAX_DEVICE_ID_LENGTH)
    || isOverMaxLength(id, MAX_DEVICE_ID_LENGTH)) {
    return res.status(400).json({ error: 'field_too_long' });
  }

  if (type === 'hub_extension') {
    const extensionId = normalizeHubExtensionId(req.body?.extensionId);
    const hubSide = normalizeSideValue(req.body?.hubSide);
    const extensionSide = normalizeSideValue(req.body?.extensionSide);
    if (!extensionId || !hubSide || !extensionSide) {
      return res.status(400).json({ error: 'invalid_extension_id' });
    }
    if (isOverMaxLength(extensionId, MAX_DEVICE_ID_LENGTH)
      || isOverMaxLength(hubSide, MAX_DEVICE_ID_LENGTH)
      || isOverMaxLength(extensionSide, MAX_DEVICE_ID_LENGTH)) {
      return res.status(400).json({ error: 'field_too_long' });
    }
    const existingExtension = await query(
      "SELECT id FROM devices WHERE LOWER(type) = ANY($1) AND config->>'extensionId' = $2 LIMIT 1",
      [HUB_EXTENSION_TYPES, extensionId],
    );
    if (existingExtension.rows.length) {
      return res.status(409).json({ error: 'extension_id_taken' });
    }
    const countResult = await query(
      'SELECT COUNT(*)::int AS count FROM devices WHERE space_id = $1 AND LOWER(type) = ANY($2)',
      [req.params.id, HUB_EXTENSION_TYPES],
    );
    if ((countResult.rows[0]?.count ?? 0) >= 5) {
      return res.status(400).json({ error: 'extension_limit' });
    }
  }

  if (normalizedType && normalizedType !== 'hub_extension' && normalizedType !== 'hub') {
    const deviceLimitResult = await query(
      'SELECT COUNT(*)::int AS count FROM devices WHERE space_id = $1 AND LOWER(type) = $2',
      [req.params.id, normalizedType],
    );
    const deviceCount = deviceLimitResult.rows[0]?.count ?? 0;
    if (normalizedType === 'zone' && deviceCount >= 32) {
      return res.status(400).json({ error: 'zone_limit' });
    }
    if (normalizedType === 'key' && deviceCount >= 32) {
      return res.status(400).json({ error: 'key_limit' });
    }
    if (normalizedType !== 'zone' && normalizedType !== 'key' && deviceCount >= 6) {
      return res.status(400).json({ error: 'device_type_limit' });
    }
  }

  if (type !== 'reader' && type !== 'key' && type !== 'hub_extension') {
    const bindTarget = req.body?.bindTarget === 'hub_extension' ? 'hub_extension' : 'hub';
    if (bindTarget === 'hub_extension') {
      const extensionId = normalizeHubExtensionId(req.body?.bindExtensionId);
      if (!extensionId) {
        return res.status(400).json({ error: 'invalid_extension_id' });
      }
      const extensionCheck = await query(
        "SELECT id FROM devices WHERE space_id = $1 AND LOWER(type) = ANY($2) AND config->>'extensionId' = $3",
        [req.params.id, HUB_EXTENSION_TYPES, extensionId],
      );
      if (!extensionCheck.rows.length) {
        return res.status(404).json({ error: 'extension_not_found' });
      }
    }
  }

  const generatedId = id ?? `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await query(
    'INSERT INTO devices (id, space_id, name, room, status, type, side, config) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      generatedId,
      req.params.id,
      normalizedName,
      normalizedRoom,
      type === 'hub_extension' ? 'Не в сети' : (status ?? 'Норма'),
      type,
      type === 'hub_extension' ? null : (normalizedSide ?? null),
      JSON.stringify(deviceConfigFromPayload(req.body)),
    ],
  );

  const newGroupId = req.body.groupId ? Number(req.body.groupId) : null;
  if (type === 'output-light') {
    const spaceRow = await query('SELECT status, hub_id FROM spaces WHERE id = $1', [req.params.id]);
    const status = spaceRow.rows[0]?.status ?? 'disarmed';
    await applyLightOutputs(req.params.id, spaceRow.rows[0]?.hub_id, status, newGroupId);
  }

  if (type === 'siren') {
    const sk = stateKey(req.params.id, newGroupId);
    if (spaceAlarmState.get(sk)) {
      const spaceRow = await query('SELECT hub_id FROM spaces WHERE id = $1', [req.params.id]);
      await startSirenTimers(req.params.id, spaceRow.rows[0]?.hub_id, newGroupId);
    }
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

  const keyLimitResult = await query(
    'SELECT COUNT(*)::int AS count FROM keys WHERE space_id = $1',
    [req.params.id],
  );
  if ((keyLimitResult.rows[0]?.count ?? 0) >= 32) {
    return res.status(400).json({ error: 'key_limit' });
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
  const deviceType = normalizeDeviceType(device.type);
  const name = req.body?.name ?? device.name;
  const room = req.body?.room ?? device.room;
  const side = normalizeSideValue(req.body?.side ?? device.side) ?? (req.body?.side ?? device.side);
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
  const config = deviceConfigFromPayload({ ...req.body, type: deviceType });
  const mergedConfig = { ...device.config, ...config };

  if (deviceType === 'hub_extension') {
    const extensionId = normalizeHubExtensionId(mergedConfig.extensionId);
    const hubSide = normalizeSideValue(mergedConfig.hubSide);
    const extensionSide = normalizeSideValue(mergedConfig.extensionSide);
    if (!extensionId || !hubSide || !extensionSide) {
      return res.status(400).json({ error: 'invalid_extension_id' });
    }
    const existingExtension = await query(
      "SELECT id FROM devices WHERE id <> $1 AND LOWER(type) = ANY($2) AND config->>'extensionId' = $3 LIMIT 1",
      [deviceId, HUB_EXTENSION_TYPES, extensionId],
    );
    if (existingExtension.rows.length) {
      return res.status(409).json({ error: 'extension_id_taken' });
    }
    mergedConfig.extensionId = extensionId;
    mergedConfig.hubSide = hubSide;
    mergedConfig.extensionSide = extensionSide;
  }

  if (deviceType !== 'reader' && deviceType !== 'key' && deviceType !== 'hub_extension') {
    const bindTarget = mergedConfig.bindTarget === 'hub_extension' ? 'hub_extension' : 'hub';
    if (bindTarget === 'hub_extension') {
      const extensionId = normalizeHubExtensionId(mergedConfig.extensionId);
      if (!extensionId) {
        return res.status(400).json({ error: 'invalid_extension_id' });
      }
      const extensionCheck = await query(
        "SELECT id FROM devices WHERE space_id = $1 AND LOWER(type) = ANY($2) AND config->>'extensionId' = $3",
        [id, HUB_EXTENSION_TYPES, extensionId],
      );
      if (!extensionCheck.rows.length) {
        return res.status(404).json({ error: 'extension_not_found' });
      }
      mergedConfig.bindTarget = bindTarget;
      mergedConfig.extensionId = extensionId;
    } else {
      mergedConfig.bindTarget = 'hub';
      mergedConfig.extensionId = null;
    }
  }

  await query(
    'UPDATE devices SET name = $1, room = $2, side = $3, config = $4 WHERE id = $5 AND space_id = $6',
    [
      normalizedName,
      normalizedRoom,
      deviceType === 'hub_extension' ? null : side,
      JSON.stringify(mergedConfig),
      deviceId,
      id,
    ],
  );

  await appendLog(id, `Обновлено устройство: ${deviceId}`, 'UI', 'system');
  res.json({ ok: true });
});

app.post('/api/spaces/:id/devices/:deviceId/refresh', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const { id, deviceId } = req.params;
  const existing = await query('SELECT * FROM devices WHERE id = $1 AND space_id = $2 AND LOWER(type) = ANY($3)', [
    deviceId,
    id,
    HUB_EXTENSION_TYPES,
  ]);
  if (!existing.rows.length) return res.status(404).json({ error: 'device_not_found' });
  const isOnline = await checkHubExtensionLink(id, existing.rows[0]);
  res.json({ ok: true, online: isOnline });
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
  const groups = req.body?.groups ?? existing.rows[0].groups ?? [];
  await query('UPDATE keys SET name = $1, reader_id = $2, groups = $3 WHERE id = $4 AND space_id = $5', [
    normalizedName,
    normalizedReaderId || null,
    JSON.stringify(Array.isArray(groups) ? groups : []),
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

async function applyLightOutputs(spaceId, hubId, status, groupId = null, { force = false } = {}) {
  const outputs = groupId
    ? await query("SELECT side, config FROM devices WHERE space_id = $1 AND type = $2 AND (config->>'groupId')::int = $3", [spaceId, 'output-light', groupId])
    : await query('SELECT side, config FROM devices WHERE space_id = $1 AND type = $2', [spaceId, 'output-light']);
  await Promise.all(
    outputs.rows.map((output) => {
      const level = Number(output.config?.level ?? 15);
      const targetId = resolveDeviceTargetId(output.config, hubId);
      if (!targetId) return null;
      return sendHubOutputChecked(spaceId, targetId, output.side, status === 'armed' ? level : 0, { force }).catch(() => null);
    }),
  );
}

const updateStatus = async (spaceId, status, who, logMessage) => {
  const updated = await query('UPDATE spaces SET status = $1 WHERE id = $2 RETURNING *', [status, spaceId]);
  if (!updated.rows.length) return null;
  const defaultMessage = status === 'armed' ? 'Объект поставлен под охрану' : 'Объект снят с охраны';
  await appendLog(spaceId, logMessage ?? defaultMessage, who, 'security');
  const space = mapSpace(updated.rows[0]);
  await applyLightOutputs(spaceId, space.hubId, status, null, { force: status !== 'armed' });
  if (status !== 'armed') {
    await stopSirenTimers(spaceId, space.hubId);
    spaceAlarmState.set(spaceId, false);
    alarmSinceArmed.delete(spaceId);
    await clearEntryDelay(spaceId, space.hubId);
    await clearPendingArm(spaceId, space.hubId);
    entryDelayFailed.delete(spaceId);
  }
  if (status === 'armed') {
    alarmSinceArmed.set(spaceId, false);
    entryDelayFailed.delete(spaceId);
  }
  space.devices = await loadDevices(spaceId, space.hubId, space.hubOnline);
  return space;
};

const evaluateZoneIssues = async (spaceId) => {
  const spaceRow = await query('SELECT groups_enabled, status FROM spaces WHERE id = $1', [spaceId]);
  const groupsEnabled = spaceRow.rows[0]?.groups_enabled ?? false;
  if (groupsEnabled) {
    const zones = await query(
      "SELECT status, config FROM devices WHERE space_id = $1 AND type = 'zone'",
      [spaceId],
    );
    const groupRows = await query('SELECT id, status FROM groups WHERE space_id = $1', [spaceId]);
    const armedGroupIds = new Set(groupRows.rows.filter((g) => g.status === 'armed').map((g) => g.id));
    const hasIssues = zones.rows.some((zone) => {
      const gId = zone.config?.groupId;
      if (!gId || !armedGroupIds.has(gId)) return false;
      return zone.status !== 'Норма';
    });
    await query('UPDATE spaces SET issues = $1 WHERE id = $2', [hasIssues, spaceId]);
    return hasIssues;
  }
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
    'INSERT INTO logs (space_id, time, text, who, type, group_id) VALUES ($1,$2,$3,$4,$5,$6)',
    [spaceId, time, `Скан ключа: ${keyName}`, name ?? readerId, 'access', null],
  );

  const key = await query(
    'SELECT name, groups FROM keys WHERE space_id = $1 AND (reader_id IS NULL OR reader_id = $2)',
    [spaceId, readerId],
  );
  const matchedKey = key.rows.find((row) => keyName.includes(row.name));
  if (!matchedKey) {
    await appendLog(spaceId, `Неизвестный ключ: ${keyName}`, name ?? readerId, 'access');
    return { ok: true, ignored: true };
  }

  // Check if space has groups mode and key has group assignments
  const spaceDataRow = await query('SELECT groups_enabled, hub_id FROM spaces WHERE id = $1', [spaceId]);
  const groupsEnabled = spaceDataRow.rows[0]?.groups_enabled ?? false;
  const keyGroups = matchedKey.groups ?? [];
  const hubId = spaceDataRow.rows[0]?.hub_id;

  if (groupsEnabled && keyGroups.length > 0) {
    const groupRows = await query(
      'SELECT id, name, status FROM groups WHERE space_id = $1 AND id = ANY($2)',
      [spaceId, keyGroups],
    );
    if (!groupRows.rows.length) {
      return { ok: true, ignored: true };
    }

    const anyArmed = groupRows.rows.some((g) => g.status === 'armed');
    const action = anyArmed ? 'group_disarm' : 'group_arm';
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

const updateExtensionStatus = async (spaceId, extensionDevice, isOnline) => {
  const nextStatus = isOnline ? 'В сети' : 'Не в сети';
  if (extensionDevice.status === nextStatus) return;
  await query('UPDATE devices SET status = $1 WHERE id = $2', [nextStatus, extensionDevice.id]);
  const logText = isOnline ? 'Модуль расширения снова в сети' : 'Модуль расширения не в сети';
  await appendLog(spaceId, logText, extensionDevice.config?.extensionId ?? extensionDevice.id, 'system');
};

const checkHubExtensionLink = async (spaceId, extensionDevice) => {
  const config = extensionDevice.config ?? {};
  const extensionId = normalizeHubExtensionId(config.extensionId);
  const hubSide = normalizeSideValue(config.hubSide);
  const extensionSide = normalizeSideValue(config.extensionSide);
  const cacheKey = extensionDevice.id ?? extensionId;
  const now = Date.now();
  const cached = extensionLinkChecks.get(cacheKey);
  const lastKnownResult = cached?.lastResult
    ?? (extensionDevice.status === 'В сети' ? true : (extensionDevice.status === 'Не в сети' ? false : undefined));

  logExtensionTest('link_check_start', {
    spaceId,
    cacheKey,
    extensionId,
    hubSide,
    extensionSide,
    cached: cached ? { lastCheckAt: cached.lastCheckAt, lastResult: cached.lastResult, hasPromise: Boolean(cached.promise) } : null,
    lastKnownResult,
  });

  if (cached && now - cached.lastCheckAt < EXTENSION_TEST_WINDOW_MS) {
    if (lastKnownResult !== undefined) {
      logExtensionTest('link_check_cached_result', {
        cacheKey,
        lastKnownResult,
        ageMs: now - cached.lastCheckAt,
      });
      return lastKnownResult;
    }
    logExtensionTest('link_check_cached_default_false', {
      cacheKey,
      ageMs: now - cached.lastCheckAt,
    });
    return false;
  }
  if (cached?.promise) {
    logExtensionTest('link_check_cached_promise', { cacheKey });
    return cached.promise;
  }

  const promise = (async () => {
    if (!extensionId || !hubSide || !extensionSide) {
      logExtensionTest('link_check_invalid_config', {
        cacheKey,
        extensionId,
        hubSide,
        extensionSide,
      });
      await updateExtensionStatus(spaceId, extensionDevice, false);
      extensionLinkChecks.set(cacheKey, { lastCheckAt: Date.now(), lastResult: false });
      return false;
    }
    const checkStartedAt = Date.now();
    const waitForHigh = waitForHubPort(
      spaceId,
      cacheKey,
      hubSide,
      15,
      EXTENSION_TEST_WINDOW_MS,
      checkStartedAt,
    );
    logExtensionTest('link_check_pulse_start', {
      cacheKey,
      extensionId,
      extensionSide,
      hubSide,
    });
    await pulseHubOutput(extensionId, extensionSide, 15, MIN_INTERVAL_MS, { mirror: true }).catch(() => null);
    const highAt = await waitForHigh;
    logExtensionTest('link_check_high_result', {
      cacheKey,
      highAt,
    });
    if (!highAt) {
      await updateExtensionStatus(spaceId, extensionDevice, false);
      extensionLinkChecks.set(cacheKey, { lastCheckAt: Date.now(), lastResult: false });
      logExtensionTest('link_check_fail_no_high', { cacheKey });
      return false;
    }
    const remainingMs = Math.max(0, EXTENSION_TEST_WINDOW_MS - (Date.now() - checkStartedAt));
    const lowAt = await waitForHubPort(spaceId, cacheKey, hubSide, 0, remainingMs, checkStartedAt);
    const ok = Boolean(lowAt);
    logExtensionTest('link_check_low_result', {
      cacheKey,
      lowAt,
      ok,
    });
    await updateExtensionStatus(spaceId, extensionDevice, ok);
    extensionLinkChecks.set(cacheKey, { lastCheckAt: Date.now(), lastResult: ok });
    return ok;
  })();

  extensionLinkChecks.set(cacheKey, { lastCheckAt: now, promise, lastResult: lastKnownResult });
  return promise;
};

const getHubExtensionTestDevices = async (spaceId) => {
  if (!spaceId) return [];
  const result = await query(
    `SELECT id,
            status,
            config->>'extensionId' AS extension_id,
            config->>'hubSide' AS hub_side,
            config->>'extensionSide' AS extension_side
     FROM devices
     WHERE space_id = $1 AND LOWER(type) = ANY($2)`,
    [spaceId, HUB_EXTENSION_TYPES],
  );
  return result.rows.filter(
    (row) => row.extension_id && row.hub_side && row.extension_side,
  );
};

app.post('/api/spaces/:id/arm', requireAuth, async (req, res) => {
  const appMode = req.header('x-app-mode');
  const roleFilter = appMode === 'pro' ? 'installer' : 'user';
  const allowed = await ensureSpaceRole(req.user.id, req.params.id, roleFilter);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const spaceCheck = await query('SELECT groups_enabled FROM spaces WHERE id = $1', [req.params.id]);
  if (spaceCheck.rows[0]?.groups_enabled) {
    return res.status(409).json({ error: 'groups_mode_active' });
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
  const spaceCheck = await query('SELECT groups_enabled FROM spaces WHERE id = $1', [req.params.id]);
  if (spaceCheck.rows[0]?.groups_enabled) {
    return res.status(409).json({ error: 'groups_mode_active' });
  }
  const space = await updateStatus(req.params.id, 'disarmed', req.user.minecraft_nickname ?? 'UI');
  if (!space) return res.status(404).json({ error: 'space_not_found' });
  res.json(space);
});

// --- Groups mode endpoints ---

app.patch('/api/spaces/:id/groups-mode', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) return res.status(403).json({ error: 'forbidden' });
  if (!await ensureSpaceDisarmed(req.params.id, res)) return;
  const { enabled } = req.body ?? {};
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'missing_fields' });
  if (!enabled) {
    await query("UPDATE groups SET status = 'disarmed' WHERE space_id = $1", [req.params.id]);
  }
  await query('UPDATE spaces SET groups_enabled = $1 WHERE id = $2', [enabled, req.params.id]);
  const logMsg = enabled ? 'Режим групп включён' : 'Режим групп отключён';
  await appendLog(req.params.id, logMsg, 'UI', 'system');
  res.json({ ok: true });
});

app.get('/api/spaces/:id/groups', requireAuth, async (req, res) => {
  const appMode = req.header('x-app-mode');
  const roleFilter = appMode === 'pro' ? 'installer' : 'user';
  const allowed = await ensureSpaceRole(req.user.id, req.params.id, roleFilter);
  if (!allowed) return res.status(403).json({ error: 'forbidden' });
  const groups = await loadGroups(req.params.id);
  if (appMode !== 'pro') {
    const allowedGroups = await loadUserGroupAccess(req.params.id, req.user.id);
    return res.json(groups.filter((group) => allowedGroups.includes(group.id)));
  }
  res.json(groups);
});

app.post('/api/spaces/:id/groups', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) return res.status(403).json({ error: 'forbidden' });
  if (!await ensureSpaceDisarmed(req.params.id, res)) return;
  const name = normalizeText(req.body?.name);
  if (!name) return res.status(400).json({ error: 'missing_fields' });
  if (name.length > 60) return res.status(400).json({ error: 'field_too_long' });
  const existing = await query('SELECT count(*)::int AS cnt FROM groups WHERE space_id = $1', [req.params.id]);
  if (existing.rows[0].cnt >= 32) return res.status(400).json({ error: 'group_limit' });
  const result = await query(
    'INSERT INTO groups (space_id, name) VALUES ($1, $2) RETURNING id, name, status',
    [req.params.id, name],
  );
  await appendLog(req.params.id, `Добавлена группа: ${name}`, 'UI', 'system');
  res.json(result.rows[0]);
});

app.patch('/api/spaces/:id/groups/:groupId', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) return res.status(403).json({ error: 'forbidden' });
  if (!await ensureSpaceDisarmed(req.params.id, res)) return;
  const { groupId } = req.params;
  const name = normalizeText(req.body?.name);
  if (!name) return res.status(400).json({ error: 'missing_fields' });
  if (name.length > 60) return res.status(400).json({ error: 'field_too_long' });
  const result = await query(
    'UPDATE groups SET name = $1 WHERE id = $2 AND space_id = $3 RETURNING id, name, status',
    [name, groupId, req.params.id],
  );
  if (!result.rows.length) return res.status(404).json({ error: 'group_not_found' });
  await appendLog(req.params.id, `Переименована группа: ${name}`, 'UI', 'system');
  res.json(result.rows[0]);
});

app.delete('/api/spaces/:id/groups/:groupId', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) return res.status(403).json({ error: 'forbidden' });
  if (!await ensureSpaceDisarmed(req.params.id, res)) return;
  const { groupId } = req.params;
  const existing = await query('SELECT name FROM groups WHERE id = $1 AND space_id = $2', [groupId, req.params.id]);
  if (!existing.rows.length) return res.status(404).json({ error: 'group_not_found' });
  await query(
    "UPDATE devices SET config = config - 'groupId' WHERE space_id = $1 AND (config->>'groupId')::int = $2",
    [req.params.id, Number(groupId)],
  );
  await query('DELETE FROM groups WHERE id = $1 AND space_id = $2', [groupId, req.params.id]);
  await appendLog(req.params.id, `Удалена группа: ${existing.rows[0].name}`, 'UI', 'system');
  res.json({ ok: true });
});

app.post('/api/spaces/:id/groups/:groupId/arm', requireAuth, async (req, res) => {
  const appMode = req.header('x-app-mode');
  const roleFilter = appMode === 'pro' ? 'installer' : 'user';
  const allowed = await ensureSpaceRole(req.user.id, req.params.id, roleFilter);
  if (!allowed) return res.status(403).json({ error: 'forbidden' });
  if (roleFilter === 'user' && req.user.id !== ADMIN_USER_ID) {
    const userGroups = await loadUserGroupAccess(req.params.id, req.user.id);
    if (userGroups.length > 0 && !userGroups.includes(Number(req.params.groupId))) {
      return res.status(403).json({ error: 'forbidden' });
    }
  }
  const { id: spaceId, groupId } = req.params;
  const groupRow = await query('SELECT name, status FROM groups WHERE id = $1 AND space_id = $2', [groupId, spaceId]);
  if (!groupRow.rows.length) return res.status(404).json({ error: 'group_not_found' });
  const groupName = groupRow.rows[0].name;
  const zones = await query(
    "SELECT name, status, config FROM devices WHERE space_id = $1 AND type = 'zone' AND (config->>'groupId')::int = $2",
    [spaceId, Number(groupId)],
  );
  const hasBypass = zones.rows.some((zone) => zone.config?.bypass);
  const hasViolations = zones.rows.some((zone) => {
    const zoneType = zone.config?.zoneType ?? 'instant';
    if (zoneType === 'delayed' || zoneType === 'pass') return false;
    return zone.status !== 'Норма';
  });
  if (hasBypass) {
    await appendLog(spaceId, `Неудачная постановка группы '${groupName}' (обход зоны активен)`, 'UI', 'security', Number(groupId));
    return res.status(409).json({ error: 'bypass_active' });
  }
  if (hasViolations) {
    await appendLog(spaceId, `Неудачная постановка группы '${groupName}' (зоны не в норме)`, 'UI', 'security', Number(groupId));
    return res.status(409).json({ error: 'zone_state' });
  }
  const spaceRow = await query('SELECT hub_id FROM spaces WHERE id = $1', [spaceId]);
  const hubId = spaceRow.rows[0]?.hub_id;
  await query('UPDATE groups SET status = $1 WHERE id = $2 AND space_id = $3', ['armed', groupId, spaceId]);
  const computedStatus = await computeSpaceStatusFromGroups(spaceId);
  await query('UPDATE spaces SET status = $1 WHERE id = $2', [computedStatus, spaceId]);
  await evaluateZoneIssues(spaceId);
  await applyLightOutputs(spaceId, hubId, 'armed', Number(groupId));
  await appendLog(spaceId, `Группа '${groupName}' поставлена под охрану`, req.user.minecraft_nickname ?? 'UI', 'security', Number(groupId));
  const sk = stateKey(spaceId, Number(groupId));
  alarmSinceArmed.set(sk, false);
  entryDelayFailed.delete(sk);
  const result = await query('SELECT * FROM spaces WHERE id = $1', [spaceId]);
  const space = mapSpace(result.rows[0]);
  space.devices = await loadDevices(spaceId, space.hubId, space.hubOnline);
  space.groups = await loadGroups(spaceId);
  res.json(space);
});

app.post('/api/spaces/:id/groups/:groupId/disarm', requireAuth, async (req, res) => {
  const appMode = req.header('x-app-mode');
  const roleFilter = appMode === 'pro' ? 'installer' : 'user';
  const allowed = await ensureSpaceRole(req.user.id, req.params.id, roleFilter);
  if (!allowed) return res.status(403).json({ error: 'forbidden' });
  if (roleFilter === 'user' && req.user.id !== ADMIN_USER_ID) {
    const userGroups = await loadUserGroupAccess(req.params.id, req.user.id);
    if (userGroups.length > 0 && !userGroups.includes(Number(req.params.groupId))) {
      return res.status(403).json({ error: 'forbidden' });
    }
  }
  const { id: spaceId, groupId } = req.params;
  const groupRow = await query('SELECT name FROM groups WHERE id = $1 AND space_id = $2', [groupId, spaceId]);
  if (!groupRow.rows.length) return res.status(404).json({ error: 'group_not_found' });
  const groupName = groupRow.rows[0].name;
  const gId = Number(groupId);
  const sk = stateKey(spaceId, gId);
  await query('UPDATE groups SET status = $1 WHERE id = $2 AND space_id = $3', ['disarmed', groupId, spaceId]);
  const spaceRow = await query('SELECT hub_id FROM spaces WHERE id = $1', [spaceId]);
  const hubId = spaceRow.rows[0]?.hub_id;
  await stopSirenTimers(spaceId, hubId, gId);
  spaceAlarmState.set(sk, false);
  alarmSinceArmed.delete(sk);
  entryDelayFailed.delete(sk);
  await clearEntryDelay(spaceId, hubId, gId);
  await clearPendingArm(spaceId, hubId, gId);
  await stopBlinkingLights(spaceId, hubId, 'entry-delay', gId);
  await stopBlinkingLights(spaceId, hubId, 'exit-delay', gId);
  await applyLightOutputs(spaceId, hubId, 'disarmed', gId, { force: true });
  const computedStatus = await computeSpaceStatusFromGroups(spaceId);
  await query('UPDATE spaces SET status = $1 WHERE id = $2', [computedStatus, spaceId]);
  await evaluateZoneIssues(spaceId);
  await appendLog(spaceId, `Группа '${groupName}' снята с охраны`, req.user.minecraft_nickname ?? 'UI', 'security', Number(groupId));
  const result = await query('SELECT * FROM spaces WHERE id = $1', [spaceId]);
  const space = mapSpace(result.rows[0]);
  space.devices = await loadDevices(spaceId, space.hubId, space.hubOnline);
  space.groups = await loadGroups(spaceId);
  res.json(space);
});

// --- Update key groups ---

app.patch('/api/spaces/:id/keys/:keyId/groups', requireAuth, requireInstaller, async (req, res) => {
  const allowed = await ensureSpaceAccess(req.user.id, req.params.id);
  if (!allowed) return res.status(403).json({ error: 'forbidden' });
  const { id, keyId } = req.params;
  const existing = await query('SELECT * FROM keys WHERE id = $1 AND space_id = $2', [keyId, id]);
  if (!existing.rows.length) return res.status(404).json({ error: 'key_not_found' });
  const groups = req.body?.groups;
  if (!Array.isArray(groups)) return res.status(400).json({ error: 'missing_fields' });
  await query('UPDATE keys SET groups = $1 WHERE id = $2 AND space_id = $3', [JSON.stringify(groups), keyId, id]);
  await appendLog(id, `Обновлены группы ключа: ${keyId}`, 'UI', 'system');
  res.json({ ok: true });
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

  const isExtensionEvent = hubId.startsWith(HUB_EXTENSION_PREFIX);
  const shouldIgnoreExtensionEvent = isExtensionEvent
    && (type === 'TEST_OK' || type === 'TEST_FAIL' || type === 'HUB_PING');
  if (shouldIgnoreExtensionEvent) {
    return res.status(202).json({ ok: true, ignored: true });
  }
  let spaceId;
  let extensionDevice;
  let normalizedExtensionId;

  if (isExtensionEvent) {
    normalizedExtensionId = normalizeHubExtensionId(hubId);
    if (!normalizedExtensionId) {
      return res.status(202).json({ ok: true, ignored: true });
    }
    const extensionResult = await query(
      "SELECT * FROM devices WHERE LOWER(type) = ANY($1) AND config->>'extensionId' = $2 LIMIT 1",
      [HUB_EXTENSION_TYPES, normalizedExtensionId],
    );
    if (!extensionResult.rows.length) {
      return res.status(202).json({ ok: true, ignored: true });
    }
    extensionDevice = extensionResult.rows[0];
    const extensionSide = normalizeSideValue(extensionDevice?.config?.extensionSide);
    const eventSide = normalizeSideValue(payload?.side);
    const eventLevel = Number(payload?.level);
    const matchesExtensionSide = Boolean(
      eventSide
      && extensionSide
      && (eventSide === extensionSide || mirrorOutputSide(eventSide) === extensionSide),
    );
    const isTestSetOutput = Boolean(
      type === 'SET_OUTPUT'
      && matchesExtensionSide
      && (eventLevel === 0 || eventLevel === 15),
    );
    const shouldIgnoreTestSetOutput = isTestSetOutput;
    const isTestSideEvent = Boolean(
      type !== 'SET_OUTPUT'
      && eventSide
      && extensionSide
      && eventSide === extensionSide,
    );
    if (shouldIgnoreTestSetOutput || isTestSideEvent) {
      return res.status(202).json({ ok: true, ignored: true });
    }
    spaceId = extensionDevice.space_id;
    // Respond immediately to unblock hub-backend's sequential webhook queue.
    // checkHubExtensionLink sends a test pulse and waits for PORT_IN from the
    // hub, which arrives through the same queue — holding the response would
    // deadlock: hub-backend can't flush the test PORT_IN until we reply here.
    res.json({ ok: true });
    let isOnline;
    try {
      isOnline = await checkHubExtensionLink(spaceId, extensionDevice);
    } catch (err) {
      console.error('Hub extension link check failed:', err);
      return;
    }
    if (!isOnline) {
      return;
    }
  } else {
    const normalizedHubId = normalizeHubId(hubId);
    const spaceResult = await query('SELECT space_id FROM hubs WHERE id = $1', [normalizedHubId]);
    if (!spaceResult.rows.length) {
      return res.status(202).json({ ok: true, ignored: true });
    }
    spaceId = spaceResult.rows[0].space_id;
  }
  if (!isExtensionEvent && type === 'PORT_IN') {
    const normalizedSide = normalizeSideValue(payload?.side);
    const inputLevel = Number(payload?.level);
    if (normalizedSide && !Number.isNaN(inputLevel)) {
      const extensionTestDevices = await getHubExtensionTestDevices(spaceId);
      if (extensionTestDevices.length) {
        extensionTestDevices.forEach((device) => {
          const hubSide = normalizeSideValue(device.hub_side);
          if (hubSide && hubSide === normalizedSide) {
            const extensionKey = device.id ?? normalizeHubExtensionId(device.extension_id);
            if (extensionKey) {
              const eventTime = Number.isFinite(ts) ? ts : Date.now();
              resolveHubPortWaiter(spaceId, extensionKey, normalizedSide, inputLevel, eventTime);
            }
          }
        });
      }
    }
  }
  const time = ts
    ? new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const payloadText = formatHubPayload(payload);
  const hubLogLabel = isExtensionEvent ? 'Событие модуля расширения' : 'Событие хаба';
  const hubLogText = `${hubLogLabel}: ${type}\n${hubId}${payloadText ? `\n${payloadText}` : ''}`;
  await query(
    'INSERT INTO logs (space_id, time, text, who, type, group_id) VALUES ($1,$2,$3,$4,$5,$6)',
    [spaceId, time, hubLogText, hubId, 'hub_raw', null],
  );

  if (!isExtensionEvent) {
    const hubStatus = await query('SELECT hub_online FROM spaces WHERE id = $1', [spaceId]);
    const currentHubOnline = hubStatus.rows[0]?.hub_online;
    const shouldMarkOffline = type === 'TEST_FAIL' || type === 'HUB_OFFLINE';
    const shouldMarkOnline = type === 'TEST_OK' || type === 'HUB_PING' || type === 'PORT_IN' || type === 'HUB_ONLINE';

    if (shouldMarkOffline && currentHubOnline !== false) {
      await query('UPDATE spaces SET hub_online = $1 WHERE id = $2', [false, spaceId]);
      await query(
        'INSERT INTO logs (space_id, time, text, who, type, group_id) VALUES ($1,$2,$3,$4,$5,$6)',
        [spaceId, time, 'Хаб не в сети', hubId, 'system', null],
      );
    }

    if (shouldMarkOnline && currentHubOnline !== true) {
      await query('UPDATE spaces SET hub_online = $1 WHERE id = $2', [true, spaceId]);
      await query(
        'INSERT INTO logs (space_id, time, text, who, type, group_id) VALUES ($1,$2,$3,$4,$5,$6)',
        [spaceId, time, 'Хаб снова в сети', hubId, 'system', null],
      );
    }
  }

  if (type === 'PORT_IN' && payload?.side && payload?.level !== undefined) {
    const normalizedSide = normalizeSideValue(payload.side);
    const inputLevel = Number(payload.level);
    if (!normalizedSide || Number.isNaN(inputLevel)) {
      if (!res.headersSent) res.json({ ok: true });
      return;
    }

    if (!isExtensionEvent) {
      const sessions = await query(
        `SELECT id, reader_id, input_side, input_level, action, key_name, reader_name
         FROM reader_sessions
         WHERE space_id = $1 AND expires_at >= NOW()
         ORDER BY id DESC
         LIMIT 1`,
        [spaceId],
      );
      if (sessions.rows.length) {
        const session = sessions.rows[0];
        if (session.input_side === normalizedSide && Number(session.input_level) === inputLevel) {
          // Respond immediately to unblock hub-backend's sequential webhook queue.
          // Session processing may invoke checkHubExtensionLink which waits for a
          // PORT_IN that arrives through the same queue.
          if (!res.headersSent) res.json({ ok: true });
          await query('DELETE FROM reader_sessions WHERE id = $1', [session.id]);
          if (session.action === 'group_arm' || session.action === 'group_disarm') {
            const key = await query(
              'SELECT name, groups FROM keys WHERE space_id = $1 AND (reader_id IS NULL OR reader_id = $2)',
              [spaceId, session.reader_id],
            );
            const matchedKey = key.rows.find((row) => session.key_name.includes(row.name));
            const keyGroups = matchedKey?.groups ?? [];
            if (!matchedKey || !keyGroups.length) {
              return;
            }
            const groupRows = await query(
              'SELECT id, name, status FROM groups WHERE space_id = $1 AND id = ANY($2)',
              [spaceId, keyGroups],
            );
            if (!groupRows.rows.length) {
              return;
            }

            if (session.action === 'group_disarm') {
              for (const group of groupRows.rows) {
                if (group.status !== 'armed') continue;
                const extensionOk = await ensureExtensionLinksForOutputs(spaceId, group.id);
                if (!extensionOk) {
                  await appendLog(
                    spaceId,
                    `Неудачное снятие группы '${group.name}' ключом (модуль расширения не в сети): ${session.key_name}`,
                    session.reader_name,
                    'security',
                    group.id,
                  );
                  continue;
                }
                const gId = group.id;
                const sk = stateKey(spaceId, gId);
                await query("UPDATE groups SET status = 'disarmed' WHERE id = $1 AND space_id = $2", [gId, spaceId]);
                const spaceRow = await query('SELECT hub_id FROM spaces WHERE id = $1', [spaceId]);
                const hubId = spaceRow.rows[0]?.hub_id;
                await stopSirenTimers(spaceId, hubId, gId);
                spaceAlarmState.set(sk, false);
                alarmSinceArmed.delete(sk);
                entryDelayFailed.delete(sk);
                await clearEntryDelay(spaceId, hubId, gId);
                await clearPendingArm(spaceId, hubId, gId);
                await stopBlinkingLights(spaceId, hubId, 'entry-delay', gId);
                await stopBlinkingLights(spaceId, hubId, 'exit-delay', gId);
                await applyLightOutputs(spaceId, hubId, 'disarmed', gId, { force: true });
                await appendLog(spaceId, `Снятие группы '${group.name}' ключом: ${session.key_name}`, session.reader_name, 'security', gId);
              }
            } else {
              for (const group of groupRows.rows) {
                if (group.status === 'armed') continue;
                const extensionOk = await ensureExtensionLinksForOutputs(spaceId, group.id);
                if (!extensionOk) {
                  await appendLog(
                    spaceId,
                    `Неудачная постановка группы '${group.name}' ключом (модуль расширения не в сети): ${session.key_name}`,
                    session.reader_name,
                    'security',
                    group.id,
                  );
                  continue;
                }
                const gId = group.id;
                const zones = await query(
                  "SELECT name, status, config FROM devices WHERE space_id = $1 AND type = 'zone' AND (config->>'groupId')::int = $2",
                  [spaceId, gId],
                );
                const hasBypass = zones.rows.some((z) => z.config?.bypass);
                const hasViolations = zones.rows.some((z) => {
                  const zoneType = z.config?.zoneType ?? 'instant';
                  if (zoneType === 'delayed' || zoneType === 'pass') return false;
                  return z.status !== 'Норма';
                });
                if (hasBypass || hasViolations) {
                  await appendLog(spaceId, `Неудачная постановка группы '${group.name}' ключом: ${session.key_name}`, session.reader_name, 'security', gId);
                  continue;
                }
                const delaySeconds = getExitDelaySeconds(zones.rows);
                if (delaySeconds > 0) {
                  const spaceRow = await query('SELECT hub_id FROM spaces WHERE id = $1', [spaceId]);
                  await startPendingArm(spaceId, spaceRow.rows[0]?.hub_id, delaySeconds, session.reader_name,
                    `Постановка группы '${group.name}' ключом: ${session.key_name}`, gId);
                } else {
                  await query("UPDATE groups SET status = 'armed' WHERE id = $1 AND space_id = $2", [gId, spaceId]);
                  const spaceRow = await query('SELECT hub_id FROM spaces WHERE id = $1', [spaceId]);
                  await applyLightOutputs(spaceId, spaceRow.rows[0]?.hub_id, 'armed', gId);
                  const sk = stateKey(spaceId, gId);
                  alarmSinceArmed.set(sk, false);
                  entryDelayFailed.delete(sk);
                  await appendLog(spaceId, `Постановка группы '${group.name}' ключом: ${session.key_name}`, session.reader_name, 'security', gId);
                }
              }
            }

            const computedStatus = await computeSpaceStatusFromGroups(spaceId);
            await query('UPDATE spaces SET status = $1 WHERE id = $2', [computedStatus, spaceId]);
            await evaluateZoneIssues(spaceId);
          } else if (session.action === 'arm') {
            const extensionOk = await ensureExtensionLinksForOutputs(spaceId, null);
            if (!extensionOk) {
              await appendLog(
                spaceId,
                `Неудачная постановка (модуль расширения не в сети): ${session.key_name}`,
                session.reader_name,
                'security',
              );
              return;
            }
            const zones = await query('SELECT name, status, config FROM devices WHERE space_id = $1 AND type = $2', [
              spaceId,
              'zone',
            ]);
            const hasBypass = zones.rows.some((zone) => zone.config?.bypass);
            const hasViolations = zones.rows.some((zone) => {
              const zoneType = zone.config?.zoneType ?? 'instant';
              if (zoneType === 'delayed' || zoneType === 'pass') return false;
              return zone.status !== 'Норма';
            });
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
            const spaceRow = await query('SELECT hub_id, groups_enabled FROM spaces WHERE id = $1', [spaceId]);
            const hubId = spaceRow.rows[0]?.hub_id;
            if (spaceRow.rows[0]?.groups_enabled) {
              const groups = await query('SELECT id, name FROM groups WHERE space_id = $1', [spaceId]);
              for (const group of groups.rows) {
                const extensionOk = await ensureExtensionLinksForOutputs(spaceId, group.id);
                if (!extensionOk) {
                  await appendLog(
                    spaceId,
                    `Неудачное снятие группы '${group.name}' ключом (модуль расширения не в сети): ${session.key_name}`,
                    session.reader_name,
                    'security',
                    group.id,
                  );
                  return;
                }
              }
              for (const group of groups.rows) {
                const gId = group.id;
                const sk = stateKey(spaceId, gId);
                await query("UPDATE groups SET status = 'disarmed' WHERE id = $1 AND space_id = $2", [gId, spaceId]);
                await stopSirenTimers(spaceId, hubId, gId);
                spaceAlarmState.set(sk, false);
                alarmSinceArmed.delete(sk);
                entryDelayFailed.delete(sk);
                await clearEntryDelay(spaceId, hubId, gId);
                await clearPendingArm(spaceId, hubId, gId);
                await stopBlinkingLights(spaceId, hubId, 'entry-delay', gId);
                await stopBlinkingLights(spaceId, hubId, 'exit-delay', gId);
                await applyLightOutputs(spaceId, hubId, 'disarmed', gId, { force: true });
              }
            } else {
              const extensionOk = await ensureExtensionLinksForOutputs(spaceId, null);
              if (!extensionOk) {
                await appendLog(
                  spaceId,
                  `Неудачное снятие (модуль расширения не в сети): ${session.key_name}`,
                  session.reader_name,
                  'security',
                  null,
                );
                return;
              }
            }
            await updateStatus(
              spaceId,
              'disarmed',
              session.reader_name,
              `Снятие с охраны ключом: ${session.key_name}`,
            );
          }
        }
      }
    }

    const zones = isExtensionEvent
      ? await query(
        `SELECT id, name, status, config
         FROM devices
         WHERE space_id = $1
           AND type = $2
           AND side = $3
           AND config->>'bindTarget' = $4
           AND config->>'extensionId' = $5`,
        [spaceId, 'zone', normalizedSide, 'hub_extension', normalizedExtensionId],
      )
      : await query(
        `SELECT id, name, status, config
         FROM devices
         WHERE space_id = $1
           AND type = $2
           AND side = $3
           AND (config->>'bindTarget' IS NULL OR config->>'bindTarget' = $4)`,
        [spaceId, 'zone', normalizedSide, 'hub'],
      );

    const spaceDataRow = await query('SELECT status, hub_id, issues, groups_enabled FROM spaces WHERE id = $1', [spaceId]);
    const spaceGroupsEnabled = spaceDataRow.rows[0]?.groups_enabled ?? false;

    for (const zone of zones.rows) {
      const config = zone.config ?? {};
      const normalLevel = Number(config.normalLevel ?? 15);
      const isNormal = inputLevel === normalLevel;
      const currentStatus = zone.status ?? 'Норма';
      const newStatus = isNormal ? 'Норма' : 'Нарушение';
      await query('UPDATE devices SET status = $1 WHERE id = $2', [newStatus, zone.id]);

      const zoneGroupId = config.groupId ? Number(config.groupId) : null;

      // If groups mode is on and zone has no group, skip alarm logic
      if (spaceGroupsEnabled && !zoneGroupId) {
        if (isNormal && currentStatus === 'Нарушение' && zoneAlarmState.get(`${spaceId}:${zone.id}`)) {
          await appendLog(spaceId, `Восстановление шлейфа: ${zone.name}`, 'Zone', 'restore', zoneGroupId);
          zoneAlarmState.delete(`${spaceId}:${zone.id}`);
        }
        continue;
      }

      // Determine effective status based on groups mode
      let effectiveStatus;
      if (spaceGroupsEnabled && zoneGroupId) {
        const groupRow = await query('SELECT status FROM groups WHERE id = $1 AND space_id = $2', [zoneGroupId, spaceId]);
        effectiveStatus = groupRow.rows[0]?.status ?? 'disarmed';
      } else {
        effectiveStatus = spaceDataRow.rows[0]?.status ?? 'disarmed';
      }

      const sk = stateKey(spaceId, zoneGroupId);
      const zoneType = config.zoneType ?? 'instant';
      if (zoneType === 'delayed' && isNormal && entryDelayTimers.has(sk)) {
        await clearEntryDelay(spaceId, spaceDataRow.rows[0]?.hub_id, zoneGroupId);
        continue;
      }
      const hasActiveIssues = Boolean(
        spaceDataRow.rows[0]?.issues || spaceAlarmState.get(sk) || alarmSinceArmed.get(sk),
      );
      const bypass = Boolean(config.bypass);
      const silent = Boolean(config.silent);
      const shouldCheck = zoneType === '24h' || effectiveStatus === 'armed';

      // Get group name for log messages
      let groupSuffix = '';
      if (zoneGroupId) {
        const gNameRow = await query('SELECT name FROM groups WHERE id = $1', [zoneGroupId]);
        if (gNameRow.rows.length) groupSuffix = ` [${gNameRow.rows[0].name}]`;
      }

      if (shouldCheck && !bypass && !isNormal) {
        if (entryDelayFailed.get(sk)) {
          await appendLog(spaceId, `Тревога шлейфа: ${zone.name}${groupSuffix}`, 'Zone', 'alarm', zoneGroupId);
          zoneAlarmState.set(`${spaceId}:${zone.id}`, true);
          spaceAlarmState.set(sk, true);
          alarmSinceArmed.set(sk, true);
          if (!silent) {
            await startSirenTimers(spaceId, spaceDataRow.rows[0]?.hub_id, zoneGroupId);
          }
          await query('UPDATE spaces SET issues = true WHERE id = $1', [spaceId]);
          continue;
        }
        if (zoneType === 'delayed' && effectiveStatus === 'armed' && entryDelayTimers.has(sk)) {
          continue;
        }
        if (zoneType === 'delayed' && effectiveStatus === 'armed' && !entryDelayTimers.has(sk)) {
          if (hasActiveIssues) {
            await appendLog(spaceId, `Тревога шлейфа: ${zone.name}${groupSuffix}`, 'Zone', 'alarm', zoneGroupId);
            zoneAlarmState.set(`${spaceId}:${zone.id}`, true);
            spaceAlarmState.set(sk, true);
            alarmSinceArmed.set(sk, true);
            if (!silent) {
              await startSirenTimers(spaceId, spaceDataRow.rows[0]?.hub_id, zoneGroupId);
            }
            await query('UPDATE spaces SET issues = true WHERE id = $1', [spaceId]);
            continue;
          }
          const delaySeconds = clampDelaySeconds(config.delaySeconds ?? 30) ?? 0;
          await startEntryDelay(spaceId, spaceDataRow.rows[0]?.hub_id, delaySeconds, zone.name, zone.id, zoneGroupId);
          continue;
        }
        if (zoneType === 'pass' && entryDelayTimers.has(sk)) {
          continue;
        }
        await appendLog(spaceId, `Тревога шлейфа: ${zone.name}${groupSuffix}`, 'Zone', 'alarm', zoneGroupId);
        zoneAlarmState.set(`${spaceId}:${zone.id}`, true);
        spaceAlarmState.set(sk, true);
        alarmSinceArmed.set(sk, true);
        if (!silent) {
          await startSirenTimers(spaceId, spaceDataRow.rows[0]?.hub_id, zoneGroupId);
        }
        await query('UPDATE spaces SET issues = true WHERE id = $1', [spaceId]);
      }

      if (isNormal && currentStatus === 'Нарушение' && zoneAlarmState.get(`${spaceId}:${zone.id}`)) {
        await appendLog(spaceId, `Восстановление шлейфа: ${zone.name}${groupSuffix}`, 'Zone', 'restore', zoneGroupId);
        zoneAlarmState.delete(`${spaceId}:${zone.id}`);
      }
    }

    const hasIssues = await evaluateZoneIssues(spaceId);
    if (!hasIssues) {
      const spaceRow = await query('SELECT hub_id, groups_enabled FROM spaces WHERE id = $1', [spaceId]);
      const hubId = spaceRow.rows[0]?.hub_id;
      if (spaceRow.rows[0]?.groups_enabled) {
        const groups = await query('SELECT id FROM groups WHERE space_id = $1', [spaceId]);
        for (const g of groups.rows) {
          const sk = stateKey(spaceId, g.id);
          spaceAlarmState.set(sk, false);
          const sirens = await query("SELECT config FROM devices WHERE space_id = $1 AND type = $2 AND (config->>'groupId')::int = $3", [spaceId, 'siren', g.id]);
          const maxDurationMs = getMaxSirenDuration(sirens.rows);
          if (!maxDurationMs) {
            await stopSirenTimers(spaceId, hubId, g.id);
          }
        }
      } else {
        spaceAlarmState.set(spaceId, false);
        const sirens = await query('SELECT config FROM devices WHERE space_id = $1 AND type = $2', [spaceId, 'siren']);
        const maxDurationMs = getMaxSirenDuration(sirens.rows);
        if (!maxDurationMs) {
          await stopSirenTimers(spaceId, hubId);
        }
      }
    }
  }

  if (!res.headersSent) res.json({ ok: true });
});

app.post('/api/reader/events', requireWebhookToken, async (req, res) => {
  const { type, readerId, payload, ts } = req.body ?? {};
  if (type !== 'READER_SCAN' || !readerId) {
    return res.status(400).json({ error: 'invalid_payload' });
  }
  const result = await handleReaderScan({ readerId, payload, ts });
  res.json(result);
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  console.error('Unhandled error', error);
  if (error?.code === '28P01') {
    res.status(503).json({ error: 'db_auth_failed' });
    return;
  }
  res.status(500).json({ error: 'server_error' });
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});

setInterval(() => {
  query('DELETE FROM sessions WHERE expires_at < NOW()').catch(() => {});
}, 60 * 60 * 1000);

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of adminSessions) {
    if (now > session.expiresAt) adminSessions.delete(token);
  }
  for (const [ip, attempts] of loginAttempts) {
    const recent = attempts.filter((ts) => now - ts < LOGIN_WINDOW_MS);
    if (recent.length === 0) loginAttempts.delete(ip);
    else loginAttempts.set(ip, recent);
  }
}, 10 * 60 * 1000);
