const state = {
  selectedSpaceId: null,
  selectedDeviceId: null,
  logFilter: 'all',
  language: 'ru',
  timezone: 'UTC',
  role: 'user',
  avatarUrl: '',
  lastNicknameChangeAt: null,
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

let spacesCache = [];
const NICKNAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const FLASH_DURATION_MS = 15000;
const ALARM_SOUND_PATH = '/alarm.mp3';

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
let alarmAudioOneShot = false;
const logFlashActive = new Map();
let currentAlarmActive = false;
let currentAlarmFlash = false;

const setAlarmSoundActive = async (active) => {
  if (!alarmAudio) return;
  if (active === alarmAudioActive && !alarmAudioOneShot) return;
  alarmAudioActive = active;
  if (active) {
    try {
      alarmAudioOneShot = false;
      await alarmAudio.play();
    } catch {
      // Ignore autoplay restrictions.
    }
  } else {
    alarmAudio.pause();
    alarmAudio.currentTime = 0;
  }
};

const playAlarmSoundOnce = async () => {
  if (!alarmAudio) return;
  alarmAudioOneShot = true;
  alarmAudio.loop = false;
  try {
    await alarmAudio.play();
  } catch {
    // Ignore autoplay restrictions.
  } finally {
    alarmAudio.loop = true;
    alarmAudioOneShot = false;
  }
};

const shouldPlayRestoreSound = (logs) => {
  let lastAlarm = null;
  let lastRestore = null;
  let lastDisarm = null;
  let lastArm = null;
  let restoreLogKey = null;
  logs.forEach((log) => {
    const ts = getLogTimestamp(log);
    if (!ts) return;
    const text = log.text ?? '';
    if (log.type === 'alarm') {
      if (!lastAlarm || ts > lastAlarm) lastAlarm = ts;
    } else if (log.type === 'restore' && isRestoreLogText(text)) {
      if (!lastRestore || ts > lastRestore) {
        lastRestore = ts;
        restoreLogKey = `alarmRestorePlayed:${state.selectedSpaceId}:${ts}:${text}`;
      }
    } else if (log.type === 'security' && isDisarmLogText(text)) {
      if (!lastDisarm || ts > lastDisarm) lastDisarm = ts;
    } else if (log.type === 'security' && isArmLogText(text)) {
      if (!lastArm || ts > lastArm) lastArm = ts;
    }
  });
  if (!lastAlarm || !lastRestore || !restoreLogKey) return null;
  const lastClear = Math.max(lastDisarm ?? 0, lastArm ?? 0);
  if (lastRestore <= lastAlarm) return null;
  if (lastRestore <= lastClear) return null;
  if (localStorage.getItem(restoreLogKey)) return null;
  localStorage.setItem(restoreLogKey, String(Date.now()));
  return restoreLogKey;
};

const getDeviceTypeToken = (type) => {
  const raw = String(type ?? '').trim().toLowerCase();
  if (['hub_extension', 'hub-extension', 'hub extension', 'hubextension', 'extension'].includes(raw)) {
    return 'hub_extension';
  }
  if (raw === 'output_light' || raw === 'output light') return 'output-light';
  return raw;
};

const deviceIcon = (type) => {
  const token = getDeviceTypeToken(type);
  const base = 'fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"';
  switch (token) {
    case 'zone':
      return `
        <svg viewBox=\"0 0 24 24\" ${base} aria-hidden=\"true\">
          <circle cx=\"12\" cy=\"12\" r=\"2.5\" />
          <path d=\"M4.5 12a7.5 7.5 0 0 1 3.2-6.1\" />
          <path d=\"M19.5 12a7.5 7.5 0 0 0-3.2-6.1\" />
          <path d=\"M4.5 12a7.5 7.5 0 0 0 3.2 6.1\" />
          <path d=\"M19.5 12a7.5 7.5 0 0 1-3.2 6.1\" />
        </svg>
      `;
    case 'siren':
      return `
        <svg viewBox=\"0 0 24 24\" ${base} aria-hidden=\"true\">
          <path d=\"M7 16a5 5 0 0 1 10 0\" />
          <path d=\"M6 16h12\" />
          <path d=\"M8.5 8.5a5 5 0 0 1 7 0\" />
          <path d=\"M12 5v2\" />
        </svg>
      `;
    case 'output-light':
      return `
        <svg viewBox=\"0 0 24 24\" ${base} aria-hidden=\"true\">
          <path d=\"M9 18h6\" />
          <path d=\"M8 9a4 4 0 1 1 8 0c0 2-1.1 2.6-2 4h-4c-.9-1.4-2-2-2-4z\" />
          <path d=\"M10 21h4\" />
        </svg>
      `;
    case 'reader':
      return `
        <svg viewBox=\"0 0 24 24\" ${base} aria-hidden=\"true\">
          <rect x=\"6\" y=\"3.5\" width=\"12\" height=\"17\" rx=\"2\" />
          <path d=\"M9 8h6\" />
          <path d=\"M9 12h6\" />
          <path d=\"M9 16h4\" />
        </svg>
      `;
    case 'key':
      return `
        <svg viewBox=\"0 0 24 24\" ${base} aria-hidden=\"true\">
          <circle cx=\"8.5\" cy=\"12\" r=\"3\" />
          <path d=\"M11.5 12h8\" />
          <path d=\"M16 12v3\" />
          <path d=\"M18.5 12v2\" />
        </svg>
      `;
    case 'hub':
      return `
        <svg viewBox=\"0 0 24 24\" ${base} aria-hidden=\"true\">
          <rect x=\"4\" y=\"4\" width=\"16\" height=\"6\" rx=\"2\" />
          <rect x=\"4\" y=\"14\" width=\"16\" height=\"6\" rx=\"2\" />
          <path d=\"M8 7h0\" />
          <path d=\"M8 17h0\" />
        </svg>
      `;
    case 'hub_extension':
      return `
        <svg viewBox=\"0 0 24 24\" ${base} aria-hidden=\"true\">
          <path d=\"M8 7h8v4a4 4 0 0 1-8 0z\" />
          <path d=\"M12 3v4\" />
          <path d=\"M10 19h4\" />
          <path d=\"M9 21h6\" />
        </svg>
      `;
    default:
      return `
        <svg viewBox=\"0 0 24 24\" ${base} aria-hidden=\"true\">
          <rect x=\"5\" y=\"5\" width=\"14\" height=\"14\" rx=\"3\" />
          <path d=\"M9 12h6\" />
        </svg>
      `;
  }
};

const objectList = document.getElementById('userObjectList');
const spaceIdEl = document.getElementById('userSpaceName');
const spaceStateEl = document.getElementById('userSpaceState');
const spaceMetaEl = document.getElementById('userSpaceMeta');
const deviceList = document.getElementById('userDeviceList');
const deviceDetails = document.getElementById('userDeviceDetails');
const logTable = document.getElementById('userLogTable');
const logFilters = document.querySelectorAll('#userLogFilters .chip');
const chipActions = document.querySelectorAll('.status-actions .chip');
const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.panel');
const avatarButton = document.getElementById('avatarButton');
const profileDropdown = document.getElementById('profileDropdown');
const profileNickname = document.getElementById('profileNickname');
const profileNicknameChange = document.getElementById('profileNicknameChange');
const profileTimezone = document.getElementById('profileTimezone');
const profileLanguage = document.getElementById('profileLanguage');
const profileLogout = document.getElementById('profileLogout');
const switchToPro = document.getElementById('switchToPro');
const logMoreButton = document.getElementById('userLogMore');
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
    'user.title': 'Режим пользователя',
    'user.subtitle': 'Охрана и журнал событий',
    'user.tabs.equipment': 'Оборудование',
    'user.tabs.log': 'Лог',
    'user.equipment.title': 'Оборудование',
    'user.log.title': 'Лог событий',
    'user.log.filters.all': 'Все',
    'user.log.filters.security': 'Охранные',
    'user.log.filters.access': 'Доступ',
    'user.log.filters.system': 'Система',
    'user.actions.arm': 'Под охрану',
    'user.actions.disarm': 'С охраны',
    'user.empty.devices': 'Нет устройств',
    'user.empty.logs': 'Нет событий',
    'user.object.hubOffline': 'Хаб не в сети',
    'user.object.label.hub': 'Хаб',
    'log.actions.more': 'Показать ещё',
    'status.armed': 'Под охраной',
    'status.disarmed': 'Снято с охраны',
    'status.night': 'Ночной режим',
    'status.partial': 'Частично под охраной',
    'status.online': 'В сети',
    'status.offline': 'Не в сети',
    'status.normal': 'Норма',
    'user.groups.manage': 'Управление',
    'user.groups.manageTitle': 'Управление группами',
    'user.groups.arm': 'Под охрану',
    'user.groups.disarm': 'С охраны',
    'user.groups.noGroups': 'Нет групп',
    'profile.title': 'Профиль',
    'profile.nickname': 'Игровой ник',
    'profile.nickname.change': 'Сменить',
    'profile.timezone': 'Часовой пояс',
    'profile.language': 'Язык',
    'profile.switchPro': 'Перейти на PRO',
    'profile.logout': 'Выйти',
    'device.type': 'Тип',
    'device.side': 'Сторона',
    'device.keyMasked': 'Ключ: *****',
    'common.close': 'Закрыть',
    'common.cancel': 'Отмена',
    'common.confirm': 'Подтвердить',
    'common.actionConfirmTitle': 'Подтвердите действие',
    'user.pageTitle': 'Minecraft Security System — Режим пользователя',
  },
  'en-US': {
    'user.title': 'User mode',
    'user.subtitle': 'Security and event log',
    'user.tabs.equipment': 'Equipment',
    'user.tabs.log': 'Log',
    'user.equipment.title': 'Equipment',
    'user.log.title': 'Event log',
    'user.log.filters.all': 'All',
    'user.log.filters.security': 'Security',
    'user.log.filters.access': 'Access',
    'user.log.filters.system': 'System',
    'user.actions.arm': 'Arm',
    'user.actions.disarm': 'Disarm',
    'user.empty.devices': 'No devices',
    'user.empty.logs': 'No events',
    'user.object.hubOffline': 'Hub offline',
    'user.object.label.hub': 'Hub',
    'log.actions.more': 'Show more',
    'status.armed': 'Armed',
    'status.disarmed': 'Disarmed',
    'status.night': 'Night mode',
    'status.partial': 'Partially armed',
    'status.online': 'Online',
    'status.offline': 'Offline',
    'status.normal': 'Normal',
    'user.groups.manage': 'Manage',
    'user.groups.manageTitle': 'Manage groups',
    'user.groups.arm': 'Arm',
    'user.groups.disarm': 'Disarm',
    'user.groups.noGroups': 'No groups',
    'profile.title': 'Profile',
    'profile.nickname': 'Game nickname',
    'profile.nickname.change': 'Change',
    'profile.timezone': 'Time zone',
    'profile.language': 'Language',
    'profile.switchPro': 'Go to PRO',
    'profile.logout': 'Sign out',
    'device.type': 'Type',
    'device.side': 'Side',
    'device.keyMasked': 'Key: *****',
    'common.close': 'Close',
    'common.cancel': 'Cancel',
    'common.confirm': 'Confirm',
    'common.actionConfirmTitle': 'Confirm action',
    'user.pageTitle': 'Minecraft Security System — User mode',
  },
};

