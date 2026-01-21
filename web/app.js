const state = {
  filter: 'all',
  selectedSpaceId: null,
  selectedDeviceId: null,
  logFilter: 'all',
  search: '',
  deviceSearch: '',
  lastLogKey: '',
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
const zoneFields = document.getElementById('zoneFields');
const keyFields = document.getElementById('keyFields');
const generateKey = document.getElementById('generateKey');
const sideInput = deviceForm?.querySelector('input[name="side"]');
const deviceNameInput = deviceForm?.querySelector('input[name="name"]');
const deviceRoomInput = deviceForm?.querySelector('input[name="room"]');
const attachHubForm = document.getElementById('attachHubForm');
const guardModal = document.getElementById('guardModal');
const guardModalClose = document.getElementById('closeGuardModal');
const guardModalOk = document.getElementById('guardModalOk');

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

const showGuardModal = () => {
  guardModal?.classList.add('modal--open');
};

const isSpaceArmed = () => {
  const space = spaces.find((item) => item.id === state.selectedSpaceId);
  return space?.status === 'armed';
};

const ensureEditable = () => {
  if (isSpaceArmed()) {
    showGuardModal();
    return false;
  }
  return true;
};

const handleApiError = (error, fallbackMessage) => {
  if (error.message === 'space_armed') {
    showGuardModal();
  } else {
    showToast(fallbackMessage);
  }
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
    if (!state.selectedSpaceId) {
      const savedSpaceId = localStorage.getItem('selectedSpaceId');
      if (savedSpaceId && spaces.some((space) => space.id === savedSpaceId)) {
        state.selectedSpaceId = savedSpaceId;
      }
    }
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
      const lastLog = logs[0];
      state.lastLogKey = `${logs.length}-${lastLog?.time ?? ''}-${lastLog?.text ?? ''}`;
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
      (space.hubId ?? '').toLowerCase().includes(query)
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
    const isAlarm = space.issues;
    card.className = `object-card ${space.id === state.selectedSpaceId ? 'object-card--active' : ''} ${
      isAlarm ? 'object-card--alarm' : ''
    }`;
    card.innerHTML = `
      <div class="object-card__title">${space.name}</div>
      <div class="object-card__meta">ID хаба ${space.hubId ?? '—'}</div>
      <div class="object-card__status ${statusTone[space.status] ?? ''}">${statusMap[space.status] ?? space.status}</div>
      <div class="object-card__meta">${space.address}</div>
    `;
    card.addEventListener('click', async () => {
      state.selectedSpaceId = space.id;
      state.selectedDeviceId = null;
      state.lastLogKey = '';
      localStorage.setItem('selectedSpaceId', space.id);
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
  spaceMetaEl.textContent = `Координаты: ${space.address} • ${space.city} • ${space.timezone}`;
  hubLabel.textContent = space.hubId ? `Hub ${space.hubId}` : 'Hub не привязан';
};

const renderDevices = (space) => {
  const deviceQuery = state.deviceSearch.trim().toLowerCase();
  const devices = deviceQuery
    ? space.devices.filter((device) => device.name.toLowerCase().includes(deviceQuery))
    : space.devices;

  deviceList.innerHTML = '';
  if (!devices.length) {
    deviceList.innerHTML = '<div class="empty-state">Нет устройств по запросу</div>';
    deviceDetails.innerHTML = '<div class="empty-state">Выберите устройство</div>';
    return;
  }

  if (!state.selectedDeviceId || !devices.some((device) => device.id === state.selectedDeviceId)) {
    state.selectedDeviceId = devices[0].id;
  }

  devices.forEach((device) => {
    const item = document.createElement('button');
    item.className = `device-item ${device.id === state.selectedDeviceId ? 'device-item--active' : ''}`;
    item.innerHTML = `
      <div>
        <div class="device-item__title">${device.name}</div>
        <div class="device-item__meta">${device.room}</div>
      </div>
      <span class="device-item__status">${device.status}</span>
    `;
    item.addEventListener('click', () => {
      state.selectedDeviceId = device.id;
      renderDevices(space);
    });
    deviceList.appendChild(item);
    if (device.id === state.selectedDeviceId) renderDeviceDetails(device);
  });
};

const renderDeviceDetails = (device) => {
  const canDelete = device.type !== 'hub';
  const deleteLabel = device.type === 'key' ? 'Удалить ключ' : 'Удалить устройство';
  const baseFields = device.type !== 'key'
    ? `
      <input type="text" name="name" value="${device.name}" placeholder="Имя" required />
      <input type="text" name="room" value="${device.room}" placeholder="Комната" required />
      ${device.side ? `<input type="text" name="side" value="${device.side}" placeholder="Сторона хаба" />` : ''}
    `
    : `
      <input type="text" name="name" value="${device.name.replace('Ключ: ', '')}" placeholder="Имя ключа" required />
      <input type="text" name="readerId" value="${device.config.readerId ?? ''}" placeholder="ID считывателя" />
    `;

  const configFields = (() => {
    if (device.type === 'zone') {
      return `
        <select name="zoneType">
          <option value="instant" ${device.config?.zoneType === 'instant' ? 'selected' : ''}>Нормальная</option>
          <option value="delayed" ${device.config?.zoneType === 'delayed' ? 'selected' : ''}>Задержанная</option>
          <option value="pass" ${device.config?.zoneType === 'pass' ? 'selected' : ''}>Проходная</option>
          <option value="24h" ${device.config?.zoneType === '24h' ? 'selected' : ''}>24-часовая</option>
        </select>
        <select name="bypass">
          <option value="false" ${device.config?.bypass ? '' : 'selected'}>Обход: нет</option>
          <option value="true" ${device.config?.bypass ? 'selected' : ''}>Обход: да</option>
        </select>
        <input type="number" name="normalLevel" value="${device.config?.normalLevel ?? 15}" min="0" max="15" />
      `;
    }
    if (device.type === 'output-light') {
      return `<input type="number" name="outputLevel" value="${device.config?.level ?? 15}" min="0" max="15" />`;
    }
    if (device.type === 'siren') {
      return `
        <input type="number" name="outputLevel" value="${device.config?.level ?? 15}" min="0" max="15" />
        <input type="number" name="intervalMs" value="${device.config?.intervalMs ?? 1000}" min="100" />
      `;
    }
    if (device.type === 'reader') {
      return `
        <input type="number" name="outputLevel" value="${device.config?.outputLevel ?? 6}" min="0" max="15" />
        <input type="number" name="inputLevel" value="${device.config?.inputLevel ?? 6}" min="0" max="15" />
      `;
    }
    return '';
  })();

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
    ${device.type !== 'hub' ? `
      <form class="form-grid device-edit" id="deviceEditForm">
        ${baseFields}
        ${configFields}
        <button class="button button--primary" type="submit">Сохранить</button>
      </form>
    ` : ''}
    ${canDelete ? `<button class="button button--ghost button--danger" id="deleteDevice">${deleteLabel}</button>` : ''}
  `;

  const deleteButton = document.getElementById('deleteDevice');
  if (deleteButton) {
    deleteButton.addEventListener('click', async () => {
      if (!ensureEditable()) return;
      const space = spaces.find((item) => item.id === state.selectedSpaceId);
      if (!space) return;

      try {
        if (device.type === 'key') {
          await apiFetch(`/api/spaces/${space.id}/keys/${device.config.keyId}`, { method: 'DELETE' });
        } else {
          await apiFetch(`/api/spaces/${space.id}/devices/${device.id}`, { method: 'DELETE' });
        }
        await loadSpaces();
        await loadLogs(space.id);
        renderAll();
        showToast('Устройство удалено.');
      } catch (error) {
        console.error(error);
        handleApiError(error, 'Не удалось удалить устройство.');
      }
    });
  }

  const editForm = document.getElementById('deviceEditForm');
  if (editForm) {
    editForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!ensureEditable()) return;
      const space = spaces.find((item) => item.id === state.selectedSpaceId);
      if (!space) return;

      const formData = new FormData(editForm);
      const payload = Object.fromEntries(formData.entries());
      try {
        if (device.type === 'key') {
          await apiFetch(`/api/spaces/${space.id}/keys/${device.config.keyId}`, {
            method: 'PATCH',
            body: JSON.stringify({
              name: payload.name,
              readerId: payload.readerId || null,
            }),
          });
        } else {
          await apiFetch(`/api/spaces/${space.id}/devices/${device.id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          });
        }
        await refreshAll();
        showToast('Устройство обновлено.');
      } catch (error) {
        console.error(error);
        handleApiError(error, 'Не удалось обновить устройство.');
      }
    });
  }
};

