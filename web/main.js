const state = {
  filter: 'all',
  logFilter: 'all',
  language: 'ru',
  timezone: 'UTC',
  nickname: '',
  lastNicknameChangeAt: null,
  lastSpaceCreateAt: null,
  spaceCreateLockUntil: null,
  avatarUrl: '',
  role: 'user',
  logs: [],
  logsOffset: 0,
  logsLimit: 200,
  logsHasMore: true,
  lastLogTimestamp: null,
};

const detectBrowserLanguage = () => {
  const lang = navigator.language ?? 'ru';
  return lang.toLowerCase().startsWith('en') ? 'en-US' : 'ru';
};

const FLASH_DURATION_MS = 15000;
const logFlashActive = new Map();
const NICKNAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const SPACE_CREATE_COOLDOWN_MS = 15 * 60 * 1000;
const ALARM_SOUND_PATH = '/alarm.mp3';
const alarmAckKey = (spaceId) => `pcn:alarm:${spaceId}`;

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const decodeHtmlEntities = (value) => {
  const text = String(value ?? '');
  if (!text.includes('&')) return text;
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
};

const alarmAudio = typeof Audio !== 'undefined' ? new Audio(ALARM_SOUND_PATH) : null;
if (alarmAudio) {
  alarmAudio.loop = true;
  alarmAudio.preload = 'auto';
}
let alarmAudioActive = false;

const setAlarmSoundActive = async (active) => {
  if (!alarmAudio) return;
  if (active === alarmAudioActive) return;
  alarmAudioActive = active;
  if (active) {
    try {
      await alarmAudio.play();
    } catch {
      // Ignore autoplay restrictions.
    }
  } else {
    alarmAudio.pause();
    alarmAudio.currentTime = 0;
  }
};

const runRefreshAnimation = async (button, action) => {
  if (!button) {
    await action();
    return;
  }
  button.classList.add('is-loading');
  button.disabled = true;
  try {
    await action();
  } finally {
    button.classList.remove('is-loading');
    button.disabled = false;
  }
};

const grid = document.getElementById('mainObjectGrid');
const logTable = document.getElementById('mainLogTable');
const refreshBtn = document.getElementById('mainRefresh');
const addSpaceBtn = document.getElementById('mainAddSpace');
const filterButtons = document.querySelectorAll('#mainFilters .chip');
const logFilters = document.querySelectorAll('#mainLogFilters .chip');
const searchInput = document.getElementById('mainSearch');
const logMoreButton = document.getElementById('mainLogMore');
const avatarButton = document.getElementById('avatarButton');
const profileDropdown = document.getElementById('profileDropdown');
const profileNickname = document.getElementById('profileNickname');
const profileNicknameChange = document.getElementById('profileNicknameChange');
const profileTimezone = document.getElementById('profileTimezone');
const profileLanguage = document.getElementById('profileLanguage');
const profileLogout = document.getElementById('profileLogout');
const switchToUser = document.getElementById('switchToUser');
const avatarImages = document.querySelectorAll('[data-avatar]');
const avatarFallbacks = document.querySelectorAll('[data-avatar-fallback]');
const actionModal = document.getElementById('actionModal');
const actionModalTitle = document.getElementById('actionModalTitle');
const actionModalMessage = document.getElementById('actionModalMessage');
const actionModalForm = document.getElementById('actionModalForm');
const actionModalConfirm = document.getElementById('actionModalConfirm');
const actionModalCancel = document.getElementById('actionModalCancel');
const actionModalClose = document.getElementById('closeActionModal');

