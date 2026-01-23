const state = {
  selectedSpaceId: null,
  selectedDeviceId: null,
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

const initProfileMenu = () => {
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
  if (profileNickname) profileNickname.value = settings.nickname ?? '';
  if (profileTimezone) profileTimezone.value = settings.timezone ?? 'UTC';
  if (profileLanguage) profileLanguage.value = settings.language ?? 'ru';

  profileNickname?.addEventListener('input', (event) => {
    saveProfileSettings({ ...settings, nickname: event.target.value });
  });
  profileTimezone?.addEventListener('change', (event) => {
    saveProfileSettings({ ...settings, timezone: event.target.value });
  });
  profileLanguage?.addEventListener('change', (event) => {
    saveProfileSettings({ ...settings, language: event.target.value });
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
    row.innerHTML = `
      <span>${log.time}</span>
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
  initProfileMenu();
  await loadSpaces();
};

init().catch(() => null);