const renderObjectInfo = (space) => {
  objectInfo.innerHTML = `
    <div class="info-card">
      <span>Название</span>
      <strong>${space.name}</strong>
    </div>
    <div class="info-card">
      <span>Координаты</span>
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
      <strong>${space.hubId ?? 'Не привязан'}</strong>
    </div>
    <div class="info-card">
      <span>Статус хаба</span>
      <strong>${space.hubId ? (space.hubOnline ? 'В сети' : 'Не в сети') : 'Нет хаба'}</strong>
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
  space.contacts.forEach((contact, index) => {
    const card = document.createElement('div');
    card.className = 'contact-card';
    card.innerHTML = `
      <div class="contact-card__title">${contact.name}</div>
      <div class="contact-card__meta">${contact.role}</div>
      <div class="contact-card__meta">${contact.phone}</div>
      <div class="card-actions">
        <button class="button button--ghost" data-action="edit" data-index="${index}">Изменить</button>
        <button class="button button--ghost button--danger" data-action="delete" data-index="${index}">Удалить</button>
      </div>
    `;
    card.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!ensureEditable()) return;
        const action = button.dataset.action;
        if (action === 'delete') {
          try {
            await apiFetch(`/api/spaces/${space.id}/contacts/${index}`, { method: 'DELETE' });
            await refreshAll();
            showToast('Контакт удалён.');
          } catch (error) {
            console.error(error);
            handleApiError(error, 'Не удалось удалить контакт.');
          }
        } else {
          try {
            const name = prompt('Имя', contact.name) ?? contact.name;
            const role = prompt('Роль', contact.role) ?? contact.role;
            const phone = prompt('Телефон', contact.phone) ?? contact.phone;
            await apiFetch(`/api/spaces/${space.id}/contacts/${index}`, {
              method: 'PATCH',
              body: JSON.stringify({ name, role, phone }),
            });
            await refreshAll();
            showToast('Контакт обновлён.');
          } catch (error) {
            console.error(error);
            handleApiError(error, 'Не удалось обновить контакт.');
          }
        }
      });
    });
    contactsList.appendChild(card);
  });
};

const renderNotes = (space) => {
  notesList.innerHTML = '';
  space.notes.forEach((note, index) => {
    const card = document.createElement('div');
    card.className = 'note-card';
    card.innerHTML = `
      <div>${note}</div>
      <div class="card-actions">
        <button class="button button--ghost" data-action="edit" data-index="${index}">Изменить</button>
        <button class="button button--ghost button--danger" data-action="delete" data-index="${index}">Удалить</button>
      </div>
    `;
    card.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!ensureEditable()) return;
        const action = button.dataset.action;
        if (action === 'delete') {
          try {
            await apiFetch(`/api/spaces/${space.id}/notes/${index}`, { method: 'DELETE' });
            await refreshAll();
            showToast('Примечание удалено.');
          } catch (error) {
            console.error(error);
            handleApiError(error, 'Не удалось удалить примечание.');
          }
        } else {
          try {
            const text = prompt('Текст примечания', note) ?? note;
            await apiFetch(`/api/spaces/${space.id}/notes/${index}`, {
              method: 'PATCH',
              body: JSON.stringify({ text }),
            });
            await refreshAll();
            showToast('Примечание обновлено.');
          } catch (error) {
            console.error(error);
            handleApiError(error, 'Не удалось обновить примечание.');
          }
        }
      });
    });
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
  photos.forEach((photo, index) => {
    const card = document.createElement('div');
    card.className = 'photo-card';
    card.innerHTML = `
      <img src="${photo.url}" alt="${photo.label}" />
      <div>${photo.label}</div>
      <div class="card-actions">
        <button class="button button--ghost" data-action="edit" data-index="${index}">Изменить</button>
        <button class="button button--ghost button--danger" data-action="delete" data-index="${index}">Удалить</button>
      </div>
    `;
    card.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!ensureEditable()) return;
        const action = button.dataset.action;
        if (action === 'delete') {
          try {
            await apiFetch(`/api/spaces/${space.id}/photos/${index}`, { method: 'DELETE' });
            await refreshAll();
            showToast('Фото удалено.');
          } catch (error) {
            console.error(error);
            handleApiError(error, 'Не удалось удалить фото.');
          }
        } else {
          try {
            const url = prompt('URL фото', photo.url) ?? photo.url;
            const label = prompt('Подпись', photo.label) ?? photo.label;
            await apiFetch(`/api/spaces/${space.id}/photos/${index}`, {
              method: 'PATCH',
              body: JSON.stringify({ url, label }),
            });
            await refreshAll();
            showToast('Фото обновлено.');
          } catch (error) {
            console.error(error);
            handleApiError(error, 'Не удалось обновить фото.');
          }
        }
      });
    });
    photosList.appendChild(card);
  });
};

const renderLogs = (space) => {
  const logsSource = space.logs ?? [];
  const logs = state.logFilter === 'all'
    ? logsSource
    : logsSource.filter((log) => {
        if (state.logFilter === 'security') {
          return log.type === 'security' || log.type === 'alarm';
        }
        return log.type === state.logFilter;
      });

  logTable.innerHTML = '';
  let lastDate = null;
  logs.forEach((log) => {
    if (log.date && log.date !== lastDate) {
      const divider = document.createElement('div');
      divider.className = 'log-divider';
      divider.textContent = log.date;
      logTable.appendChild(divider);
      lastDate = log.date;
    }
    const row = document.createElement('div');
    row.className = `log-row ${log.type === 'alarm' ? 'log-row--alarm' : ''}`;
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
    const space = spaces.find((item) => item.id === state.selectedSpaceId);
    if (space) {
      renderLogs(space);
    }
  });
});

const globalSearch = document.getElementById('globalSearch');
const deviceSearch = document.getElementById('deviceSearch');
const refreshBtn = document.getElementById('refreshBtn');
const deleteSpaceBtn = document.getElementById('deleteSpace');
const detachHubBtn = document.getElementById('detachHub');

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
    if (space) {
      renderDevices(space);
    }
  });
}

const refreshAll = async () => {
  await loadSpaces();
  if (state.selectedSpaceId && !spaces.some((space) => space.id === state.selectedSpaceId)) {
    state.selectedSpaceId = null;
    state.selectedDeviceId = null;
    localStorage.removeItem('selectedSpaceId');
  }
  const space = spaces.find((item) => item.id === state.selectedSpaceId);
  if (space) {
    await loadLogs(space.id);
  }
  renderAll();
};

if (refreshBtn) {
  refreshBtn.addEventListener('click', async () => {
    await refreshAll();
    showToast('Данные синхронизированы с хабами.');
  });
}

if (deleteSpaceBtn) {
  deleteSpaceBtn.addEventListener('click', async () => {
    if (!ensureEditable()) return;
    const space = spaces.find((item) => item.id === state.selectedSpaceId);
    if (!space) return;

    try {
      await apiFetch(`/api/spaces/${space.id}`, { method: 'DELETE' });
      state.selectedSpaceId = null;
      state.selectedDeviceId = null;
      localStorage.removeItem('selectedSpaceId');
      await refreshAll();
      showToast('Пространство удалено.');
    } catch (error) {
      console.error(error);
      handleApiError(error, 'Не удалось удалить пространство.');
    }
  });
}

if (detachHubBtn) {
  detachHubBtn.addEventListener('click', async () => {
    if (!ensureEditable()) return;
    const space = spaces.find((item) => item.id === state.selectedSpaceId);
    if (!space) return;

    try {
      await apiFetch(`/api/spaces/${space.id}/hub`, { method: 'DELETE' });
      await refreshAll();
      showToast('Хаб удалён из пространства.');
    } catch (error) {
      console.error(error);
      handleApiError(error, 'Не удалось удалить хаб.');
    }
  });
}

const pollLogs = async () => {
  const space = spaces.find((item) => item.id === state.selectedSpaceId);
  if (!space) return;

  try {
    const logs = await apiFetch(`/api/spaces/${space.id}/logs`);
    const lastLog = logs[0];
    const logKey = `${logs.length}-${lastLog?.time ?? ''}-${lastLog?.text ?? ''}`;
    if (logKey !== state.lastLogKey) {
      state.lastLogKey = logKey;
      space.logs = logs;
      renderLogs(space);
    }
  } catch (error) {
    console.error(error);
  }
};

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
      state.selectedDeviceId = null;
      state.lastLogKey = '';
      localStorage.setItem('selectedSpaceId', created.id);
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
    const isZone = value === 'zone';
    const isKey = value === 'key';

    readerFields?.classList.toggle('hidden', !isReader);
    sirenFields?.classList.toggle('hidden', !isSiren);
    lightFields?.classList.toggle('hidden', !isLight);
    zoneFields?.classList.toggle('hidden', !isZone);
    keyFields?.classList.toggle('hidden', !isKey);

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
    zoneFields?.querySelectorAll('input, select').forEach((input) => {
      input.disabled = !isZone;
      if (input.name === 'normalLevel') {
        input.required = isZone;
      }
    });
    keyFields?.querySelectorAll('input').forEach((input) => {
      input.disabled = !isKey;
      if (input.name === 'keyName') {
        input.required = isKey;
      }
    });

    if (sideInput) {
      sideInput.disabled = isKey;
      sideInput.required = !isKey;
      if (isKey) {
        sideInput.value = '';
      }
    }

    [deviceNameInput, deviceRoomInput].forEach((input) => {
      if (!input) return;
      input.disabled = isKey;
      input.required = !isKey;
      if (isKey) {
        input.value = '';
      }
    });
  };

  deviceType.addEventListener('change', updateDeviceFields);
  updateDeviceFields();
}

if (deviceForm) {
  deviceForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!ensureEditable()) return;
    const space = spaces.find((item) => item.id === state.selectedSpaceId);
    if (!space) return;

    const formData = new FormData(deviceForm);
    const payload = Object.fromEntries(formData.entries());
    try {
      if (payload.type === 'key') {
        await apiFetch(`/api/spaces/${space.id}/keys`, {
          method: 'POST',
          body: JSON.stringify({ name: payload.keyName, readerId: payload.readerId }),
        });
      } else {
        await apiFetch(`/api/spaces/${space.id}/devices`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      await loadSpaces();
      await loadLogs(space.id);
      renderAll();
      deviceForm.reset();
      showToast('Устройство добавлено.');
    } catch (error) {
      console.error(error);
      handleApiError(error, 'Не удалось добавить устройство.');
    }
  });
}

if (generateKey && deviceForm) {
  generateKey.addEventListener('click', () => {
    const keyInput = deviceForm.querySelector('input[name=\"keyName\"]');
    if (keyInput) {
      keyInput.value = `KEY-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    }
  });
}