const translations = {
  ru: {
    'pcn.title': 'Режим ПЦН',
    'pcn.subtitle': 'Объекты и общий журнал событий',
    'pcn.objects.title': 'Объекты',
    'pcn.logs.title': 'Общий журнал событий',
    'pcn.actions.refresh': 'Обновить',
    'pcn.actions.add': 'Добавить объект',
    'pcn.search': 'Поиск по объекту или ID',
    'pcn.filters.all': 'Все',
    'pcn.filters.offline': 'С хабами не в сети',
    'pcn.filters.issues': 'С тревогой',
    'pcn.log.filters.all': 'Все',
    'pcn.log.filters.security': 'Охранные',
    'pcn.log.filters.access': 'Доступ',
    'pcn.log.filters.system': 'Система',
    'pcn.log.filters.hub': 'События хаба',
    'pcn.empty.objects': 'Нет объектов по фильтру',
    'pcn.empty.logs': 'Нет событий по выбранному фильтру',
    'pcn.object.hubId': 'ID хаба',
    'pcn.object.hubOffline': 'Хаб не в сети',
    'log.actions.more': 'Показать ещё',
    'status.armed': 'Под охраной',
    'status.disarmed': 'Снято с охраны',
    'status.night': 'Ночной режим',
    'status.partial': 'Частично под охраной',
    'status.online': 'В сети',
    'status.offline': 'Не в сети',
    'status.normal': 'Норма',
    'profile.title': 'Профиль',
    'profile.nickname': 'Игровой ник',
    'profile.nickname.change': 'Сменить',
    'profile.timezone': 'Часовой пояс',
    'profile.language': 'Язык',
    'profile.switchUser': 'Перейти на пользователя',
    'profile.logout': 'Выйти',
    'pcn.pageTitle': 'Minecraft Security System — Режим ПЦН',
  },
  'en-US': {
    'pcn.title': 'MONITOR Mode',
    'pcn.subtitle': 'Objects and global event log',
    'pcn.objects.title': 'Objects',
    'pcn.logs.title': 'Global event log',
    'pcn.actions.refresh': 'Refresh',
    'pcn.actions.add': 'Add object',
    'pcn.search': 'Search by object or ID',
    'pcn.filters.all': 'All',
    'pcn.filters.offline': 'Offline hubs',
    'pcn.filters.issues': 'With alarms',
    'pcn.log.filters.all': 'All',
    'pcn.log.filters.security': 'Security',
    'pcn.log.filters.access': 'Access',
    'pcn.log.filters.system': 'System',
    'pcn.log.filters.hub': 'Hub events',
    'pcn.empty.objects': 'No objects for this filter',
    'pcn.empty.logs': 'No events for the selected filter',
    'pcn.object.hubId': 'Hub ID',
    'pcn.object.hubOffline': 'Hub offline',
    'log.actions.more': 'Show more',
    'status.armed': 'Armed',
    'status.disarmed': 'Disarmed',
    'status.night': 'Night mode',
    'status.partial': 'Partially armed',
    'status.online': 'Online',
    'status.offline': 'Offline',
    'status.normal': 'Normal',
    'profile.title': 'Profile',
    'profile.nickname': 'Game nickname',
    'profile.nickname.change': 'Change',
    'profile.timezone': 'Time zone',
    'profile.language': 'Language',
    'profile.switchUser': 'Go to user',
    'profile.logout': 'Sign out',
    'pcn.pageTitle': 'Minecraft Security System — MONITOR mode',
  },
};

const applyTranslations = () => {
  const dict = translations[state.language] ?? translations.ru;
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const key = node.dataset.i18n;
    if (dict[key]) {
      node.textContent = dict[key];
    }
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    const key = node.dataset.i18nPlaceholder;
    if (dict[key]) {
      node.setAttribute('placeholder', dict[key]);
    }
  });
  if (dict['pcn.pageTitle']) {
    document.title = dict['pcn.pageTitle'];
  }
};

const t = (key) => translations[state.language]?.[key] ?? translations.ru[key] ?? key;

const statusMap = {
  armed: 'Под охраной',
  disarmed: 'Снято с охраны',
  night: 'Ночной режим',
  partial: 'Частично под охраной',
  online: 'В сети',
  offline: 'Не в сети',
  normal: 'Норма',
};

const normalizeStatusValue = (status) => {
  if (!status) return status;
  const raw = String(status).trim();
  const lower = raw.toLowerCase();
  const aliases = {
    'не в сети': 'offline',
    'в сети': 'online',
    'норма': 'normal',
    online: 'online',
    offline: 'offline',
    normal: 'normal',
  };
  return aliases[lower] ?? (statusMap[lower] ? lower : raw);
};

const getStatusLabel = (status) => {
  const normalized = normalizeStatusValue(status);
  const key = `status.${normalized}`;
  const translated = t(key);
  if (!translated || translated === key) {
    return statusMap[normalized] ?? status;
  }
  return translated;
};

const loadProfileSettings = () => {
  const raw = localStorage.getItem('profileSettings');
  if (!raw) {
    state.language = detectBrowserLanguage();
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    state.language = parsed.language ?? state.language;
    state.timezone = parsed.timezone ?? state.timezone;
    state.nickname = parsed.nickname ?? state.nickname;
    state.lastNicknameChangeAt = parsed.lastNicknameChangeAt ?? state.lastNicknameChangeAt;
    state.lastSpaceCreateAt = parsed.lastSpaceCreateAt ?? state.lastSpaceCreateAt;
    state.spaceCreateLockUntil = parsed.spaceCreateLockUntil ?? state.spaceCreateLockUntil;
    state.avatarUrl = parsed.avatarUrl ?? state.avatarUrl;
  } catch {
    // ignore
  }
};

const statusTone = {
  armed: 'status--armed',
  disarmed: 'status--disarmed',
  night: 'status--night',
  partial: 'status--partial',
};

