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
  groups: [],
};

const detectBrowserLanguage = () => {
  const lang = navigator.language ?? 'ru';
  return lang.toLowerCase().startsWith('en') ? 'en-US' : 'ru';
};

let spacesCache = [];
const NICKNAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const objectList = document.getElementById('userObjectList');
const spaceIdEl = document.getElementById('userSpaceId');
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
const groupManageModal = document.getElementById('groupManageModal');
const groupManageList = document.getElementById('groupManageList');
const closeGroupManage = document.getElementById('closeGroupManage');

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
    'user.actions.manage': 'Управление',
    'user.groups.manageTitle': 'Управление группами',
    'user.groups.status.armed': 'Под охраной',
    'user.groups.status.disarmed': 'Снято с охраны',
    'user.groups.empty': 'Группы не созданы',
    'user.empty.devices': 'Нет устройств',
    'user.empty.logs': 'Нет событий',
    'user.object.hubOffline': 'Хаб не в сети',
    'log.actions.more': 'Показать ещё',
    'status.armed': 'Под охраной',
    'status.disarmed': 'Снято с охраны',
    'status.partial': 'Под охраной (частично)',
    'status.night': 'Ночной режим',
    'profile.title': 'Профиль',
    'profile.nickname': 'Игровой ник',
    'profile.nickname.change': 'Сменить',
    'profile.timezone': 'Часовой пояс',
    'profile.language': 'Язык',
    'profile.switchPro': 'Перейти на PRO',
    'profile.logout': 'Выйти',
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
    'user.actions.manage': 'Manage',
    'user.groups.manageTitle': 'Group control',
    'user.groups.status.armed': 'Armed',
    'user.groups.status.disarmed': 'Disarmed',
    'user.groups.empty': 'No groups created',
    'user.empty.devices': 'No devices',
    'user.empty.logs': 'No events',
    'user.object.hubOffline': 'Hub offline',
    'log.actions.more': 'Show more',
    'status.armed': 'Armed',
    'status.disarmed': 'Disarmed',
    'status.partial': 'Armed (partial)',
    'status.night': 'Night mode',
    'profile.title': 'Profile',
    'profile.nickname': 'Game nickname',
    'profile.nickname.change': 'Change',
    'profile.timezone': 'Time zone',
    'profile.language': 'Language',
    'profile.switchPro': 'Go to PRO',
    'profile.logout': 'Sign out',
    'user.pageTitle': 'Minecraft Security System — User mode',
  },
};

const statusTone = {
  armed: 'status--armed',
  disarmed: 'status--disarmed',
  partial: 'status--armed',
  night: 'status--night',
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

const getSpaceDisplayStatus = (space) => {
  if (space.groupMode) {
    return { label: t('status.partial'), tone: statusTone.partial };
  }
  const key = space.status;
  return { label: t(`status.${key}`) ?? key, tone: statusTone[key] ?? '' };
};

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
    item.className = `object-item ${space.id === state.selectedSpaceId ? 'object-item--active' : ''}`;
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
  spaceIdEl.textContent = space.id;
  const statusInfo = getSpaceDisplayStatus(space);
  spaceStateEl.textContent = statusInfo.label;
  spaceStateEl.className = `status-card__state ${statusInfo.tone}`;
  const serverLabel = space.server ?? '—';
  const cityLabel = space.city ?? '—';
  spaceMetaEl.textContent = `${space.address ?? '—'} • ${serverLabel} • ${cityLabel}`;
};

const updateStatusActions = (space) => {
  const manageButton = document.querySelector('.status-actions [data-action="manage"]');
  const armButton = document.querySelector('.status-actions [data-action="arm"]');
  const disarmButton = document.querySelector('.status-actions [data-action="disarm"]');
  const isGroupMode = Boolean(space.groupMode);
  manageButton?.classList.toggle('hidden', !isGroupMode);
  armButton?.classList.toggle('hidden', isGroupMode);
  disarmButton?.classList.toggle('hidden', isGroupMode);
};

