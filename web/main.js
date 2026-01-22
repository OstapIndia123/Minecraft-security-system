const state = {
  filter: 'all',
  logFilter: 'all',
};

const grid = document.getElementById('mainObjectGrid');
const logTable = document.getElementById('mainLogTable');
const refreshBtn = document.getElementById('mainRefresh');
const filterButtons = document.querySelectorAll('#mainFilters .chip');
const logFilters = document.querySelectorAll('#mainLogFilters .chip');
const searchInput = document.getElementById('mainSearch');

const apiFetch = async (path) => {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
};

const formatLogDate = (dateValue) => {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
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
    card.className = `object-card ${space.issues ? 'object-card--alarm' : ''}`;
    card.innerHTML = `
      <div class="object-card__title">${space.name}</div>
      <div class="object-card__meta">ID хаба ${space.hubId ?? '—'}</div>
      <div class="object-card__status">${space.status}</div>
      <div class="object-card__meta">${space.address}</div>
    `;
    card.addEventListener('click', () => {
      const url = new URL('index.html', window.location.href);
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
    const dateLabel = formatLogDate(log.createdAt ?? log.created_at);
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
    row.className = `log-row ${isAlarm ? 'log-row--alarm' : ''} ${isRestore ? 'log-row--restore' : ''} ${isHub ? 'log-row--hub' : ''}`;
    const text = isHub ? log.text.replace(/\n/g, '<br />') : log.text;
    row.innerHTML = `
      <span>${log.time}</span>
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

if (searchInput) {
  searchInput.addEventListener('input', () => {
    refresh().catch(() => null);
  });
}

refresh().catch(() => null);
