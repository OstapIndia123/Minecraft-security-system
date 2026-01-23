const state = {
  filter: 'all',
  logFilter: 'all',
  language: 'ru',
  timezone: 'UTC',
  nickname: '',
  avatarUrl: '',
  role: 'user',
};

const FLASH_DURATION_MS = 15000;
const logFlashActive = new Map();

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

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
const switchToUser = document.getElementById('switchToUser');
const avatarImages = document.querySelectorAll('[data-avatar]');
const avatarFallbacks = document.querySelectorAll('[data-avatar-fallback]');

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
    'status.armed': 'Под охраной',
    'status.disarmed': 'Снято с охраны',
    'status.night': 'Ночной режим',
    'profile.title': 'Профиль',
    'profile.nickname': 'Игровой ник',
    'profile.timezone': 'Часовой пояс',
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
    'pcn.empty.objects': 'No objects for this filter',
    'pcn.empty.logs': 'No events for the selected filter',
    'pcn.object.hubId': 'Hub ID',
    'status.armed': 'Armed',
    'status.disarmed': 'Disarmed',
    'status.night': 'Night mode',
    'profile.title': 'Profile',
    'profile.nickname': 'Game nickname',
    'profile.timezone': 'Time zone',
    'profile.language': 'Language',
    'profile.switchUser': 'Go to user',
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

const t = (key) => translations[state.language]?.[key] ?? translations.ru[key] ?? key;

const loadProfileSettings = () => {
  const raw = localStorage.getItem('profileSettings');
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    state.language = parsed.language ?? state.language;
    state.timezone = parsed.timezone ?? state.timezone;
    state.nickname = parsed.nickname ?? state.nickname;
    state.avatarUrl = parsed.avatarUrl ?? state.avatarUrl;
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
    state.avatarUrl = payload.user.discord_avatar_url ?? state.avatarUrl;
    state.role = payload.user.role ?? state.role;
    saveProfileSettings();
    setAvatar(state.avatarUrl);
  } catch {
    // ignore
  }
};

const saveProfileSettings = () => {
  localStorage.setItem('profileSettings', JSON.stringify({
    language: state.language,
    timezone: state.timezone,
    nickname: state.nickname,
    avatarUrl: state.avatarUrl,
  }));
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
    throw new Error(`API error: ${response.status}`);
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

const renderObjects = (spaces) => {
  const query = (searchInput?.value ?? '').trim().toLowerCase();
  const filtered = spaces.filter((space) => {
    if (state.filter === 'offline') {
      return space.hubOnline === false;
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
    grid.innerHTML = `<div class="empty-state">${t('pcn.empty.objects')}</div>`;
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
      <div class="object-card__title">${escapeHtml(space.name)}</div>
      <div class="object-card__meta">${t('pcn.object.hubId')} ${escapeHtml(space.hubId ?? '—')}</div>
      <div class="object-card__status">${t(`status.${space.status}`) ?? space.status}</div>
      <div class="object-card__meta">${escapeHtml(space.server ?? '—')}</div>
      <div class="object-card__meta">${escapeHtml(space.address)}</div>
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
    const rawText = isHub ? log.text : translateLogText(log.text);
    const safeText = escapeHtml(rawText);
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
  setAvatar(state.avatarUrl);
  await syncProfileSettings();
  if (profileNickname) profileNickname.value = state.nickname;
  let confirmedNickname = state.nickname;
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
  profileNickname?.addEventListener('blur', () => {
    fetch('/api/auth/me', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('authToken') ?? ''}`,
      },
      body: JSON.stringify({ minecraft_nickname: state.nickname }),
    }).then(async (response) => {
      if (response.ok) {
        confirmedNickname = state.nickname;
        return;
      }
      const payload = await response.json().catch(() => ({}));
      const errorMessage = payload?.error === 'nickname_too_long'
        ? 'Ник должен быть не длиннее 16 символов.'
        : payload?.error === 'nickname_cooldown'
          ? 'Сменить ник можно раз в 3 дня.'
          : payload?.error === 'invalid_nickname'
            ? 'Введите корректный ник.'
            : 'Не удалось обновить ник.';
      window.alert(errorMessage);
      state.nickname = confirmedNickname;
      if (profileNickname) profileNickname.value = confirmedNickname;
      saveProfileSettings();
    }).catch(() => {
      state.nickname = confirmedNickname;
      if (profileNickname) profileNickname.value = confirmedNickname;
      saveProfileSettings();
    });
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