if (contactForm) {
  contactForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!ensureEditable()) return;
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
      handleApiError(error, 'Не удалось добавить контакт.');
    }
  });
}

if (noteForm) {
  noteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!ensureEditable()) return;
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
      handleApiError(error, 'Не удалось добавить примечание.');
    }
  });
}

if (photoForm) {
  photoForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!ensureEditable()) return;
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
      handleApiError(error, 'Не удалось добавить фото.');
    }
  });
}

if (editForm) {
  editForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!ensureEditable()) return;
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
      handleApiError(error, 'Не удалось обновить объект.');
    }
  });
}

if (openCreate && modal) {
  openCreate.addEventListener('click', () => {
    modal.classList.add('modal--open');
  });
}

if (attachHubForm) {
  attachHubForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!ensureEditable()) return;
    const space = spaces.find((item) => item.id === state.selectedSpaceId);
    if (!space) return;

    const formData = new FormData(attachHubForm);
    const payload = Object.fromEntries(formData.entries());
    try {
      await apiFetch(`/api/spaces/${space.id}/attach-hub`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      attachHubForm.reset();
      await refreshAll();
      showToast('Хаб привязан.');
    } catch (error) {
      console.error(error);
      if (error.message === 'space_armed') {
        showGuardModal();
        return;
      }
      showToast('Не удалось привязать хаб.');
    }
  });
}

if (guardModalClose && guardModal) {
  guardModalClose.addEventListener('click', () => {
    guardModal.classList.remove('modal--open');
  });
}

if (guardModalOk && guardModal) {
  guardModalOk.addEventListener('click', () => {
    guardModal.classList.remove('modal--open');
  });
}

if (guardModal) {
  guardModal.addEventListener('click', (event) => {
    if (event.target === guardModal) {
      guardModal.classList.remove('modal--open');
    }
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
  setInterval(pollLogs, 3000);
  setInterval(refreshAll, 12000);
};

init();
