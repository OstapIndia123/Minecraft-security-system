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
const contactsList = document.getElementById('contactsList');
const notesList = document.getElementById('notesList');
const photosList = document.getElementById('photosList');
const logTable = document.getElementById('logTable');
const toast = document.getElementById('toast');
const spaceForm = document.getElementById('spaceForm');
const deviceForm = document.getElementById('deviceForm');
const contactForm = document.getElementById('contactForm');
const noteForm = document.getElementById('noteForm');
const photoForm = document.getElementById('photoForm');
const editForm = document.getElementById('editForm');
const openCreate = document.getElementById('openCreate');
const modal = document.getElementById('spaceModal');
const modalClose = document.getElementById('closeModal');
const deviceType = document.getElementById('deviceType');
const readerFields = document.getElementById('readerFields');
const sirenFields = document.getElementById('sirenFields');
const lightFields = document.getElementById('lightFields');

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
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? `API error: ${response.status}`);
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
      <div class="object-card__status ${statusTone[space.status] ?? ''}">${statusMap[space.status] ?? space.status}</div>
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

  if (editForm) {
    editForm.name.value = space.name;
    editForm.address.value = space.address;
    editForm.city.value = space.city;
    editForm.timezone.value = space.timezone;
  }
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

const renderPhotos = (space) => {
  const photos = space.photos ?? [];
  photosList.innerHTML = '';
  if (!photos.length) {
    photosList.innerHTML = '<div class="empty-state">Нет фотографий</div>';
    return;
  }
  photos.forEach((photo) => {
    const card = document.createElement('div');
    card.className = 'photo-card';
    card.innerHTML = `
      <img src="${photo.url}" alt="${photo.label}" />
      <div>${photo.label}</div>
    `;
    photosList.appendChild(card);
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
  renderContacts(space);
  renderNotes(space);
  renderPhotos(space);
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

if (spaceForm) {
  spaceForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(spaceForm);
    const payload = Object.fromEntries(formData.entries());
    try {
      const created = await apiFetch('/api/spaces', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      spaces.unshift({ ...created, logs: [] });
      state.selectedSpaceId = created.id;
      await loadLogs(created.id);
      renderAll();
      spaceForm.reset();
      showToast('Пространство создано.');
      modal?.classList.remove('modal--open');
    } catch (error) {
      console.error(error);
      showToast('Не удалось создать пространство.');
    }
  });
}

if (deviceType) {
  const updateDeviceFields = () => {
    const value = deviceType.value;
    const isReader = value === 'reader';
    const isSiren = value === 'siren';
    const isLight = value === 'output-light';

    readerFields?.classList.toggle('hidden', !isReader);
    sirenFields?.classList.toggle('hidden', !isSiren);
    lightFields?.classList.toggle('hidden', !isLight);

    readerFields?.querySelectorAll('input').forEach((input) => {
      input.disabled = !isReader;
      input.required = isReader;
    });
    sirenFields?.querySelectorAll('input').forEach((input) => {
      input.disabled = !isSiren;
      input.required = isSiren;
    });
    lightFields?.querySelectorAll('input').forEach((input) => {
      input.disabled = !isLight;
      input.required = isLight;
    });
  };

  deviceType.addEventListener('change', updateDeviceFields);
  updateDeviceFields();
}

if (deviceForm) {
  deviceForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const space = spaces.find((item) => item.id === state.selectedSpaceId);
    if (!space) return;

    const formData = new FormData(deviceForm);
    const payload = Object.fromEntries(formData.entries());
    try {
      await apiFetch(`/api/spaces/${space.id}/devices`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await loadSpaces();
      await loadLogs(space.id);
      renderAll();
      deviceForm.reset();
      showToast('Устройство добавлено.');
    } catch (error) {
      console.error(error);
      showToast('Не удалось добавить устройство.');
    }
  });
}

if (contactForm) {
  contactForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const space = spaces.find((item) => item.id === state.selectedSpaceId);
    if (!space) return;

    const formData = new FormData(contactForm);
    const payload = Object.fromEntries(formData.entries());
    try {
      await apiFetch(`/api/spaces/${space.id}/contacts`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await loadSpaces();
      renderAll();
      contactForm.reset();
      showToast('Контакт добавлен.');
    } catch (error) {
      console.error(error);
      showToast('Не удалось добавить контакт.');
    }
  });
}

if (noteForm) {
  noteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const space = spaces.find((item) => item.id === state.selectedSpaceId);
    if (!space) return;

    const formData = new FormData(noteForm);
    const payload = Object.fromEntries(formData.entries());
    try {
      await apiFetch(`/api/spaces/${space.id}/notes`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await loadSpaces();
      renderAll();
      noteForm.reset();
      showToast('Примечание добавлено.');
    } catch (error) {
      console.error(error);
      showToast('Не удалось добавить примечание.');
    }
  });
}

if (photoForm) {
  photoForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const space = spaces.find((item) => item.id === state.selectedSpaceId);
    if (!space) return;

    const formData = new FormData(photoForm);
    const payload = Object.fromEntries(formData.entries());
    try {
      await apiFetch(`/api/spaces/${space.id}/photos`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await loadSpaces();
      renderAll();
      photoForm.reset();
      showToast('Фото добавлено.');
    } catch (error) {
      console.error(error);
      showToast('Не удалось добавить фото.');
    }
  });
}

if (editForm) {
  editForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const space = spaces.find((item) => item.id === state.selectedSpaceId);
    if (!space) return;

    const formData = new FormData(editForm);
    const payload = Object.fromEntries(formData.entries());
    try {
      const updated = await apiFetch(`/api/spaces/${space.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      Object.assign(space, updated);
      await loadLogs(space.id);
      renderAll();
      showToast('Информация обновлена.');
    } catch (error) {
      console.error(error);
      showToast('Не удалось обновить объект.');
    }
  });
}

if (openCreate && modal) {
  openCreate.addEventListener('click', () => {
    modal.classList.add('modal--open');
  });
}

if (modalClose && modal) {
  modalClose.addEventListener('click', () => {
    modal.classList.remove('modal--open');
  });
}

if (modal) {
  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      modal.classList.remove('modal--open');
    }
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