const syncProfileSettings = async () => {
  try {
    const response = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${localStorage.getItem('authToken') ?? ''}` },
    });
    if (!response.ok) return;
    const payload = await response.json();
    if (!payload?.user) return;
    state.language = payload.user.language ?? state.language;
    state.timezone = payload.user.timezone ?? state.timezone;
    state.nickname = payload.user.minecraft_nickname ?? state.nickname;
    state.lastNicknameChangeAt = payload.user?.last_nickname_change_at ?? null;
    state.lastSpaceCreateAt = payload.user?.last_space_create_at ?? null;
    state.avatarUrl = payload.user.discord_avatar_url ?? state.avatarUrl;
    state.role = payload.user.role ?? state.role;
    saveProfileSettings();
    setAvatar(state.avatarUrl);
    updateNicknameControls();
    updateSpaceCreateControls();
  } catch {
    // ignore
  }
};

const saveProfileSettings = () => {
  const raw = localStorage.getItem('profileSettings');
  let existing = {};
  if (raw) {
    try {
      existing = JSON.parse(raw) ?? {};
    } catch {
      existing = {};
    }
  }
  localStorage.setItem('profileSettings', JSON.stringify({
    ...existing,
    language: state.language,
    timezone: state.timezone,
    nickname: state.nickname,
    lastNicknameChangeAt: state.lastNicknameChangeAt,
    lastSpaceCreateAt: state.lastSpaceCreateAt,
    spaceCreateLockUntil: state.spaceCreateLockUntil,
    avatarUrl: state.avatarUrl,
  }));
};

const formatLockUntil = (lockUntil) => {
  const date = new Date(lockUntil);
  return `${date.toLocaleDateString('ru-RU')} ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
};

const getNicknameLockUntil = (lastChangedAt) => {
  if (!lastChangedAt) return null;
  const lastTimestamp = new Date(lastChangedAt).getTime();
  if (Number.isNaN(lastTimestamp)) return null;
  const lockUntil = lastTimestamp + NICKNAME_COOLDOWN_MS;
  return Date.now() < lockUntil ? lockUntil : null;
};

const updateNicknameControls = () => {
  const lockUntil = getNicknameLockUntil(state.lastNicknameChangeAt);
  const locked = Boolean(lockUntil);
  if (profileNickname) profileNickname.disabled = locked;
  if (profileNicknameChange) {
    profileNicknameChange.disabled = locked;
    if (locked && lockUntil) {
      profileNicknameChange.title = translateMessage(`Смена доступна после ${formatLockUntil(lockUntil)}`);
    } else {
      profileNicknameChange.removeAttribute('title');
    }
  }
};

const getSpaceCreateLockUntil = () => {
  const lockUntilFromOverride = state.spaceCreateLockUntil;
  const lockUntilFromLastCreate = (() => {
    if (!state.lastSpaceCreateAt) return null;
    const lastTimestamp = new Date(state.lastSpaceCreateAt).getTime();
    if (Number.isNaN(lastTimestamp)) return null;
    const lockUntil = lastTimestamp + SPACE_CREATE_COOLDOWN_MS;
    return Date.now() < lockUntil ? lockUntil : null;
  })();
  const lockUntil = Math.max(lockUntilFromOverride ?? 0, lockUntilFromLastCreate ?? 0);
  return lockUntil > Date.now() ? lockUntil : null;
};

let spaceCreateUnlockTimerId = null;

const applyLockState = (button, locked, title) => {
  if (!button) return;
  button.disabled = false;
  button.classList.toggle('button--locked', locked);
  button.setAttribute('aria-disabled', locked ? 'true' : 'false');
  if (title) button.title = title;
  else button.removeAttribute('title');
};

const updateSpaceCreateControls = () => {
  const lockUntil = getSpaceCreateLockUntil();
  const locked = Boolean(lockUntil);
  const title = locked && lockUntil ? translateMessage(`Создание доступно после ${formatLockUntil(lockUntil)}`) : '';
  applyLockState(addSpaceBtn, locked, title);
  if (spaceCreateUnlockTimerId) {
    clearTimeout(spaceCreateUnlockTimerId);
    spaceCreateUnlockTimerId = null;
  }
  if (lockUntil) {
    const delay = Math.max(lockUntil - Date.now(), 0) + 50;
    spaceCreateUnlockTimerId = setTimeout(() => {
      state.spaceCreateLockUntil = null;
      saveProfileSettings();
      updateSpaceCreateControls();
    }, delay);
  }
};

const setAvatar = (avatarUrl) => {
  if (!avatarImages.length) return;
  if (avatarUrl) {
    avatarImages.forEach((img) => {
      img.src = avatarUrl;
      img.style.display = 'block';
    });
    avatarFallbacks.forEach((node) => {
      node.style.display = 'none';
    });
    return;
  }
  avatarImages.forEach((img) => {
    img.removeAttribute('src');
    img.style.display = 'none';
  });
  avatarFallbacks.forEach((node) => {
    node.style.display = '';
  });
};

const messageTranslations = {
  'Подтвердите действие': 'Confirm action',
  'Подтвердить': 'Confirm',
  'Отмена': 'Cancel',
  'Ошибка подключения к базе данных. Проверьте POSTGRES_PASSWORD и перезапустите Docker Compose.':
    'Database connection error. Check POSTGRES_PASSWORD and restart Docker Compose.',
  'Введите корректный ник.': 'Please enter a valid nickname.',
  'Ник уже установлен.': 'Nickname already set.',
  'Сменить ник?': 'Change nickname?',
  'Ник нельзя сменить будет в течении следующих 7 дней.': 'Nickname can be changed again in 7 days.',
  'Сменить': 'Change',
  'Ник должен быть не длиннее 16 символов.': 'Nickname must be 16 characters or fewer.',
  'Сменить ник можно раз в 7 дней.': 'You can change your nickname once every 7 days.',
  'Такой ник уже используется.': 'That nickname is already in use.',
  'Не удалось обновить ник.': 'Failed to update nickname.',
};

const translateMessage = (message) => {
  if (state.language !== 'en-US') return message;
  const raw = String(message ?? '');
  if (raw.startsWith('Создавать объекты можно не чаще, чем раз в 15 минут. Доступно после ')) {
    return raw.replace(
      'Создавать объекты можно не чаще, чем раз в 15 минут. Доступно после ',
      'You can create spaces no more than once every 15 minutes. Available after ',
    );
  }
  if (raw.startsWith('Создание доступно после ')) {
    return raw.replace('Создание доступно после ', 'Creation available after ');
  }
  if (raw.startsWith('Смена доступна после ')) {
    return raw.replace('Смена доступна после ', 'Change available after ');
  }
  return messageTranslations[raw] ?? raw;
};

const openActionModal = ({
  title = 'Подтвердите действие',
  message = '',
  confirmText = 'Подтвердить',
  cancelText = 'Отмена',
} = {}) => new Promise((resolve) => {
  if (!actionModal || !actionModalConfirm || !actionModalCancel) {
    resolve(null);
    return;
  }

  if (actionModalTitle) actionModalTitle.textContent = translateMessage(title);
  if (actionModalMessage) actionModalMessage.textContent = translateMessage(message);
  actionModalConfirm.textContent = translateMessage(confirmText);
  actionModalCancel.textContent = translateMessage(cancelText);

  if (actionModalForm) {
    actionModalForm.innerHTML = '';
    actionModalForm.classList.add('hidden');
  }

  const close = (result) => {
    actionModalConfirm.removeEventListener('click', handleConfirm);
    actionModalCancel.removeEventListener('click', handleCancel);
    actionModalClose?.removeEventListener('click', handleCancel);
    actionModal.removeEventListener('click', handleBackdrop);
    actionModal.classList.remove('modal--open');
    resolve(result);
  };

  const handleConfirm = () => close({ confirmed: true });
  const handleCancel = () => close(null);
  const handleBackdrop = (event) => {
    if (event.target === actionModal) {
      close(null);
    }
  };

  actionModalConfirm.addEventListener('click', handleConfirm);
  actionModalCancel.addEventListener('click', handleCancel);
  actionModalClose?.addEventListener('click', handleCancel);
  actionModal.addEventListener('click', handleBackdrop);

  actionModal.classList.add('modal--open');
});

const apiFetch = async (path) => {
  const token = localStorage.getItem('authToken');
  const response = await fetch(path, {
    headers: token
      ? { Authorization: `Bearer ${token}`, 'X-App-Mode': 'pro' }
      : { 'X-App-Mode': 'pro' },
  });
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('authToken');
      window.location.href = 'login.html';
      throw new Error('unauthorized');
    }
    const payload = await response.json().catch(() => ({}));
    if (payload?.error === 'user_blocked') {
      window.location.href = 'blocked.html';
      throw new Error('user_blocked');
    }
    if (payload?.error === 'db_auth_failed') {
      window.alert(translateMessage('Ошибка подключения к базе данных. Проверьте POSTGRES_PASSWORD и перезапустите Docker Compose.'));
    }
    throw new Error(payload.error ?? `API error: ${response.status}`);
  }
  return response.json();
};

