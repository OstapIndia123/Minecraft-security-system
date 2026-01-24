const state = {
  selectedSpaceId: null,
  selectedDeviceId: null,
  logFilter: 'all',
  language: 'ru',
  timezone: 'UTC',
  role: 'user',
  avatarUrl: '',
  lastNicknameChangeAt: null,
};

let spacesCache = [];
const NICKNAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const showBlockedScreen = () => {
  document.body.innerHTML = '<div class="blocked-screen">Вы были заблокированы.</div>';
};

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
    'status.armed': 'Под охраной',
    'status.disarmed': 'Снято с охраны',
    'status.night': 'Ночной режим',
    'profile.title': 'Профиль',
    'profile.nickname': 'Игровой ник',
    'profile.nickname.change': 'Сменить',
    'profile.timezone': 'Часовой пояс',
    'profile.language': 'Язык',
    'profile.switchPro': 'Перейти на PRO',
    'profile.logout': 'Выйти',
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
    'status.armed': 'Armed',
    'status.disarmed': 'Disarmed',
    'status.night': 'Night mode',
    'profile.title': 'Profile',
    'profile.nickname': 'Game nickname',
    'profile.nickname.change': 'Change',
    'profile.timezone': 'Time zone',
    'profile.language': 'Language',
    'profile.switchPro': 'Go to PRO',
    'profile.logout': 'Sign out',
  },
};

const statusTone = {
  armed: 'status--armed',
  disarmed: 'status--disarmed',
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
      showBlockedScreen();
      throw new Error('user_blocked');
    }
    throw new Error(payload.error ?? `API error: ${response.status}`);
  }
  return response.json();
};

const loadProfileSettings = () => {
  const raw = localStorage.getItem('profileSettings');
  if (!raw) return {};
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

  if (actionModalTitle) actionModalTitle.textContent = title;
  if (actionModalMessage) actionModalMessage.textContent = message;
  actionModalConfirm.textContent = confirmText;
  actionModalCancel.textContent = cancelText;

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
      profileNicknameChange.title = `Смена доступна после ${date.toLocaleDateString('ru-RU')} ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
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
      window.alert('Введите корректный ник.');
      return;
    }
    if (nextNickname === confirmedNickname) {
      window.alert('Ник уже установлен.');
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
      window.alert(errorMessage);
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
    item.className = `object-item ${space.id === state.selectedSpaceId ? 'object-item--active' : ''}`;
    item.innerHTML = `
      <div class="object-item__title">${escapeHtml(space.name)}</div>
      <div class="object-item__meta">${escapeHtml(space.id)}</div>
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
  spaceStateEl.textContent = t(`status.${space.status}`) ?? space.status;
  spaceStateEl.className = `status-card__state ${statusTone[space.status] ?? ''}`;
  const serverLabel = space.server ?? '—';
  const cityLabel = space.city ?? '—';
  spaceMetaEl.textContent = `${space.address ?? '—'} • ${serverLabel} • ${cityLabel}`;
};

const renderDevices = (devices) => {
  deviceList.innerHTML = '';
  if (!devices.length) {
    deviceList.innerHTML = `<div class="empty-state">${t('user.empty.devices')}</div>`;
    deviceDetails.innerHTML = '';
    return;
  }

  devices.forEach((device) => {
    const button = document.createElement('button');
    button.className = `device-item ${device.id === state.selectedDeviceId ? 'device-item--active' : ''}`;
    button.innerHTML = `
      <div>
        <div class="device-item__title">${escapeHtml(device.name)}</div>
        <div class="device-item__meta">${escapeHtml(device.room ?? '—')}</div>
      </div>
      <span class="device-item__status">${escapeHtml(device.status ?? '—')}</span>
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
    { pattern: /^Добавлено устройство: (.+)$/, replacement: 'Device added: $1' },
    { pattern: /^Удалено устройство: (.+)$/, replacement: 'Device removed: $1' },
    { pattern: /^Обновлено устройство: (.+)$/, replacement: 'Device updated: $1' },
    { pattern: /^Добавлен ключ: (.+)$/, replacement: 'Key added: $1' },
    { pattern: /^Удалён ключ: (.+)$/, replacement: 'Key removed: $1' },
    { pattern: /^Обновлён ключ: (.+)$/, replacement: 'Key updated: $1' },
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
    return;
  }
  filtered.forEach((log) => {
    const row = document.createElement('div');
    row.className = `log-row ${log.type === 'alarm' ? 'log-row--alarm' : ''}`;
    const timestamp = log.createdAtMs ?? (log.createdAt ? new Date(`${log.createdAt}Z`).getTime() : null);
    const timeLabel = escapeHtml(formatLogTime(timestamp) ?? log.time);
    const text = escapeHtml(translateLogText(log.text));
    const whoLabel = escapeHtml(log.who);
    row.innerHTML = `
      <span>${timeLabel}</span>
      <span>${text}</span>
      <span class="muted">${whoLabel}</span>
    `;
    logTable.appendChild(row);
  });
};

const loadSpace = async (spaceId) => {
  const space = await apiFetch(`/api/spaces/${spaceId}`);
  renderStatus(space);
  renderDevices(space.devices ?? []);
  const logs = await apiFetch(`/api/spaces/${spaceId}/logs`);
  renderLogs(logs);
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
  await loadSpace(state.selectedSpaceId);
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
    await loadSpace(state.selectedSpaceId);
  });
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
