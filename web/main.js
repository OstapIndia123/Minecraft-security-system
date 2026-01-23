const state = {
  filter: 'all',
  logFilter: 'all',
  language: 'ru',
  timezone: 'UTC',
  nickname: '',
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
const tabs = document.querySelectorAll('#pcnTabs .tab');
const panels = document.querySelectorAll('.panel');
const avatarButton = document.getElementById('avatarButton');
const profileDropdown = document.getElementById('profileDropdown');
const profileNickname = document.getElementById('profileNickname');
const profileTimezone = document.getElementById('profileTimezone');
const profileLanguage = document.getElementById('profileLanguage');
const profileLogout = document.getElementById('profileLogout');

const translations = {
  ru: {
    'pcn.title': 'Режим ПЦН',
    'pcn.subtitle': 'Объекты и общий журнал событий',
    'pcn.tabs.objects': 'Объекты',
    'pcn.tabs.users': 'Пользователи',
    'pcn.tabs.installers': 'Инженеры монтажа',
    'pcn.objects.title': 'Объекты',
    'pcn.logs.title': 'Общий журнал событий',
    'pcn.actions.refresh': 'Обновить',
    'pcn.actions.add': 'Добавить объект',
    'pcn.users.title': 'Пользователи',
    'pcn.users.placeholder': 'Раздел пользователей появится после подключения авторизации.',
    'pcn.installers.title': 'Инженеры монтажа',
    'pcn.installers.placeholder': 'Раздел инженеров монтажа появится вместе с PRO-аккаунтами.',
    'profile.title': 'Профиль',
    'profile.nickname': 'Игровой ник',
    'profile.timezone': 'Таймзона',
    'profile.language': 'Язык',
    'profile.logout': 'Выйти',
  },
  'en-US': {
    'pcn.title': 'PCN Mode',
    'pcn.subtitle': 'Objects and global event log',
    'pcn.tabs.objects': 'Objects',
    'pcn.tabs.users': 'Users',
    'pcn.tabs.installers': 'Installers',
    'pcn.objects.title': 'Objects',
    'pcn.logs.title': 'Global event log',
    'pcn.actions.refresh': 'Refresh',
    'pcn.actions.add': 'Add object',
    'pcn.users.title': 'Users',
    'pcn.users.placeholder': 'User access will appear after authentication is connected.',
    'pcn.installers.title': 'Installers',
    'pcn.installers.placeholder': 'Installer access will appear with PRO accounts.',
    'profile.title': 'Profile',
    'profile.nickname': 'Game nickname',
    'profile.timezone': 'Timezone',
    'profile.language': 'Language',
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

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((btn) => btn.classList.remove('tab--active'));
    panels.forEach((panel) => panel.classList.remove('panel--active'));

    tab.classList.add('tab--active');
    const target = document.getElementById(tab.dataset.tab);
    if (target) {
      target.classList.add('panel--active');
    }
  });
});

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

  loadProfileSettings();
  if (profileNickname) profileNickname.value = state.nickname;
  if (profileTimezone) profileTimezone.value = state.timezone;
  if (profileLanguage) profileLanguage.value = state.language;
  applyTranslations();

  profileNickname?.addEventListener('input', (event) => {
    state.nickname = event.target.value;
    saveProfileSettings();
  });
  profileTimezone?.addEventListener('change', (event) => {
    state.timezone = event.target.value;
    saveProfileSettings();
  });
  profileLanguage?.addEventListener('change', (event) => {
    state.language = event.target.value;
    saveProfileSettings();
    applyTranslations();
    refresh().catch(() => null);
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
};

if (!localStorage.getItem('authToken')) {
  window.location.href = 'login.html';
} else {
  initProfileMenu();
  applyTranslations();

  refresh().catch(() => null);
  setInterval(() => {
    refresh().catch(() => null);
  }, 5000);
}