const statusTone = {
  armed: 'status--armed',
  disarmed: 'status--disarmed',
  night: 'status--night',
  partial: 'status--partial',
};

const statusKeys = new Set([
  'armed',
  'disarmed',
  'night',
  'partial',
  'online',
  'offline',
  'normal',
]);

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
  return aliases[lower] ?? (statusKeys.has(lower) ? lower : raw);
};

const getStatusLabel = (status) => {
  if (!status) return '—';
  const normalized = normalizeStatusValue(status);
  const key = `status.${normalized}`;
  const translated = t(key);
  if (!translated || translated === key) {
    return normalized;
  }
  return translated;
};

const applyTranslations = () => {
  const dict = translations[state.language] ?? translations.ru;
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const key = node.dataset.i18n;
    if (dict[key]) {
      node.textContent = dict[key];
    }
  });
  if (dict['user.pageTitle']) {
    document.title = dict['user.pageTitle'];
  }
};

const t = (key) => translations[state.language]?.[key] ?? translations.ru[key] ?? key;

const getAuthToken = () => localStorage.getItem('authToken');

const apiFetch = async (path, options = {}) => {
  const token = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers ?? {}),
  };
  const response = await fetch(path, { ...options, headers });
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
    throw new Error(payload.error ?? `API error: ${response.status}`);
  }
  return response.json();
};