const getLogTimestamp = (log) => {
  if (log.createdAtMs) return log.createdAtMs;
  const raw = log.createdAt ?? log.created_at;
  if (!raw) return null;
  const parsed = new Date(`${raw}Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getTime();
};

const formatLogDate = (timestamp) => {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(state.language === 'en-US' ? 'en-US' : 'ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: state.timezone,
  });
};

const formatLogTime = (timestamp) => {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString(state.language === 'en-US' ? 'en-US' : 'ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: state.timezone,
  });
};

const hasActiveAlarmFlash = (space) => {
  const prefix = `logFlash:${space.name}:`;
  for (const [key, expiresAt] of logFlashActive.entries()) {
    if (key.startsWith(prefix) && expiresAt > Date.now()) {
      return true;
    }
  }
  return false;
};

const markUnackedAlarm = (spaceId, timestamp) => {
  if (!spaceId || !timestamp) return;
  localStorage.setItem(alarmAckKey(spaceId), String(timestamp));
};

const clearUnackedAlarm = (spaceId) => {
  if (!spaceId) return;
  localStorage.removeItem(alarmAckKey(spaceId));
};

const hasUnackedAlarm = (spaceId) => Boolean(spaceId && localStorage.getItem(alarmAckKey(spaceId)));

const registerAlarmFlashes = (logs, flashSince) => {
  if (!flashSince) return;
  logs.forEach((log) => {
    if (log.type !== 'alarm') return;
    const logTimestamp = getLogTimestamp(log);
    if (!logTimestamp || logTimestamp <= flashSince) return;
    const flashKey = `logFlash:${log.spaceName}:${logTimestamp ?? log.time}:${log.text}`;
    if (localStorage.getItem(flashKey)) return;
    localStorage.setItem(flashKey, String(Date.now()));
    logFlashActive.set(flashKey, Date.now() + FLASH_DURATION_MS);
    markUnackedAlarm(log.spaceId ?? log.space_id, logTimestamp);
  });
};

const isDisarmLogText = (text) => (
  text === 'Объект снят с охраны'
  || (text.startsWith('Группа ') && text.includes(' снята с охраны'))
  || text.startsWith('Снятие с охраны')
  || (text.startsWith('Снятие группы ') && text.includes(' ключом'))
);

const isArmLogText = (text) => (
  text === 'Объект поставлен под охрану'
  || (text.startsWith('Группа ') && text.includes(' поставлена под охрану'))
  || text.startsWith('Постановка на охрану')
  || (text.startsWith('Постановка группы ') && text.includes(' ключом'))
);

const getAlarmStateBySpace = (logs) => {
  const alarmMap = new Map();
  const restoreMap = new Map();
  const disarmMap = new Map();
  const armMap = new Map();
  logs.forEach((log) => {
    const ts = getLogTimestamp(log);
    if (!ts) return;
    const key = log.spaceId ?? log.spaceName ?? log.space_id ?? '';
    if (!key) return;
    const text = log.text ?? '';
    if (log.type === 'alarm') {
      const current = alarmMap.get(key);
      if (!current || ts > current) alarmMap.set(key, ts);
    } else if (log.type === 'restore') {
      const current = restoreMap.get(key);
      if (!current || ts > current) restoreMap.set(key, ts);
    } else if (log.type === 'security' && isDisarmLogText(text)) {
      const current = disarmMap.get(key);
      if (!current || ts > current) disarmMap.set(key, ts);
    } else if (log.type === 'security' && isArmLogText(text)) {
      const current = armMap.get(key);
      if (!current || ts > current) armMap.set(key, ts);
    }
  });
  return { alarmMap, restoreMap, disarmMap, armMap };
};

const isAlarmActiveForSpace = (space, alarmState) => {
  if (!space) return false;
  if (space.status === 'disarmed') return false;
  const keys = [space.id, space.name].filter(Boolean);
  let lastAlarm = null;
  let lastRestore = null;
  keys.forEach((key) => {
    const alarmTs = alarmState.alarmMap.get(key);
    const restoreTs = alarmState.restoreMap.get(key);
    const disarmTs = alarmState.disarmMap.get(key);
    const armTs = alarmState.armMap.get(key);
    if (alarmTs && (!lastAlarm || alarmTs > lastAlarm)) lastAlarm = alarmTs;
    const clearTs = Math.max(restoreTs ?? 0, disarmTs ?? 0, armTs ?? 0);
    if (clearTs && (!lastRestore || clearTs > lastRestore)) lastRestore = clearTs;
  });
  if (!lastAlarm) return false;
  if (!lastRestore) return true;
  return lastAlarm > lastRestore;
};

const renderObjects = (spaces) => {
  const query = (searchInput?.value ?? '').trim().toLowerCase();
  const alarmState = getAlarmStateBySpace(state.logs);
  const filtered = spaces.filter((space) => {
    if (state.filter === 'offline') {
      return space.hubOnline === false;
    }
    if (state.filter === 'issues') {
      return isAlarmActiveForSpace(space, alarmState);
    }
    return true;
  }).filter((space) => {
    if (!query) return true;
    return (
      space.name.toLowerCase().includes(query) ||
      space.id.toLowerCase().includes(query) ||
      (space.hubId ?? '').toLowerCase().includes(query)
    );
  });

  grid.innerHTML = '';
  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state">${t('pcn.empty.objects')}</div>`;
    return;
  }

  filtered.forEach((space) => {
    const card = document.createElement('button');
    const hasUnacked = hasUnackedAlarm(space.id);
    const isAlarmActive = hasUnacked || isAlarmActiveForSpace(space, alarmState);
    const shouldFlash = hasActiveAlarmFlash(space);
    const hubOfflineLabel = space.hubOnline === false
      ? `<div class="object-card__hub-offline">${t('pcn.object.hubOffline')}</div>`
      : '';
    const alarmClass = isAlarmActive ? 'object-card--alarm' : '';
    const flashClass = shouldFlash ? 'object-card--alarm-flash' : '';
    card.className = `object-card ${alarmClass} ${flashClass}`;
    card.innerHTML = `
      <div class="object-card__title">${escapeHtml(space.name)}</div>
      ${hubOfflineLabel}
      <div class="object-card__status ${statusTone[space.status] ?? ''}">${getStatusLabel(space.status)}</div>
      <div class="object-card__meta">${escapeHtml(space.server ?? '—')}</div>
      <div class="object-card__meta">${escapeHtml(space.address)}</div>
    `;
    card.addEventListener('click', () => {
      clearUnackedAlarm(space.id);
      const url = new URL('main.html', window.location.href);
      url.searchParams.set('spaceId', space.id);
      window.location.href = url.toString();
    });
    grid.appendChild(card);
  });
  setAlarmSoundActive(filtered.some((space) => (
    space.status !== 'disarmed'
    && (hasUnackedAlarm(space.id) || isAlarmActiveForSpace(space, alarmState))
  ))).catch(() => null);
};