const renderDevices = (devices) => {
  deviceList.innerHTML = '';
  if (!devices.length) {
    deviceList.innerHTML = `<div class="empty-state">${t('user.empty.devices')}</div>`;
    deviceDetails.innerHTML = '';
    return;
  }

  devices.forEach((device) => {
    const statusText = device.type === 'zone' || device.type === 'hub' ? (device.status ?? '—') : '';
    const button = document.createElement('button');
    button.className = `device-item ${device.id === state.selectedDeviceId ? 'device-item--active' : ''}`;
    button.innerHTML = `
      <div>
        <div class="device-item__title">${escapeHtml(device.name)}</div>
        <div class="device-item__meta">${escapeHtml(device.room ?? '—')}</div>
      </div>
      <span class="device-item__status">${escapeHtml(statusText)}</span>
    `;
    button.addEventListener('click', () => {
      state.selectedDeviceId = device.id;
      renderDevices(devices);
      deviceDetails.innerHTML = `
        <div class="detail-card">
          <h3>${escapeHtml(device.name)}</h3>
          <p>Тип: ${escapeHtml(device.type)}</p>
          <p>Сторона: ${escapeHtml(device.side ?? '—')}</p>
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
  ];
  for (const entry of translations) {
    if (entry.pattern.test(text)) {
      return text.replace(entry.pattern, entry.replacement);
    }
  }
  return text;
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

const renderLogs = (logs) => {
  const filtered = filterLogs(logs)
    .filter((log) => !/^Событие хаба/.test(log.text ?? ''));
  logTable.innerHTML = '';
  if (!filtered.length) {
    logTable.innerHTML = `<div class="empty-state">${t('user.empty.logs')}</div>`;
    logMoreButton?.classList.add('hidden');
    return;
  }
  filtered.forEach((log) => {
    const row = document.createElement('div');
    const translated = translateLogText(log.text);
    const isHubOffline = log.text === 'Хаб не в сети' || translated === 'Hub offline';
    const isExtensionOffline = log.text === 'Модуль расширения не в сети' || translated === 'Hub extension offline';
    row.className = `log-row ${log.type === 'alarm' ? 'log-row--alarm' : ''} ${(isHubOffline || isExtensionOffline) ? 'log-row--hub-offline' : ''}`;
    const timestamp = log.createdAtMs ?? (log.createdAt ? new Date(`${log.createdAt}Z`).getTime() : null);
    const timeLabel = escapeHtml(formatLogTime(timestamp) ?? log.time);
    const text = escapeHtml(translated);
    const groupLabel = log.groupName ? `<span class="log-group">${escapeHtml(log.groupName)}</span>` : '';
    const whoLabel = escapeHtml(log.who);
    row.innerHTML = `
      <span>${timeLabel}</span>
      <span>${groupLabel}${text}</span>
      <span class="muted">${whoLabel}</span>
    `;
    logTable.appendChild(row);
  });
  logMoreButton?.classList.toggle('hidden', !state.logsHasMore);
};

const renderGroupManageList = () => {
  if (!groupManageList) return;
  if (!state.groups.length) {
    groupManageList.innerHTML = `<div class="empty-state">${t('user.groups.empty')}</div>`;
    return;
  }
  groupManageList.innerHTML = '';
  state.groups.forEach((group) => {
    const card = document.createElement('div');
    card.className = 'group-card';
    card.innerHTML = `
      <div>
        <div class="group-card__title">${escapeHtml(group.name)}</div>
        <div class="group-card__meta">${group.armed ? t('user.groups.status.armed') : t('user.groups.status.disarmed')}</div>
      </div>
      <div class="group-card__actions">
        <button class="button button--ghost" data-action="arm">${t('user.actions.arm')}</button>
        <button class="button button--ghost" data-action="disarm">${t('user.actions.disarm')}</button>
      </div>
    `;
    card.querySelector('[data-action="arm"]')?.addEventListener('click', async () => {
      if (!state.selectedSpaceId) return;
      await apiFetch(`/api/spaces/${state.selectedSpaceId}/groups/${group.id}/arm`, { method: 'POST' });
      await loadSpace(state.selectedSpaceId);
    });
    card.querySelector('[data-action="disarm"]')?.addEventListener('click', async () => {
      if (!state.selectedSpaceId) return;
      await apiFetch(`/api/spaces/${state.selectedSpaceId}/groups/${group.id}/disarm`, { method: 'POST' });
      await loadSpace(state.selectedSpaceId);
    });
    groupManageList.appendChild(card);
  });
};

const loadGroupsForSpace = async (spaceId) => {
  const resp = await apiFetch(`/api/spaces/${spaceId}/groups`);
  state.groups = resp.groups ?? [];
  const cached = spacesCache.find((space) => space.id === spaceId);
  if (cached) cached.groups = state.groups;
  return state.groups;
};

const loadSpace = async (spaceId, { refreshLogs = true } = {}) => {
  const space = await apiFetch(`/api/spaces/${spaceId}`);
  renderStatus(space);
  updateStatusActions(space);
  renderDevices(space.devices ?? []);
  await loadGroupsForSpace(spaceId);
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
  if (reset) {
    const { logs, hasMore } = await fetchLogsChunked(
      `/api/spaces/${state.selectedSpaceId}/logs`,
      state.logsLimit,
    );
    state.logs = logs;
    state.logsOffset = logs.length;
    state.logsHasMore = hasMore;
  } else {
    const resp = await apiFetch(`/api/spaces/${state.selectedSpaceId}/logs?limit=200&offset=${state.logsOffset}`);
    const logs = resp.logs ?? [];
    state.logs = [...state.logs, ...logs];
    state.logsOffset += logs.length;
    state.logsLimit = state.logsOffset;
    state.logsHasMore = Boolean(resp.hasMore);
  }
  renderLogs(state.logs);
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

chipActions.forEach((chip) => {
  chip.addEventListener('click', async () => {
    if (!state.selectedSpaceId) return;
    if (chip.dataset.action === 'manage') {
      renderGroupManageList();
      groupManageModal?.classList.add('modal--open');
      return;
    }
    if (chip.dataset.action === 'arm') {
      await apiFetch(`/api/spaces/${state.selectedSpaceId}/arm`, { method: 'POST' });
    } else {
      await apiFetch(`/api/spaces/${state.selectedSpaceId}/disarm`, { method: 'POST' });
    }
    await loadSpace(state.selectedSpaceId);
  });
});

if (groupManageModal) {
  const closeGroupModal = () => groupManageModal.classList.remove('modal--open');
  closeGroupManage?.addEventListener('click', closeGroupModal);
  groupManageModal.addEventListener('click', (event) => {
    if (event.target === groupManageModal) {
      closeGroupModal();
    }
  });
}

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
    refreshUserData().catch(() => null);
  }, 5000);
};

init().catch(() => null);