const loadProfileSettings = () => {
  const raw = localStorage.getItem('profileSettings');
  if (!raw) {
    return { language: detectBrowserLanguage() };
  }
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const saveProfileSettings = (settings) => {
  localStorage.setItem('profileSettings', JSON.stringify(settings));
};

const applyProfileSettings = (settings) => {
  state.language = settings.language ?? state.language;
  state.timezone = settings.timezone ?? state.timezone;
  state.avatarUrl = settings.avatarUrl ?? state.avatarUrl;
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
    state.role = payload.user.role ?? state.role;
    state.lastNicknameChangeAt = payload.user?.last_nickname_change_at ?? null;
    state.avatarUrl = payload.user.discord_avatar_url ?? state.avatarUrl;
    saveProfileSettings({
      nickname: payload.user.minecraft_nickname ?? '',
      language: state.language,
      timezone: state.timezone,
      avatarUrl: state.avatarUrl,
    });
    setAvatar(state.avatarUrl);
  } catch {
    // ignore
  }
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
      const date = new Date(lockUntil);
      const locale = state.language === 'en-US' ? 'en-US' : 'ru-RU';
      const timestamp = `${date.toLocaleDateString(locale)} ${date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`;
      profileNicknameChange.title = translateMessage(`Смена доступна после ${timestamp}`);
    } else {
      profileNicknameChange.removeAttribute('title');
    }
  }
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