const translateLogText = (text) => {
  if (state.language !== 'en-US' || !text) return text;
  const normalizedText = String(text).replace(/&#39;/g, "'");
  const translations = [
    { pattern: /^Создано пространство$/, replacement: 'Space created' },
    { pattern: /^Обновлена информация об объекте$/, replacement: 'Space details updated' },
    { pattern: /^Объект поставлен под охрану$/, replacement: 'Object armed' },
    { pattern: /^Объект снят с охраны$/, replacement: 'Object disarmed' },
    { pattern: /^Начало снятия$/, replacement: 'Disarm started' },
    { pattern: /^Неудачная попытка постановки под охрану$/, replacement: 'Failed to arm' },
    { pattern: /^Неудачная постановка \(зоны не в норме\): (.+)$/, replacement: 'Failed to arm (zones not ready): $1' },
    { pattern: /^Тревога шлейфа: (.+)$/, replacement: 'Zone alarm: $1' },
    { pattern: /^Восстановление шлейфа: (.+)$/, replacement: 'Zone restored: $1' },
    { pattern: /^Неизвестный ключ: (.+)$/, replacement: 'Unknown key: $1' },
    { pattern: /^Добавлено контактное лицо: (.+)$/, replacement: 'Contact added: $1' },
    { pattern: /^Удалено контактное лицо: (.+)$/, replacement: 'Contact removed: $1' },
    { pattern: /^Обновлено контактное лицо: (.+)$/, replacement: 'Contact updated: $1' },
    { pattern: /^Добавлено примечание$/, replacement: 'Note added' },
    { pattern: /^Удалено примечание: (.+)$/, replacement: 'Note removed: $1' },
    { pattern: /^Обновлено примечание$/, replacement: 'Note updated' },
    { pattern: /^Добавлено фото$/, replacement: 'Photo added' },
    { pattern: /^Удалено фото: (.+)$/, replacement: 'Photo removed: $1' },
    { pattern: /^Обновлено фото$/, replacement: 'Photo updated' },
    { pattern: /^Хаб привязан к пространству$/, replacement: 'Hub attached to space' },
    { pattern: /^Хаб удалён из пространства$/, replacement: 'Hub removed from space' },
    { pattern: /^Хаб не в сети$/, replacement: 'Hub offline' },
    { pattern: /^Хаб снова в сети$/, replacement: 'Hub online again' },
    { pattern: /^Модуль расширения не в сети$/, replacement: 'Hub extension offline' },
    { pattern: /^Модуль расширения снова в сети$/, replacement: 'Hub extension online again' },
    { pattern: /^Добавлено устройство: (.+)$/, replacement: 'Device added: $1' },
    { pattern: /^Удалено устройство: (.+)$/, replacement: 'Device removed: $1' },
    { pattern: /^Обновлено устройство: (.+)$/, replacement: 'Device updated: $1' },
    { pattern: /^Добавлен ключ: (.+)$/, replacement: 'Key added: $1' },
    { pattern: /^Удалён ключ: (.+)$/, replacement: 'Key removed: $1' },
    { pattern: /^Обновлён ключ: (.+)$/, replacement: 'Key updated: $1' },
    { pattern: /^Пользователь покинул пространство: (.+)$/, replacement: 'User left space: $1' },
    { pattern: /^Пользователь удалён из пространства: (.+)$/, replacement: 'User removed from space: $1' },
    { pattern: /^Пользователь (.+) получил доступ$/, replacement: 'User $1 gained access' },
    { pattern: /^Группа '(.+)' поставлена под охрану$/, replacement: "Group '$1' armed" },
    { pattern: /^Группа '(.+)' снята с охраны$/, replacement: "Group '$1' disarmed" },
    { pattern: /^Постановка группы '(.+)' ключом: (.+)$/, replacement: "Group '$1' armed by key: $2" },
    { pattern: /^Снятие группы '(.+)' ключом: (.+)$/, replacement: "Group '$1' disarmed by key: $2" },
    { pattern: /^Добавлена группа: (.+)$/, replacement: 'Group added: $1' },
    { pattern: /^Удалена группа: (.+)$/, replacement: 'Group removed: $1' },
    { pattern: /^Переименована группа: (.+)$/, replacement: 'Group renamed: $1' },
    { pattern: /^Режим групп включён$/, replacement: 'Groups mode enabled' },
    { pattern: /^Режим групп отключён$/, replacement: 'Groups mode disabled' },
  ];
  for (const entry of translations) {
    if (entry.pattern.test(normalizedText)) {
      return normalizedText.replace(entry.pattern, entry.replacement);
    }
  }
  return normalizedText;
};

const renderLogs = (logs) => {
  const filtered = state.logFilter === 'all'
    ? logs.filter((log) => log.type !== 'hub_raw')
    : logs.filter((log) => {
        if (state.logFilter === 'security') {
          return log.type === 'security' || log.type === 'alarm' || log.type === 'restore';
        }
        if (state.logFilter === 'hub') {
          return log.type === 'hub_raw';
        }
        return log.type === state.logFilter;
      });

  logTable.innerHTML = '';
  if (!filtered.length) {
    logTable.innerHTML = `<div class="empty-state">${t('pcn.empty.logs')}</div>`;
    logMoreButton?.classList.add('hidden');
    return;
  }

  let lastDate = null;
  filtered.forEach((log) => {
    const logTimestamp = getLogTimestamp(log);
    const dateLabel = formatLogDate(logTimestamp);
    if (dateLabel && dateLabel !== lastDate) {
      const divider = document.createElement('div');
      divider.className = 'log-divider';
      divider.textContent = dateLabel;
      logTable.appendChild(divider);
      lastDate = dateLabel;
    }
    const row = document.createElement('div');
    const isAlarm = log.type === 'alarm';
    const isRestore = log.type === 'restore';
    const isHub = log.type === 'hub_raw';
    const flashKey = `logFlash:${log.spaceName}:${logTimestamp ?? log.time}:${log.text}`;
    const shouldFlash = logFlashActive.get(flashKey) > Date.now();
    if (!shouldFlash) {
      logFlashActive.delete(flashKey);
    }
    const decodedText = decodeHtmlEntities(log.text);
    const translatedText = isHub ? decodedText : translateLogText(decodedText);
    const isHubOffline = decodedText === 'Хаб не в сети' || translatedText === 'Hub offline';
    const isExtensionOffline = decodedText === 'Модуль расширения не в сети' || translatedText === 'Hub extension offline';
    row.className = `log-row ${isAlarm ? 'log-row--alarm' : ''} ${shouldFlash ? 'log-row--alarm-flash' : ''} ${isRestore ? 'log-row--restore' : ''} ${isHub ? 'log-row--hub' : ''} ${(isHubOffline || isExtensionOffline) ? 'log-row--hub-offline' : ''}`;
    const safeText = escapeHtml(translatedText);
    const text = isHub ? safeText.replace(/\n/g, '<br />') : safeText;
    const timeLabel = escapeHtml(formatLogTime(logTimestamp) ?? log.time);
    const spaceLabel = escapeHtml(log.spaceName);
    row.innerHTML = `
      <span>${timeLabel}</span>
      <span>${text}</span>
      <span class="muted">${spaceLabel}</span>
    `;
    logTable.appendChild(row);
  });
  if (logMoreButton) {
    logMoreButton.classList.toggle('hidden', !state.logsHasMore);
  }
};

const fetchLogsChunked = async (baseUrl, totalLimit) => {
  let all = [];
  let offset = 0;
  let hasMore = true;
  while (all.length < totalLimit && hasMore) {
    const batch = Math.min(200, totalLimit - all.length);
    const resp = await apiFetch(`${baseUrl}${baseUrl.includes('?') ? '&' : '?'}limit=${batch}&offset=${offset}`);
    const logs = resp.logs ?? [];
    all = [...all, ...logs];
    hasMore = Boolean(resp.hasMore);
    offset += logs.length;
    if (!logs.length) break;
  }
  return { logs: all, hasMore };
};

const loadLogs = async (reset = false) => {
  let flashSince = null;
  if (reset) {
    const previousTimestamp = state.lastLogTimestamp;
    const { logs, hasMore } = await fetchLogsChunked('/api/logs', state.logsLimit);
    state.logs = logs;
    state.logsOffset = logs.length;
    state.logsHasMore = hasMore;
    const newestTimestamp = getLogTimestamp(logs[0]) ?? null;
    state.lastLogTimestamp = newestTimestamp ?? state.lastLogTimestamp;
    if (previousTimestamp) {
      flashSince = previousTimestamp;
    }
  } else {
    const resp = await apiFetch(`/api/logs?limit=200&offset=${state.logsOffset}`);
    const logs = resp.logs ?? [];
    state.logs = [...state.logs, ...logs];
    state.logsOffset += logs.length;
    state.logsLimit = state.logsOffset;
    state.logsHasMore = Boolean(resp.hasMore);
  }
  registerAlarmFlashes(state.logs, flashSince);
  renderLogs(state.logs);
};

const refresh = async () => {
  const spaces = await apiFetch('/api/spaces');
  renderObjects(spaces);
  await loadLogs(true);
};

filterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    filterButtons.forEach((btn) => btn.classList.remove('chip--active'));
    button.classList.add('chip--active');
    state.filter = button.dataset.filter;
    refresh().catch(() => null);
  });
});

