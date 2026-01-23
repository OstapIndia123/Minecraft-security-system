const state = {
  filter: 'all',
  logFilter: 'all',
  language: 'ru',
  timezone: 'UTC',
  nickname: '',
  role: null,
};

const FLASH_DURATION_MS = 15000;
const logFlashActive = new Map();

const grid = document.getElementById('mainObjectGrid');
const logTable = document.getElementById('mainLogTable');
const refreshBtn = document.getElementById('mainRefresh');
const addSpaceBtn = document.getElementById('mainAddSpace');
const filterButtons = document.querySelectorAll('#mainFilters .chip');
const logFilters = document.querySelectorAll('#mainLogFilters .chip');
const searchInput = document.getElementById('mainSearch');
const avatarButton = document.getElementById('avatarButton');
const profileDropdown = document.getElementById('profileDropdown');
const profileNickname = document.getElementById('profileNickname');
const profileTimezone = document.getElementById('profileTimezone');
const profileLanguage = document.getElementById('profileLanguage');
const profileLogout = document.getElementById('profileLogout');
const profileSwitch = document.getElementById('profileSwitch');

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
    'profile.title': 'Профиль',
    'profile.nickname': 'Игровой ник',
    'profile.timezone': 'Таймзона',
    'profile.language': 'Язык',
    'profile.switchUser': 'Перейти на обычный',
    'profile.logout': 'Выйти',
  },
  'en-US': {
    'pcn.title': 'PCN Mode',
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
    'profile.title': 'Profile',
    'profile.nickname': 'Game nickname',
    'profile.timezone': 'Timezone',
    'profile.language': 'Language',
    'profile.switchUser': 'Switch to user mode',
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
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    const key = node.dataset.i18nPlaceholder;
    if (dict[key]) {
      node.setAttribute('placeholder', dict[key]);
    }
  });
};

const loadProfileSettings = () => {
  const raw = localStorage.getItem('profileSettings');
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    state.language = parsed.language ?? state.language;
    state.timezone = parsed.timezone ?? state.timezone;
    state.nickname = parsed.nickname ?? state.nickname;
  } catch {
    // ignore
  }
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
    state.role = payload.user.role ?? state.role;
    saveProfileSettings();
  } catch {
    // ignore
  }
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
    saveProfileSettings();
    await fetch('/api/auth/me', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('authToken') ?? ''}`,
      },
      body: JSON.stringify({ minecraft_nickname: value }),
    });
    overlay.remove();
  });
};

const saveProfileSettings = () => {
  localStorage.setItem('profileSettings', JSON.stringify({
    language: state.language,
    timezone: state.timezone,
    nickname: state.nickname,
  }));
};

const apiFetch = async (path) => {
  const token = localStorage.getItem('authToken');
  const response = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('authToken');
      window.location.href = 'login.html';
      throw new Error('unauthorized');
    }
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
};

const getLogTimestamp = (log) => {
  if (log.createdAtMs) return log.createdAtMs;
  const raw = log.createdAt ?? log.created_at;
  if (!raw) return null;
  const parsed = new Date(raw);
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

const renderObjects = (spaces) => {
  const query = (searchInput?.value ?? '').trim().toLowerCase();
  const filtered = spaces.filter((space) => {
    if (state.filter === 'offline') {
      return !space.hubOnline;
    }
    if (state.filter === 'issues') {
      return space.issues;
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
    grid.innerHTML = '<div class="empty-state">Нет объектов по фильтру</div>';
    return;
  }

  filtered.forEach((space) => {
    const card = document.createElement('button');
    const alarmKey = `alarmPending:${space.id}`;
    if (space.issues && !localStorage.getItem(alarmKey)) {
      localStorage.setItem(alarmKey, String(Date.now()));
    }
    const shouldFlash = Boolean(localStorage.getItem(alarmKey));
    card.className = `object-card ${shouldFlash ? 'object-card--alarm object-card--alarm-flash' : ''}`;
    card.innerHTML = `
      <div class="object-card__title">${space.name}</div>
      <div class="object-card__meta">ID хаба ${space.hubId ?? '—'}</div>
      <div class="object-card__status">${space.status}</div>
      <div class="object-card__meta">${space.address}</div>
    `;
    card.addEventListener('click', () => {
      localStorage.removeItem(alarmKey);
      const url = new URL('main.html', window.location.href);
      url.searchParams.set('spaceId', space.id);
      window.location.href = url.toString();
    });
    grid.appendChild(card);
  });
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
    logTable.innerHTML = '<div class="empty-state">Нет событий по выбранному фильтру</div>';
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
    const hasSeen = localStorage.getItem(flashKey);
    if (isAlarm && logTimestamp && !hasSeen) {
      localStorage.setItem(flashKey, String(Date.now()));
      logFlashActive.set(flashKey, Date.now() + FLASH_DURATION_MS);
    }
    const shouldFlash = logFlashActive.get(flashKey) > Date.now();
    if (!shouldFlash) {
      logFlashActive.delete(flashKey);
    }
    row.className = `log-row ${isAlarm ? 'log-row--alarm' : ''} ${shouldFlash ? 'log-row--alarm-flash' : ''} ${isRestore ? 'log-row--restore' : ''} ${isHub ? 'log-row--hub' : ''}`;
    const text = isHub ? log.text.replace(/\n/g, '<br />') : log.text;
    const timeLabel = formatLogTime(logTimestamp) ?? log.time;
    row.innerHTML = `
      <span>${timeLabel}</span>
      <span>${text}</span>
      <span class="muted">${log.spaceName}</span>
    `;
    logTable.appendChild(row);
  });
};

const refresh = async () => {
  const [spaces, logs] = await Promise.all([apiFetch('/api/spaces'), apiFetch('/api/logs')]);
  renderObjects(spaces);
  renderLogs(logs);
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
  refreshBtn.addEventListener('click', () => {
    refresh().catch(() => null);
  });
}

if (addSpaceBtn) {
  addSpaceBtn.addEventListener('click', () => {
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
  await syncProfileSettings();
  if (profileNickname) profileNickname.value = state.nickname;
  if (profileTimezone) profileTimezone.value = state.timezone;
  if (profileLanguage) profileLanguage.value = state.language;
  applyTranslations();

  profileNickname?.addEventListener('input', (event) => {
    state.nickname = event.target.value;
    saveProfileSettings();
  });
  profileNickname?.addEventListener('blur', () => {
    fetch('/api/auth/me', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('authToken') ?? ''}`,
      },
      body: JSON.stringify({ minecraft_nickname: state.nickname }),
    }).catch(() => null);
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
  profileSwitch?.addEventListener('click', () => {
    window.location.href = 'user.html';
  });
};

if (!localStorage.getItem('authToken')) {
  window.location.href = 'login.html';
} else {
  initProfileMenu().then(() => {
    if (state.role && state.role !== 'installer') {
      window.location.href = 'user.html';
      return;
    }
    ensureNickname().catch(() => null);
    refresh().catch(() => null);
  });
  applyTranslations();

  setInterval(() => {
    refresh().catch(() => null);
  }, 5000);
}
