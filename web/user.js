const state = {
  selectedSpaceId: null,
  selectedDeviceId: null,
  language: 'ru',
  timezone: 'UTC',
  role: null,
};

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
const profileSwitch = document.getElementById('profileSwitch');

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
    'profile.title': 'Profile',
    'profile.nickname': 'Game nickname',
    'profile.timezone': 'Timezone',
    'profile.language': 'Language',
    'profile.switchPro': 'Switch to PRO',
    'profile.logout': 'Sign out',
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
  if (profileNickname) profileNickname.value = settings.nickname ?? '';
  if (profileTimezone) profileTimezone.value = settings.timezone ?? 'UTC';
  if (profileLanguage) profileLanguage.value = settings.language ?? 'ru';
  applyTranslations();
  try {
    const profile = await apiFetch('/api/auth/me');
    state.role = profile.user?.role ?? state.role;
    if (profile.user?.language || profile.user?.timezone || profile.user?.minecraft_nickname) {
      saveProfileSettings({
        nickname: profile.user.minecraft_nickname ?? settings.nickname ?? '',
        language: profile.user.language ?? settings.language ?? 'ru',
        timezone: profile.user.timezone ?? settings.timezone ?? 'UTC',
      });
      applyProfileSettings(loadProfileSettings());
      if (profileNickname) profileNickname.value = profile.user.minecraft_nickname ?? '';
      if (profileTimezone) profileTimezone.value = profile.user.timezone ?? 'UTC';
      if (profileLanguage) profileLanguage.value = profile.user.language ?? 'ru';
      applyTranslations();
    }
  } catch {
    // ignore
  }

  profileNickname?.addEventListener('input', (event) => {
    saveProfileSettings({ ...settings, nickname: event.target.value });
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
    saveProfileSettings({ ...settings, timezone: event.target.value });
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
    saveProfileSettings({ ...settings, language: event.target.value });
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
  profileSwitch?.addEventListener('click', () => {
    window.location.href = 'index.html';
  });
  profileLogout?.addEventListener('click', async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    localStorage.removeItem('authToken');
    toggle(false);
    window.location.href = 'login.html';
  });
};

const ensureNickname = async () => {
  if (state.nickname && state.nickname.trim()) return;
  const overlay = document.createElement('div');
  overlay.className = 'nickname-modal';
  overlay.innerHTML = `
    <div class="nickname-modal__content">
      <h3>Укажите игровой ник</h3>
      <p>Без игрового ника доступ к объектам не выдаётся.</p>
      <input type="text" id="nicknameInput" placeholder="Игровой ник" />
      <button class="button button--primary" id="nicknameSubmit">Сохранить</button>
    </div>
  `;
  document.body.appendChild(overlay);
  const input = overlay.querySelector('#nicknameInput');
  const submit = overlay.querySelector('#nicknameSubmit');
  submit.addEventListener('click', async () => {
    const value = input.value.trim();
    if (!value) return;
    state.nickname = value;
    saveProfileSettings({
      nickname: value,
      language: state.language,
      timezone: state.timezone,
    });
    await apiFetch('/api/auth/me', {
      method: 'PATCH',
      body: JSON.stringify({ minecraft_nickname: value }),
    });
    overlay.remove();
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
  spaceStateEl.textContent = space.status;
  spaceMetaEl.textContent = space.address ?? '—';
};

const renderDevices = (devices) => {
  deviceList.innerHTML = '';
  if (!devices.length) {
    deviceList.innerHTML = '<div class="empty-state">Нет устройств</div>';
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
    logTable.innerHTML = '<div class="empty-state">Нет событий</div>';
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
  const spaces = await apiFetch('/api/spaces');
  if (!spaces.length) return;
  const saved = localStorage.getItem('userSelectedSpace');
  state.selectedSpaceId = saved && spaces.some((space) => space.id === saved) ? saved : spaces[0].id;
  renderSpaces(spaces);
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
  if (state.role && state.role === 'installer') {
    // installers can still use user view, but provide switch
  }
  await ensureNickname();
  await loadSpaces();
};

init().catch(() => null);
