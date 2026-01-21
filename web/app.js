const state = {
  filter: 'all',
  selectedSpaceId: null,
  logFilter: 'all',
  search: '',
  deviceSearch: '',
};

let spaces = [];

const objectList = document.getElementById('objectList');
const spaceIdEl = document.getElementById('spaceId');
const spaceStateEl = document.getElementById('spaceState');
const spaceMetaEl = document.getElementById('spaceMeta');
const hubLabel = document.getElementById('hubLabel');
const deviceList = document.getElementById('deviceList');
const deviceDetails = document.getElementById('deviceDetails');
const objectInfo = document.getElementById('objectInfo');
const companyInfo = document.getElementById('companyInfo');
const contactsList = document.getElementById('contactsList');
const notesList = document.getElementById('notesList');
const logTable = document.getElementById('logTable');
const toast = document.getElementById('toast');

const statusMap = {
  armed: 'Под охраной',
  disarmed: 'Снято с охраны',
  night: 'Ночной режим',
};

const statusTone = {
  armed: 'status--armed',
  disarmed: 'status--disarmed',
  night: 'status--night',
};

const chipActions = document.querySelectorAll('.status-actions .chip');
const filterButtons = document.querySelectorAll('.nav-pill');
const logFilters = document.querySelectorAll('#logFilters .chip');

const showToast = (message) => {
  toast.textContent = message;
  toast.classList.add('toast--show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('toast--show'), 2200);
};

const apiFetch = async (path, options = {}) => {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
};

const loadSpaces = async () => {
  try {
    spaces = await apiFetch('/api/spaces');
    if (!state.selectedSpaceId && spaces.length) {
      state.selectedSpaceId = spaces[0].id;
    }
  } catch (error) {
    console.error(error);
    showToast('Не удалось загрузить данные.');
  }
};

const loadLogs = async (spaceId) => {
  try {
    const logs = await apiFetch(`/api/spaces/${spaceId}/logs`);
    const space = spaces.find((item) => item.id === spaceId);
    if (space) {
      space.logs = logs;
    }
  } catch (error) {
    console.error(error);
    showToast('Не удалось загрузить журнал.');
  }
};

const applyFilter = (list) => {
  if (state.filter === 'offline') {
    return list.filter((space) => !space.hubOnline);
  }
  if (state.filter === 'issues') {
    return list.filter((space) => space.issues);
  }
  return list;
};

const applySearch = (list) => {
  const query = state.search.trim().toLowerCase();
  if (!query) return list;
  return list.filter((space) => {
    return (
      space.id.toLowerCase().includes(query) ||
      space.name.toLowerCase().includes(query) ||
      space.hubId.toLowerCase().includes(query)
    );
  });
};

const renderCounts = () => {
  const allCount = spaces.length;
  const offlineCount = spaces.filter((space) => !space.hubOnline).length;
  const issuesCount = spaces.filter((space) => space.issues).length;

  document.querySelector('[data-count="all"]').textContent = allCount;
  document.querySelector('[data-count="offline"]').textContent = offlineCount;
  document.querySelector('[data-count="issues"]').textContent = issuesCount;
};

const renderObjectList = () => {
  const filtered = applySearch(applyFilter(spaces));

  objectList.innerHTML = '';
  filtered.forEach((space) => {
    const card = document.createElement('button');
    card.className = `object-card ${space.id === state.selectedSpaceId ? 'object-card--active' : ''}`;
    card.innerHTML = `
      <div class="object-card__title">${space.name}</div>
      <div class="object-card__meta">ID хаба ${space.hubId}</div>
      <div class="object-card__status ${statusTone[space.status]}">${statusMap[space.status]}</div>
      <div class="object-card__meta">${space.address}</div>
    `;
    card.addEventListener('click', async () => {
      state.selectedSpaceId = space.id;
      await loadLogs(space.id);
      renderAll();
    });
    objectList.appendChild(card);
  });
};

const renderSpaceHeader = (space) => {
  spaceIdEl.textContent = space.id;
  spaceStateEl.textContent = statusMap[space.status] ?? space.status;
  spaceStateEl.className = `status-card__state ${statusTone[space.status] ?? ''}`;
  spaceMetaEl.textContent = `${space.address} • ${space.city} • ${space.timezone}`;
  hubLabel.textContent = `Hub ${space.id}`;
};

const renderDevices = (space) => {
  const deviceQuery = state.deviceSearch.trim().toLowerCase();
  const devices = deviceQuery
    ? space.devices.filter((device) => device.name.toLowerCase().includes(deviceQuery))
    : space.devices;

  deviceList.innerHTML = '';
  devices.forEach((device, index) => {
    const item = document.createElement('button');
    item.className = `device-item ${index === 0 ? 'device-item--active' : ''}`;
    item.innerHTML = `
      <div>
        <div class="device-item__title">${device.name}</div>
        <div class="device-item__meta">${device.room}</div>
      </div>
      <span class="device-item__status">${device.status}</span>
    `;
    item.addEventListener('click', () => renderDeviceDetails(device));
    deviceList.appendChild(item);
    if (index === 0) renderDeviceDetails(device);
  });

  if (!devices.length) {
    deviceList.innerHTML = '<div class="empty-state">Нет устройств по запросу</div>';
    deviceDetails.innerHTML = '<div class="empty-state">Выберите устройство</div>';
  }
};

const renderDeviceDetails = (device) => {
  deviceDetails.innerHTML = `
    <div class="device-details__header">
      <div class="device-avatar">${device.type.toUpperCase()}</div>
      <div>
        <div class="device-details__title">${device.name}</div>
        <div class="device-details__meta">${device.room}</div>
      </div>
    </div>
    <div class="device-details__stats">
      <div class="stat">
        <span>Статус</span>
        <strong>${device.status}</strong>
      </div>
      <div class="stat">
        <span>Тип</span>
        <strong>${device.type}</strong>
      </div>
      <div class="stat">
        <span>ID</span>
        <strong>${device.id}</strong>
      </div>
      <div class="stat">
        <span>Связь</span>
        <strong>Норма</strong>
      </div>
    </div>
  `;
};

const renderObjectInfo = (space) => {
  objectInfo.innerHTML = `
    <div class="info-card">
      <span>Название</span>
      <strong>${space.name}</strong>
    </div>
    <div class="info-card">
      <span>Адрес</span>
      <strong>${space.address}</strong>
    </div>
    <div class="info-card">
      <span>Город</span>
      <strong>${space.city}</strong>
    </div>
    <div class="info-card">
      <span>Часовой пояс</span>
      <strong>${space.timezone}</strong>
    </div>
    <div class="info-card">
      <span>Хаб</span>
      <strong>${space.hubId}</strong>
    </div>
    <div class="info-card">
      <span>Режим</span>
      <strong>${statusMap[space.status] ?? space.status}</strong>
    </div>
  `;
};

const renderCompany = (space) => {
  companyInfo.innerHTML = `
    <div class="company-logo">АО</div>
    <div>
      <div class="company-row__title">${space.company.name}</div>
      <div class="company-row__meta">${space.company.country}</div>
    </div>
    <div class="company-row__contacts">
      <div>ПЦС: ${space.company.pcs}</div>
      <div>Сайт: ${space.company.site}</div>
      <div>Почта: ${space.company.email}</div>
    </div>
  `;
};

const renderContacts = (space) => {
  contactsList.innerHTML = '';
  space.contacts.forEach((contact) => {
    const card = document.createElement('div');
    card.className = 'contact-card';
    card.innerHTML = `
      <div class="contact-card__title">${contact.name}</div>
      <div class="contact-card__meta">${contact.role}</div>
      <div class="contact-card__meta">${contact.phone}</div>
    `;
    contactsList.appendChild(card);
  });
};

const renderNotes = (space) => {
  notesList.innerHTML = '';
  space.notes.forEach((note) => {
    const card = document.createElement('div');
    card.className = 'note-card';
    card.textContent = note;
    notesList.appendChild(card);
  });
};

const renderLogs = (space) => {
  const logs = state.logFilter === 'all'
    ? space.logs
    : space.logs.filter((log) => log.type === state.logFilter);

  logTable.innerHTML = '';
  logs.forEach((log) => {
    const row = document.createElement('div');
    row.className = 'log-row';
    row.innerHTML = `
      <span>${log.time}</span>
      <span>${log.text}</span>
      <span class="muted">${log.who}</span>
    `;
    logTable.appendChild(row);
  });

  if (!logs.length) {
    logTable.innerHTML = '<div class="empty-state">Нет событий по выбранному фильтру</div>';
  }
};

const renderAll = () => {
  renderCounts();
  renderObjectList();
  const space = spaces.find((item) => item.id === state.selectedSpaceId) || spaces[0];
  if (!space) return;
  renderSpaceHeader(space);
  renderDevices(space);
  renderObjectInfo(space);
  renderCompany(space);
  renderContacts(space);
  renderNotes(space);
  renderLogs(space);
};

chipActions.forEach((chip) => {
  chip.addEventListener('click', async () => {
    const action = chip.dataset.action;
    const space = spaces.find((item) => item.id === state.selectedSpaceId);
    if (!space) return;

    try {
      if (action === 'arm') {
        const updated = await apiFetch(`/api/spaces/${space.id}/arm`, { method: 'POST' });
        Object.assign(space, updated);
        showToast('Объект поставлен под охрану.');
      }
      if (action === 'disarm') {
        const updated = await apiFetch(`/api/spaces/${space.id}/disarm`, { method: 'POST' });
        Object.assign(space, updated);
        showToast('Объект снят с охраны.');
      }
      await loadLogs(space.id);
      renderAll();
    } catch (error) {
      console.error(error);
      showToast('Ошибка обновления статуса.');
    }
  });
});

filterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    filterButtons.forEach((btn) => btn.classList.remove('nav-pill--active'));
    button.classList.add('nav-pill--active');
    state.filter = button.dataset.filter;
    renderObjectList();
  });
});

