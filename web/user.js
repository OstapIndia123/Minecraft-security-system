const state = {
  selectedSpaceId: null,
  selectedDeviceId: null,
  language: 'ru',
  timezone: 'UTC',
  role: 'user',
  avatarUrl: '',
};

let spacesCache = [];

const objectList = document.getElementById('userObjectList');
const spaceIdEl = document.getElementById('userSpaceId');
const spaceStateEl = document.getElementById('userSpaceState');
const spaceMetaEl = document.getElementById('userSpaceMeta');
const deviceList = document.getElementById('userDeviceList');
const deviceDetails = document.getElementById('userDeviceDetails');
const logTable = document.getElementById('userLogTable');
const chipActions = document.querySelectorAll('.status-actions .chip');
const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.panel');
const avatarButton = document.getElementById('avatarButton');
const profileDropdown = document.getElementById('profileDropdown');
const profileNickname = document.getElementById('profileNickname');
const profileTimezone = document.getElementById('profileTimezone');
const profileLanguage = document.getElementById('profileLanguage');
const profileLogout = document.getElementById('profileLogout');
const switchToPro = document.getElementById('switchToPro');
const avatarImages = document.querySelectorAll('[data-avatar]');
const avatarFallbacks = document.querySelectorAll('[data-avatar-fallback]');

const translations = {
  ru: {
    'user.title': 'Режим пользователя',
    'user.subtitle': 'Охрана и журнал событий',
    'user.tabs.equipment': 'Оборудование',
    'user.tabs.log': 'Лог',
    'user.equipment.title': 'Оборудование',
    'user.log.title': 'Лог событий',
    'user.actions.arm': 'Под охрану',
    'user.actions.disarm': 'С охраны',
    'user.empty.devices': 'Нет устройств',
    'user.empty.logs': 'Нет событий',
    'status.armed': 'Под охраной',
    'status.disarmed': 'Снято с охраны',
    'status.night': 'Ночной режим',
    'profile.title': 'Профиль',
    'profile.nickname': 'Игровой ник',
    'profile.timezone': 'Таймзона',
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
    'user.actions.arm': 'Arm',
    'user.actions.disarm': 'Disarm',
    'user.empty.devices': 'No devices',
    'user.empty.logs': 'No events',
    'status.armed': 'Armed',
    'status.disarmed': 'Disarmed',
    'status.night': 'Night mode',
    'profile.title': 'Profile',
    'profile.nickname': 'Game nickname',
    'profile.timezone': 'Timezone',
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
    'X-App-Mode': 'user',
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
  if (profileTimezone) profileTimezone.value = settings.timezone ?? 'UTC';
  if (profileLanguage) profileLanguage.value = settings.language ?? 'ru';
  await syncProfileSettings();
  applyTranslations();

  profileNickname?.addEventListener('input', (event) => {
    saveProfileSettings({ ...loadProfileSettings(), nickname: event.target.value, avatarUrl: state.avatarUrl });
  });
  profileNickname?.addEventListener('blur', (event) => {
    fetch('/api/auth/me', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('authToken') ?? ''}`,
      },
      body: JSON.stringify({ minecraft_nickname: event.target.value }),
    }).catch(() => null);
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
      <div class="object-item__title">${space.name}</div>
      <div class="object-item__meta">${space.id}</div>
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
  spaceMetaEl.textContent = space.address ?? '—';
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
        <div class="device-item__title">${device.name}</div>
        <div class="device-item__meta">${device.room ?? '—'}</div>
      </div>
      <span class="device-item__status">${device.status ?? '—'}</span>
    `;
    button.addEventListener('click', () => {
      state.selectedDeviceId = device.id;
      renderDevices(devices);
      deviceDetails.innerHTML = `
        <div class="detail-card">
          <h3>${device.name}</h3>
          <p>Тип: ${device.type}</p>
          <p>Сторона: ${device.side ?? '—'}</p>
        </div>
      `;
    });
    deviceList.appendChild(button);
  });

  if (!state.selectedDeviceId) {
    state.selectedDeviceId = devices[0].id;
  }
};

const renderLogs = (logs) => {
  logTable.innerHTML = '';
  if (!logs.length) {
    logTable.innerHTML = `<div class="empty-state">${t('user.empty.logs')}</div>`;
    return;
  }
  logs.forEach((log) => {
    const row = document.createElement('div');
    row.className = `log-row ${log.type === 'alarm' ? 'log-row--alarm' : ''}`;
    const timestamp = log.createdAtMs ?? (log.createdAt ? new Date(log.createdAt).getTime() : null);
    const timeLabel = formatLogTime(timestamp) ?? log.time;
    row.innerHTML = `
      <span>${timeLabel}</span>
      <span>${log.text}</span>
      <span class="muted">${log.who}</span>
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