logFilters.forEach((button) => {
  button.addEventListener('click', () => {
    logFilters.forEach((btn) => btn.classList.remove('chip--active'));
    button.classList.add('chip--active');
    state.logFilter = button.dataset.log;
    refresh().catch(() => null);
  });
});

if (refreshBtn) {
  refreshBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    runRefreshAnimation(refreshBtn, refresh).catch(() => null);
  });
}

if (logMoreButton) {
  logMoreButton.addEventListener('click', () => {
    loadLogs(false).catch(() => null);
  });
}

if (addSpaceBtn) {
  addSpaceBtn.addEventListener('click', () => {
    const lockUntil = getSpaceCreateLockUntil();
    if (lockUntil) {
      updateSpaceCreateControls();
      window.alert(translateMessage(`Создавать объекты можно не чаще, чем раз в 15 минут. Доступно после ${formatLockUntil(lockUntil)}.`));
      return;
    }
    window.location.href = 'main.html?create=1';
  });
}

if (searchInput) {
  searchInput.addEventListener('input', () => {
    refresh().catch(() => null);
  });
}

const initProfileMenu = async () => {
  if (!avatarButton || !profileDropdown) return;
  const toggle = (open) => {
    profileDropdown.setAttribute('aria-hidden', open ? 'false' : 'true');
    profileDropdown.classList.toggle('profile-dropdown--open', open);
  };
  avatarButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = profileDropdown.classList.contains('profile-dropdown--open');
    toggle(!isOpen);
  });
  document.addEventListener('click', () => toggle(false));
  profileDropdown.addEventListener('click', (event) => event.stopPropagation());

  loadProfileSettings();
  setAvatar(state.avatarUrl);
  updateNicknameControls();
  updateSpaceCreateControls();
  await syncProfileSettings();
  if (profileNickname) profileNickname.value = state.nickname;
  let confirmedNickname = state.nickname;
  updateNicknameControls();
  updateSpaceCreateControls();
  if (profileTimezone) {
    const option = profileTimezone.querySelector(`option[value="${state.timezone}"]`);
    profileTimezone.value = option ? state.timezone : 'UTC';
    if (!option) {
      state.timezone = 'UTC';
      saveProfileSettings();
    }
  }
  if (profileLanguage) profileLanguage.value = state.language;
  applyTranslations();

  profileNickname?.addEventListener('input', (event) => {
    state.nickname = event.target.value;
    saveProfileSettings();
  });
  profileNicknameChange?.addEventListener('click', async () => {
    if (!profileNickname || profileNickname.disabled) return;
    const nextNickname = profileNickname.value.trim();
    if (!nextNickname) {
    window.alert(translateMessage('Введите корректный ник.'));
      return;
    }
    if (nextNickname === confirmedNickname) {
    window.alert(translateMessage('Ник уже установлен.'));
      return;
    }
    const modalResult = await openActionModal({
      title: 'Сменить ник?',
      message: 'Ник нельзя сменить будет в течении следующих 7 дней.',
      confirmText: 'Сменить',
    });
    if (!modalResult?.confirmed) {
      profileNickname.value = confirmedNickname;
      return;
    }
    try {
      const response = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('authToken') ?? ''}`,
          'X-App-Mode': 'pro',
        },
        body: JSON.stringify({ minecraft_nickname: nextNickname }),
      });
      if (response.ok) {
        const payload = await response.json().catch(() => ({}));
        confirmedNickname = payload.user?.minecraft_nickname ?? nextNickname;
        state.nickname = confirmedNickname;
        state.lastNicknameChangeAt = payload.user?.last_nickname_change_at ?? null;
        profileNickname.value = confirmedNickname;
        saveProfileSettings();
        updateNicknameControls();
        return;
      }
      const payload = await response.json().catch(() => ({}));
      const errorMessage = payload?.error === 'nickname_too_long'
        ? 'Ник должен быть не длиннее 16 символов.'
        : payload?.error === 'nickname_cooldown'
          ? 'Сменить ник можно раз в 7 дней.'
          : payload?.error === 'invalid_nickname'
            ? 'Введите корректный ник.'
            : payload?.error === 'nickname_taken'
              ? 'Такой ник уже используется.'
              : 'Не удалось обновить ник.';
      window.alert(translateMessage(errorMessage));
      profileNickname.value = confirmedNickname;
      saveProfileSettings();
    } catch {
      profileNickname.value = confirmedNickname;
      saveProfileSettings();
    }
  });
  profileTimezone?.addEventListener('change', (event) => {
    state.timezone = event.target.value;
    saveProfileSettings();
    fetch('/api/auth/me', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('authToken') ?? ''}`,
      },
      body: JSON.stringify({ timezone: state.timezone }),
    }).catch(() => null);
    refresh().catch(() => null);
  });
  profileLanguage?.addEventListener('change', (event) => {
    state.language = event.target.value;
    saveProfileSettings();
    applyTranslations();
    refresh().catch(() => null);
    fetch('/api/auth/me', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('authToken') ?? ''}`,
      },
      body: JSON.stringify({ language: state.language }),
    }).catch(() => null);
  });
  profileLogout?.addEventListener('click', async () => {
    state.nickname = '';
    state.lastNicknameChangeAt = null;
    state.lastSpaceCreateAt = null;
    state.spaceCreateLockUntil = null;
    state.avatarUrl = '';
    saveProfileSettings();
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('authToken') ?? ''}` },
      });
    } catch {
      // ignore
    }
    localStorage.removeItem('authToken');
    toggle(false);
    window.location.href = 'login.html';
  });
  switchToUser?.addEventListener('click', () => {
    window.location.href = 'user.html';
  });
};

if (!localStorage.getItem('authToken')) {
  window.location.href = 'login.html';
} else {
  initProfileMenu().then(() => {
    refresh().catch(() => null);
  });
  applyTranslations();

  setInterval(() => {
    refresh().catch(() => null);
  }, 5000);
}