const getLogTimestamp = (log) => {
  if (log.createdAtMs) return log.createdAtMs;
  const raw = log.createdAt ?? log.created_at;
  if (!raw) return null;
  const parsed = new Date(`${raw}Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getTime();
};

const isDisarmLogText = (text) => (
  text === 'Объект снят с охраны'
  || (text.startsWith('Группа ') && text.includes(' снята с охраны'))
  || text.startsWith('Снятие с охраны')
  || (text.startsWith('Снятие группы ') && text.includes(' ключом'))
);

const isRestoreLogText = (text) => text.startsWith('Восстановление шлейфа');

const isArmLogText = (text) => (
  text === 'Объект поставлен под охрану'
  || (text.startsWith('Группа ') && text.includes(' поставлена под охрану'))
  || text.startsWith('Постановка на охрану')
  || (text.startsWith('Постановка группы ') && text.includes(' ключом'))
);

const isAlarmActive = (logs) => {
  if (!logs?.length) return false;
  let lastAlarm = null;
  let lastRestore = null;
  let lastDisarm = null;
  let lastArm = null;
  let lastRestoreOnly = null;
  logs.forEach((log) => {
    const ts = getLogTimestamp(log);
    if (!ts) return;
    const text = log.text ?? '';
    if (log.type === 'alarm') {
      if (!lastAlarm || ts > lastAlarm) lastAlarm = ts;
    } else if (log.type === 'restore') {
      if (!lastRestore || ts > lastRestore) lastRestore = ts;
      if (!lastRestoreOnly || ts > lastRestoreOnly) lastRestoreOnly = ts;
    } else if (log.type === 'security' && isDisarmLogText(text)) {
      if (!lastDisarm || ts > lastDisarm) lastDisarm = ts;
    } else if (log.type === 'security' && isArmLogText(text)) {
      if (!lastArm || ts > lastArm) lastArm = ts;
    }
  });
  if (!lastAlarm) return false;
  const lastClear = Math.max(lastRestore ?? 0, lastDisarm ?? 0, lastArm ?? 0);
  if (!lastClear) return true;
  return lastAlarm > lastClear;
};

const hasActiveAlarmFlash = (spaceId) => {
  const prefix = `logFlash:user:${spaceId}:`;
  for (const [key, expiresAt] of logFlashActive.entries()) {
    if (key.startsWith(prefix) && expiresAt > Date.now()) {
      return true;
    }
  }
  return false;
};

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

  const settings = loadProfileSettings();
  applyProfileSettings(settings);
  setAvatar(state.avatarUrl);
  if (profileNickname) profileNickname.value = settings.nickname ?? '';
  let confirmedNickname = settings.nickname ?? '';
  if (profileTimezone) {
    const desired = settings.timezone ?? 'UTC';
    const option = profileTimezone.querySelector(`option[value="${desired}"]`);
    profileTimezone.value = option ? desired : 'UTC';
    if (!option) {
      saveProfileSettings({ ...settings, timezone: 'UTC', avatarUrl: state.avatarUrl });
      state.timezone = 'UTC';
    }
  }
  if (profileLanguage) profileLanguage.value = settings.language ?? 'ru';
  await syncProfileSettings();
  const syncedSettings = loadProfileSettings();
  if (profileNickname) profileNickname.value = syncedSettings.nickname ?? '';
  confirmedNickname = syncedSettings.nickname ?? confirmedNickname;
  applyTranslations();
  updateNicknameControls();

  profileNickname?.addEventListener('input', (event) => {
    saveProfileSettings({ ...loadProfileSettings(), nickname: event.target.value, avatarUrl: state.avatarUrl });
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
        },
        body: JSON.stringify({ minecraft_nickname: nextNickname }),
      });
      if (response.ok) {
        const payload = await response.json().catch(() => ({}));
        confirmedNickname = payload.user?.minecraft_nickname ?? nextNickname;
        state.lastNicknameChangeAt = payload.user?.last_nickname_change_at ?? null;
        profileNickname.value = confirmedNickname;
        saveProfileSettings({ ...loadProfileSettings(), nickname: confirmedNickname, avatarUrl: state.avatarUrl });
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
      saveProfileSettings({ ...loadProfileSettings(), nickname: confirmedNickname, avatarUrl: state.avatarUrl });
    } catch {
      profileNickname.value = confirmedNickname;
      saveProfileSettings({ ...loadProfileSettings(), nickname: confirmedNickname, avatarUrl: state.avatarUrl });
    }
  });
  profileTimezone?.addEventListener('change', (event) => {
    saveProfileSettings({ ...loadProfileSettings(), timezone: event.target.value, avatarUrl: state.avatarUrl });
    state.timezone = event.target.value;
    fetch('/api/auth/me', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('authToken') ?? ''}`,
      },
      body: JSON.stringify({ timezone: event.target.value }),
    }).catch(() => null);
    loadSpace(state.selectedSpaceId).catch(() => null);
  });
  profileLanguage?.addEventListener('change', (event) => {
    saveProfileSettings({ ...loadProfileSettings(), language: event.target.value, avatarUrl: state.avatarUrl });
    state.language = event.target.value;
    fetch('/api/auth/me', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('authToken') ?? ''}`,
      },
      body: JSON.stringify({ language: event.target.value }),
    }).catch(() => null);
    applyTranslations();
  });
  if (switchToPro) {
    switchToPro.addEventListener('click', () => {
      window.location.href = 'index.html';
    });
  }
  profileLogout?.addEventListener('click', async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    localStorage.removeItem('authToken');
    localStorage.removeItem('profileSettings');
    toggle(false);
    window.location.href = 'login.html';
  });
};

const renderSpaces = (spaces) => {
  objectList.innerHTML = '';
  spaces.forEach((space) => {
    const item = document.createElement('button');
    const hubOfflineLabel = space.hubOnline === false
      ? `<div class="object-item__hub-offline">${t('user.object.hubOffline')}</div>`
      : '';
    const isSelected = space.id === state.selectedSpaceId;
    const alarmClass = isSelected && currentAlarmActive ? 'object-item--alarm' : '';
    const alarmFlashClass = isSelected && currentAlarmFlash ? 'object-item--alarm-flash' : '';
    item.className = `object-item ${isSelected ? 'object-item--active' : ''} ${alarmClass} ${alarmFlashClass}`;
    item.innerHTML = `
      <div class="object-item__title">${escapeHtml(space.name)}</div>
      <div class="object-item__meta">${escapeHtml(space.id)}</div>
      ${hubOfflineLabel}
    `;
    item.addEventListener('click', () => {
      state.selectedSpaceId = space.id;
      localStorage.setItem('userSelectedSpace', space.id);
      renderSpaces(spaces);
      loadSpace(space.id).catch(() => null);
    });
    objectList.appendChild(item);
  });
};

const renderStatus = (space) => {
  if (spaceIdEl) {
    spaceIdEl.textContent = space.name ?? space.id;
  }
  const statusKey = `status.${space.status}`;
  const statusLabel = t(statusKey);
  spaceStateEl.textContent = (!statusLabel || statusLabel === statusKey) ? space.status : statusLabel;
  spaceStateEl.className = `status-card__state ${statusTone[space.status] ?? ''}`;
  const serverLabel = space.server ?? '—';
  const cityLabel = space.city ?? '—';
  spaceMetaEl.textContent = `${space.address ?? '—'} • ${serverLabel} • ${cityLabel}`;
};

const renderDevices = (devices) => {
  const space = currentSpace ?? spacesCache.find((item) => item.id === state.selectedSpaceId);
  const allowedGroups = new Set((space?.groups ?? []).map((group) => group.id));

  deviceList.innerHTML = '';
  if (!devices.length) {
    deviceList.innerHTML = `<div class="empty-state">${t('user.empty.devices')}</div>`;
    deviceDetails.innerHTML = '';
    return;
  }

  devices.forEach((device) => {
    const statusText = device.type === 'zone' || device.type === 'hub'
      ? getStatusLabel(device.status)
      : '';
    const button = document.createElement('button');
    button.className = `device-item ${device.id === state.selectedDeviceId ? 'device-item--active' : ''}`;
    const baseName = device.type === 'hub' ? t('user.object.label.hub') : device.name;
    const displayName = device.type === 'key' ? t('device.keyMasked') : baseName;
    const deviceTypeToken = getDeviceTypeToken(device.type);
    button.innerHTML = `
      <div class="device-item__content">
        <div class="device-avatar" data-type="${deviceTypeToken}">${deviceIcon(device.type)}</div>
        <div>
          <div class="device-item__title">${escapeHtml(displayName)}</div>
          <div class="device-item__meta">${escapeHtml(device.room ?? '—')}</div>
        </div>
      </div>
      <span class="device-item__status">${escapeHtml(statusText)}</span>
    `;
    button.addEventListener('click', () => {
      state.selectedDeviceId = device.id;
      renderDevices(devices);
      const keyGroups = device.config?.groups ?? [];
      const hasGroupAccess = keyGroups.some((groupId) => allowedGroups.has(groupId));
      const baseDetailTitle = device.type === 'hub' ? t('user.object.label.hub') : device.name;
      const detailTitle = device.type === 'key' && !hasGroupAccess ? t('device.keyMasked') : baseDetailTitle;
      deviceDetails.innerHTML = `
        <div class="device-details__header">
          <div class="device-avatar" data-type="${deviceTypeToken}">${deviceIcon(device.type)}</div>
          <div>
            <div class="device-details__title">${escapeHtml(detailTitle)}</div>
            <div class="device-details__meta">${escapeHtml(device.room ?? '—')}</div>
          </div>
        </div>
        <div class="device-details__stats">
          <div class="stat">
            <span>${t('device.type')}</span>
            <strong>${escapeHtml(device.type)}</strong>
          </div>
          <div class="stat">
            <span>${t('device.side')}</span>
            <strong>${escapeHtml(device.side ?? '—')}</strong>
          </div>
        </div>
      `;
    });
    deviceList.appendChild(button);
  });

  if (!state.selectedDeviceId) {
    state.selectedDeviceId = devices[0].id;
  }
};

const translateLogText = (text) => {
  if (state.language !== 'en-US' || !text) return text;
  const normalizedText = String(text).replace(/&#39;/g, "'");
  const [firstLine, ...restLines] = normalizedText.split('\n');
  const hubHeaderTranslations = [
    { pattern: /^Событие хаба: (.+)$/u, replacement: 'Hub event: $1' },
    { pattern: /^Событие модуля расширения: (.+)$/u, replacement: 'Hub extension event: $1' },
    { pattern: /^hub_event: (.+)$/iu, replacement: 'Hub event: $1' },
    { pattern: /^hub_extension_event: (.+)$/iu, replacement: 'Hub extension event: $1' },
  ];
  for (const entry of hubHeaderTranslations) {
    if (entry.pattern.test(firstLine)) {
      const translatedHeader = firstLine.replace(entry.pattern, entry.replacement);
      return [translatedHeader, ...restLines].join('\n');
    }
  }
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
    { pattern: /^Событие хаба: (.+)$/, replacement: 'Hub event: $1' },
    { pattern: /^Событие модуля расширения: (.+)$/, replacement: 'Hub extension event: $1' },
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
    { pattern: /^Тревога шлейфа: (.+) \[(.+)\]$/, replacement: 'Zone alarm: $1 [$2]' },
    { pattern: /^Восстановление шлейфа: (.+) \[(.+)\]$/, replacement: 'Zone restored: $1 [$2]' },
  ];
  for (const entry of translations) {
    if (entry.pattern.test(normalizedText)) {
      return normalizedText.replace(entry.pattern, entry.replacement);
    }
  }
  return normalizedText;
};

const maskKeyNames = (text) => {
  if (!text) return text;
  return text.replace(/KEY-[A-Za-z0-9-]+/g, 'KEY-******');
};

const filterLogs = (logs) => {
  const withoutHubEvents = logs.filter((log) => log.type !== 'hub_raw' && log.type !== 'hub');
  if (state.logFilter === 'all') {
    return withoutHubEvents;
  }
  if (state.logFilter === 'security') {
    return withoutHubEvents.filter((log) => log.type === 'security' || log.type === 'alarm' || log.type === 'restore');
  }
  return withoutHubEvents.filter((log) => log.type === state.logFilter);
};

const renderLogs = async (logs, { flashSince } = {}) => {
  const filtered = filterLogs(logs)
    .filter((log) => !/^(Событие хаба|Событие модуля расширения|hub_event|hub_extension_event):/u.test(log.text ?? ''));
  logTable.innerHTML = '';
  if (!filtered.length) {
    logTable.innerHTML = `<div class="empty-state">${t('user.empty.logs')}</div>`;
    logMoreButton?.classList.add('hidden');
    currentAlarmActive = isAlarmActive(logs);
    currentAlarmFlash = hasActiveAlarmFlash(state.selectedSpaceId);
    setAlarmSoundActive(currentAlarmActive).catch(() => null);
    renderSpaces(spacesCache);
    return;
  }
  filtered.forEach((log) => {
    const row = document.createElement('div');
    const decodedText = decodeHtmlEntities(log.text);
    const translated = maskKeyNames(translateLogText(decodedText));
    const isHubOffline = decodedText === 'Хаб не в сети' || translated === 'Hub offline';
    const isExtensionOffline = decodedText === 'Модуль расширения не в сети' || translated === 'Hub extension offline';
    const logTimestamp = getLogTimestamp(log);
    const flashKey = `logFlash:user:${state.selectedSpaceId}:${logTimestamp ?? log.time}:${log.text}`;
    const hasSeen = localStorage.getItem(flashKey);
    if (log.type === 'alarm' && logTimestamp && flashSince && logTimestamp > flashSince && !hasSeen) {
      localStorage.setItem(flashKey, String(Date.now()));
      logFlashActive.set(flashKey, Date.now() + FLASH_DURATION_MS);
    }
    row.className = `log-row ${log.type === 'alarm' ? 'log-row--alarm' : ''} ${(isHubOffline || isExtensionOffline) ? 'log-row--hub-offline' : ''}`;
    const timeLabel = escapeHtml(formatLogTime(logTimestamp) ?? log.time);
    const text = escapeHtml(translated);
    const whoLabel = escapeHtml(log.who);
    row.innerHTML = `
      <span>${timeLabel}</span>
      <span>${text}</span>
      <span class="muted">${whoLabel}</span>
    `;
    logTable.appendChild(row);
  });
  logMoreButton?.classList.toggle('hidden', !state.logsHasMore);
  const nextAlarmActive = isAlarmActive(logs);
  const restoreKey = shouldPlayRestoreSound(logs);
  if (!nextAlarmActive && restoreKey) {
    await playAlarmSoundOnce();
  }
  currentAlarmActive = nextAlarmActive;
  currentAlarmFlash = hasActiveAlarmFlash(state.selectedSpaceId);
  setAlarmSoundActive(currentAlarmActive).catch(() => null);
  renderSpaces(spacesCache);
};

const loadSpace = async (spaceId, { refreshLogs = true } = {}) => {
  const space = await apiFetch(`/api/spaces/${spaceId}`);
  renderStatus(space);
  renderStatusActions(space);
  renderDevices(space.devices ?? []);
  if (refreshLogs) {
    await loadLogs(true);
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
  if (!state.selectedSpaceId) return;
  let flashSince = null;
  if (reset) {
    const previousTimestamp = state.lastLogTimestamp;
    const { logs, hasMore } = await fetchLogsChunked(
      `/api/spaces/${state.selectedSpaceId}/logs`,
      state.logsLimit,
    );
    state.logs = logs;
    state.logsOffset = logs.length;
    state.logsHasMore = hasMore;
    const newestTimestamp = getLogTimestamp(logs[0]) ?? null;
    state.lastLogTimestamp = newestTimestamp ?? state.lastLogTimestamp;
    if (previousTimestamp) {
      flashSince = previousTimestamp;
    }
  } else {
    const resp = await apiFetch(`/api/spaces/${state.selectedSpaceId}/logs?limit=200&offset=${state.logsOffset}`);
    const logs = resp.logs ?? [];
    state.logs = [...state.logs, ...logs];
    state.logsOffset += logs.length;
    state.logsLimit = state.logsOffset;
    state.logsHasMore = Boolean(resp.hasMore);
  }
  await renderLogs(state.logs, { flashSince });
};

const loadSpaces = async () => {
  spacesCache = await apiFetch('/api/spaces');
  if (!spacesCache.length) return;
  const saved = localStorage.getItem('userSelectedSpace');
  state.selectedSpaceId = saved && spacesCache.some((space) => space.id === saved) ? saved : spacesCache[0].id;
  renderSpaces(spacesCache);
  await loadSpace(state.selectedSpaceId);
};

const refreshUserData = async () => {
  const spaces = await apiFetch('/api/spaces');
  spacesCache = spaces;
  if (!spacesCache.length) return;
  if (!state.selectedSpaceId || !spacesCache.some((space) => space.id === state.selectedSpaceId)) {
    state.selectedSpaceId = spacesCache[0].id;
    localStorage.setItem('userSelectedSpace', state.selectedSpaceId);
  }
  renderSpaces(spacesCache);
  await loadSpace(state.selectedSpaceId, { refreshLogs: true });
};

const groupsManageModal = document.getElementById('groupsManageModal');
const groupsManageList = document.getElementById('groupsManageList');
const closeGroupsManageModalBtn = document.getElementById('closeGroupsManageModal');
const groupsManageCloseBtn = document.getElementById('groupsManageClose');

const openGroupsManage = () => {
  if (!groupsManageModal) return;
  groupsManageModal.classList.add('modal--open');
  groupsManageModal.setAttribute('aria-hidden', 'false');
};

const closeGroupsManage = () => {
  if (!groupsManageModal) return;
  groupsManageModal.classList.remove('modal--open');
  groupsManageModal.setAttribute('aria-hidden', 'true');
};

if (closeGroupsManageModalBtn) {
  closeGroupsManageModalBtn.addEventListener('click', () => {
    closeGroupsManage();
  });
}
if (groupsManageCloseBtn) {
  groupsManageCloseBtn.addEventListener('click', () => {
    closeGroupsManage();
  });
}
if (groupsManageModal) {
  groupsManageModal.addEventListener('click', (event) => {
    if (event.target === groupsManageModal) {
      closeGroupsManage();
    }
  });
}

let currentSpace = null;

const renderStatusActions = (space) => {
  currentSpace = space;
  const actionsContainer = document.querySelector('.status-actions');
  if (!actionsContainer) return;
  if (space.groupsEnabled) {
    actionsContainer.innerHTML = `<button class="chip chip--info" id="openGroupsManage">${t('user.groups.manage')}</button>`;
  } else {
    actionsContainer.innerHTML = `
      <button class="chip chip--danger" data-action="arm">${t('user.actions.arm')}</button>
      <button class="chip chip--success" data-action="disarm">${t('user.actions.disarm')}</button>
    `;
    rebindUserChipActions();
  }
};

document.addEventListener('click', (event) => {
  const btn = event.target.closest('#openGroupsManage');
  if (!btn) return;
  const space = currentSpace
    ?? spacesCache.find((item) => item.id === state.selectedSpaceId);
  if (!space?.groupsEnabled) return;
  renderUserGroupsModal(space);
  openGroupsManage();
});

const rebindUserChipActions = () => {
  document.querySelectorAll('.status-actions .chip[data-action]').forEach((chip) => {
    chip.addEventListener('click', async () => {
      if (!state.selectedSpaceId) return;
      if (chip.dataset.action === 'arm') {
        await apiFetch(`/api/spaces/${state.selectedSpaceId}/arm`, { method: 'POST' });
      } else {
        await apiFetch(`/api/spaces/${state.selectedSpaceId}/disarm`, { method: 'POST' });
      }
      await loadSpace(state.selectedSpaceId);
    });
  });
};

const renderUserGroupsModal = (space) => {
  if (!groupsManageList) return;
  const groups = space.groups ?? [];
  if (!groups.length) {
    groupsManageList.innerHTML = `<div class="empty-state">${t('user.groups.noGroups')}</div>`;
    return;
  }
  groupsManageList.innerHTML = groups.map((group) => {
    const statusLabel = t(`status.${group.status}`) ?? group.status;
    const statusClass = statusTone[group.status] ?? '';
    return `
      <div class="group-manage-item">
        <div class="group-manage-item__info">
          <span class="group-manage-item__name">${escapeHtml(group.name)}</span>
          <span class="group-manage-item__status ${statusClass}">${escapeHtml(statusLabel)}</span>
        </div>
        <div class="group-manage-item__actions">
          ${group.status === 'armed'
            ? `<button class="button button--ghost" data-group-disarm="${group.id}">${t('user.groups.disarm')}</button>`
            : `<button class="button button--primary" data-group-arm="${group.id}">${t('user.groups.arm')}</button>`}
        </div>
      </div>
    `;
  }).join('');

  groupsManageList.querySelectorAll('[data-group-arm]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const groupId = btn.dataset.groupArm;
      try {
        const updated = await apiFetch(`/api/spaces/${space.id}/groups/${groupId}/arm`, { method: 'POST' });
        Object.assign(space, updated);
        renderStatus(space);
        renderStatusActions(space);
        renderUserGroupsModal(space);
      } catch {
        // Ignore
      }
    });
  });

  groupsManageList.querySelectorAll('[data-group-disarm]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const groupId = btn.dataset.groupDisarm;
      try {
        const updated = await apiFetch(`/api/spaces/${space.id}/groups/${groupId}/disarm`, { method: 'POST' });
        Object.assign(space, updated);
        renderStatus(space);
        renderStatusActions(space);
        renderUserGroupsModal(space);
      } catch {
        // Ignore
      }
    });
  });
};

chipActions.forEach((chip) => {
  chip.addEventListener('click', async () => {
    if (!state.selectedSpaceId) return;
    if (chip.dataset.action === 'arm') {
      await apiFetch(`/api/spaces/${state.selectedSpaceId}/arm`, { method: 'POST' });
    } else {
      await apiFetch(`/api/spaces/${state.selectedSpaceId}/disarm`, { method: 'POST' });
    }
    await loadSpace(state.selectedSpaceId);
  });
});

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((btn) => btn.classList.remove('tab--active'));
    panels.forEach((panel) => panel.classList.remove('panel--active'));
    tab.classList.add('tab--active');
    const target = document.getElementById(tab.dataset.tab);
    if (target) target.classList.add('panel--active');
  });
});

logFilters.forEach((button) => {
  button.addEventListener('click', async () => {
    if (!state.selectedSpaceId) return;
    logFilters.forEach((btn) => btn.classList.remove('chip--active'));
    button.classList.add('chip--active');
    state.logFilter = button.dataset.log ?? 'all';
    await loadLogs(true);
  });
});

logMoreButton?.addEventListener('click', () => {
  loadLogs(false).catch(() => null);
});

const init = async () => {
  if (!getAuthToken()) {
    window.location.href = 'login.html';
    return;
  }
  await initProfileMenu();
  await loadSpaces();
  setInterval(() => {
    if (state.selectedSpaceId) loadLogs(true).catch(() => null);
  }, 3000);
  setInterval(() => {
    refreshUserData().catch(() => null);
  }, 15000);
};

init().catch(() => null);