logFilters.forEach((button) => {
  button.addEventListener('click', () => {
    logFilters.forEach((btn) => btn.classList.remove('chip--active'));
    button.classList.add('chip--active');
    state.logFilter = button.dataset.log;
    renderLogs(spaces.find((item) => item.id === state.selectedSpaceId));
  });
});

const globalSearch = document.getElementById('globalSearch');
const deviceSearch = document.getElementById('deviceSearch');
const refreshBtn = document.getElementById('refreshBtn');

if (globalSearch) {
  globalSearch.addEventListener('input', (event) => {
    state.search = event.target.value;
    renderObjectList();
  });
}

if (deviceSearch) {
  deviceSearch.addEventListener('input', (event) => {
    state.deviceSearch = event.target.value;
    const space = spaces.find((item) => item.id === state.selectedSpaceId);
    renderDevices(space);
  });
}

if (refreshBtn) {
  refreshBtn.addEventListener('click', async () => {
    await loadSpaces();
    if (state.selectedSpaceId) {
      await loadLogs(state.selectedSpaceId);
    }
    renderAll();
    showToast('Данные синхронизированы с хабами.');
  });
}

const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.panel');

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

const init = async () => {
  await loadSpaces();
  if (state.selectedSpaceId) {
    await loadLogs(state.selectedSpaceId);
  }
  renderAll();
};

init();
