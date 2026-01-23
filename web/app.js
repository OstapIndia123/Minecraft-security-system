const state = {
  filter: 'all',
  selectedSpaceId: null,
  selectedDeviceId: null,
  logFilter: 'all',
  search: '',
  deviceSearch: '',
  lastLogKey: '',
  language: 'ru',
  timezone: 'UTC',
  nickname: '',
  role: 'user',
};

let spaces = [];
const FLASH_DURATION_MS = 15000;
const logFlashActive = new Map();

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
const deviceModal = document.getElementById('deviceModal');
const deviceModalClose = document.getElementById('closeDeviceModal');
const openDeviceModal = document.getElementById('openDeviceModal');
const loadingModal = document.getElementById('loadingModal');
const actionModal = document.getElementById('actionModal');
const actionModalTitle = document.getElementById('actionModalTitle');
const actionModalMessage = document.getElementById('actionModalMessage');
const actionModalForm = document.getElementById('actionModalForm');
const actionModalConfirm = document.getElementById('actionModalConfirm');
const actionModalCancel = document.getElementById('actionModalCancel');
const actionModalClose = document.getElementById('closeActionModal');
const deviceType = document.getElementById('deviceType');
const readerFields = document.getElementById('readerFields');
const sirenFields = document.getElementById('sirenFields');
const lightFields = document.getElementById('lightFields');
const zoneFields = document.getElementById('zoneFields');
const keyFields = document.getElementById('keyFields');
const generateKey = document.getElementById('generateKey');
const readKeyButton = document.getElementById('readKey');
const sideInput = deviceForm?.querySelector('input[name="side"]');
const deviceNameInput = deviceForm?.querySelector('input[name="name"]');
const deviceRoomInput = deviceForm?.querySelector('input[name="room"]');
const readerIdInput = readerFields?.querySelector('input[name="id"]');
const attachHubForm = document.getElementById('attachHubForm');
const guardModal = document.getElementById('guardModal');
const guardModalClose = document.getElementById('closeGuardModal');
const guardModalOk = document.getElementById('guardModalOk');
const backToMain = document.getElementById('backToMain');
const avatarButton = document.getElementById('avatarButton');
const profileDropdown = document.getElementById('profileDropdown');
const profileNickname = document.getElementById('profileNickname');
const profileTimezone = document.getElementById('profileTimezone');
const profileLanguage = document.getElementById('profileLanguage');
const profileLogout = document.getElementById('profileLogout');
const switchToUser = document.getElementById('switchToUser');
const usersList = document.getElementById('usersList');
const usersForm = document.getElementById('usersForm');
const installersList = document.getElementById('installersList');
const installersForm = document.getElementById('installersForm');

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

const translations = {
  ru: {
    'engineer.title': 'Объекты',
    'engineer.subtitle': 'Управление пространствами и событиями',
    'engineer.actions.arm': 'Под охрану',
    'engineer.actions.disarm': 'С охраны',
    'engineer.tabs.equipment': 'Оборудование',
    'engineer.tabs.object': 'Про объект',
    'engineer.tabs.contacts': 'Контактные лица',
    'engineer.tabs.photos': 'Фото',
    'engineer.tabs.notes': 'Примечания',
    'engineer.tabs.log': 'Лог',
    'engineer.equipment.title': 'Оборудование',
    'engineer.equipment.add': 'Добавить устройство',
    'engineer.object.title': 'Информация об объекте',
    'engineer.object.edit': 'Редактировать объект',
    'engineer.object.name': 'Название',
    'engineer.object.coords': 'Координаты',
    'engineer.object.city': 'Город',
    'engineer.object.save': 'Сохранить',
    'engineer.object.removeHub': 'Удалить хаб',
    'engineer.object.delete': 'Удалить объект',
    'engineer.object.attachHub': 'Привязать хаб',
    'engineer.object.hubId': 'ID хаба',
    'engineer.object.attach': 'Привязать',
    'engineer.contacts.title': 'Контактные лица',
    'engineer.contacts.addTitle': 'Добавить контактное лицо',
    'engineer.contacts.name': 'Имя',
    'engineer.contacts.role': 'Роль',
    'engineer.contacts.phone': 'Телефон',
    'engineer.contacts.add': 'Добавить',
    'engineer.photos.title': 'Фото объекта',
    'engineer.photos.addTitle': 'Добавить фото',
    'engineer.photos.url': 'URL изображения',
    'engineer.photos.label': 'Подпись',
    'engineer.photos.add': 'Добавить',
    'engineer.notes.title': 'Примечания',
    'engineer.notes.addTitle': 'Добавить примечание',
    'engineer.notes.text': 'Текст примечания',
    'engineer.notes.add': 'Добавить',
    'engineer.log.title': 'Лог событий',
    'engineer.log.filters.all': 'Все',
    'engineer.log.filters.security': 'Охранные',
    'engineer.log.filters.access': 'Доступ',
    'engineer.log.filters.system': 'Система',
    'engineer.log.filters.hub': 'События хаба',
    'engineer.tabs.users': 'Пользователи',
    'engineer.tabs.installers': 'Инженеры монтажа',
    'engineer.users.title': 'Пользователи',
    'engineer.users.placeholder': 'Добавление пользователей появится вместе с системой аккаунтов.',
    'engineer.installers.title': 'Инженеры монтажа',
    'engineer.installers.placeholder': 'Управление доступами инженеров появится вместе с авторизацией.',
    'engineer.actions.refresh': 'Обновить',
    'engineer.actions.add': 'Добавить объект',
    'engineer.search.global': 'Поиск по объекту или ID',
    'engineer.search.device': 'Поиск по названию или ID',
    'engineer.users.title': 'Пользователи',
    'engineer.users.add': 'Добавить пользователя',
    'engineer.users.email': 'Никнейм или email',
    'engineer.installers.title': 'Инженеры монтажа',
    'engineer.installers.add': 'Добавить инженера',
    'engineer.installers.email': 'Никнейм или email',
    'engineer.installers.note': 'Покинуть объект можно только если есть хотя бы ещё один инженер монтажа.',
    'engineer.members.emptyUsers': 'Нет пользователей',
    'engineer.members.emptyInstallers': 'Нет инженеров',
    'engineer.members.delete': 'Удалить',
    'engineer.empty.devicesSearch': 'Нет устройств по запросу',
    'engineer.empty.photos': 'Нет фотографий',
    'engineer.empty.logs': 'Нет событий по выбранному фильтру',
    'engineer.device.select': 'Выберите устройство',
    'engineer.object.hubId': 'ID хаба',
    'engineer.object.coordsLabel': 'Координаты',
    'engineer.hub.unbound': 'Хаб не привязан',
    'engineer.object.label.name': 'Название',
    'engineer.object.label.coords': 'Координаты',
    'engineer.object.label.city': 'Город',
    'engineer.object.label.hub': 'Хаб',
    'engineer.object.label.hubStatus': 'Статус хаба',
    'engineer.object.label.mode': 'Режим',
    'engineer.hub.online': 'В сети',
    'engineer.hub.offline': 'Не в сети',
    'engineer.hub.none': 'Нет хаба',
    'status.armed': 'Под охраной',
    'status.disarmed': 'Снято с охраны',
    'status.night': 'Ночной режим',
    'profile.title': 'Профиль',
    'profile.nickname': 'Игровой ник',
    'profile.timezone': 'Таймзона',
    'profile.language': 'Язык',
    'profile.switchUser': 'Перейти на обычный',
    'profile.logout': 'Выйти',
  },
  'en-US': {
    'engineer.title': 'Objects',
    'engineer.subtitle': 'Space and event management',
    'engineer.actions.arm': 'Arm',
    'engineer.actions.disarm': 'Disarm',
    'engineer.tabs.equipment': 'Equipment',
    'engineer.tabs.object': 'Object',
    'engineer.tabs.contacts': 'Contacts',
    'engineer.tabs.photos': 'Photos',
    'engineer.tabs.notes': 'Notes',
    'engineer.tabs.log': 'Log',
    'engineer.equipment.title': 'Equipment',
    'engineer.equipment.add': 'Add device',
    'engineer.object.title': 'Object information',
    'engineer.object.edit': 'Edit object',
    'engineer.object.name': 'Name',
    'engineer.object.coords': 'Coordinates',
    'engineer.object.city': 'City',
    'engineer.object.save': 'Save',
    'engineer.object.removeHub': 'Remove hub',
    'engineer.object.delete': 'Delete object',
    'engineer.object.attachHub': 'Attach hub',
    'engineer.object.hubId': 'Hub ID',
    'engineer.object.attach': 'Attach',
    'engineer.contacts.title': 'Contacts',
    'engineer.contacts.addTitle': 'Add contact',
    'engineer.contacts.name': 'Name',
    'engineer.contacts.role': 'Role',
    'engineer.contacts.phone': 'Phone',
    'engineer.contacts.add': 'Add',
    'engineer.photos.title': 'Object photos',
    'engineer.photos.addTitle': 'Add photo',
    'engineer.photos.url': 'Image URL',
    'engineer.photos.label': 'Caption',
    'engineer.photos.add': 'Add',
    'engineer.notes.title': 'Notes',
    'engineer.notes.addTitle': 'Add note',
    'engineer.notes.text': 'Note text',
    'engineer.notes.add': 'Add',
    'engineer.log.title': 'Event log',
    'engineer.log.filters.all': 'All',
    'engineer.log.filters.security': 'Security',
    'engineer.log.filters.access': 'Access',
    'engineer.log.filters.system': 'System',
    'engineer.log.filters.hub': 'Hub events',
    'engineer.tabs.users': 'Users',
    'engineer.tabs.installers': 'Installers',
    'engineer.users.title': 'Users',
    'engineer.users.placeholder': 'User access will appear after authentication is connected.',
    'engineer.installers.title': 'Installers',
    'engineer.installers.placeholder': 'Installer access will appear with authorization.',
    'engineer.actions.refresh': 'Refresh',
    'engineer.actions.add': 'Add object',
    'engineer.search.global': 'Search by object or ID',
    'engineer.search.device': 'Search by name or ID',
    'engineer.users.title': 'Users',
    'engineer.users.add': 'Add user',
    'engineer.users.email': 'Nickname or email',
    'engineer.installers.title': 'Installers',
    'engineer.installers.add': 'Add installer',
    'engineer.installers.email': 'Nickname or email',
    'engineer.installers.note': 'You can leave only if another installer still has access.',
    'engineer.members.emptyUsers': 'No users',
    'engineer.members.emptyInstallers': 'No installers',
    'engineer.members.delete': 'Remove',
    'engineer.empty.devicesSearch': 'No devices for this search',
    'engineer.empty.photos': 'No photos',
    'engineer.empty.logs': 'No events for the selected filter',
    'engineer.device.select': 'Select a device',
    'engineer.object.hubId': 'Hub ID',
    'engineer.object.coordsLabel': 'Coordinates',
    'engineer.hub.unbound': 'Hub not attached',
    'engineer.object.label.name': 'Name',
    'engineer.object.label.coords': 'Coordinates',
    'engineer.object.label.city': 'City',
    'engineer.object.label.hub': 'Hub',
    'engineer.object.label.hubStatus': 'Hub status',
    'engineer.object.label.mode': 'Mode',
    'engineer.hub.online': 'Online',
    'engineer.hub.offline': 'Offline',
    'engineer.hub.none': 'No hub',
    'status.armed': 'Armed',
    'status.disarmed': 'Disarmed',
    'status.night': 'Night',
    'profile.title': 'Profile',
    'profile.nickname': 'Game nickname',
    'profile.timezone': 'Timezone',
    'profile.language': 'Language',
    'profile.switchUser': 'Go to user',
    'profile.logout': 'Sign out',
  },
};

const t = (key) => translations[state.language]?.[key] ?? translations.ru[key] ?? key;

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

const saveProfileSettings = () => {
  localStorage.setItem('profileSettings', JSON.stringify({
    language: state.language,
    timezone: state.timezone,
    nickname: state.nickname,
  }));
};

const syncProfileSettings = async () => {
  try {
    const result = await apiFetch('/api/auth/me');
    if (!result?.user) return;
    state.language = result.user.language ?? state.language;
    state.timezone = result.user.timezone ?? state.timezone;
    state.nickname = result.user.minecraft_nickname ?? state.nickname;
    state.role = result.user.role ?? state.role;
    saveProfileSettings();
  } catch {
    // ignore
  }
};

const showToast = (message) => {
  toast.textContent = message;
  toast.classList.add('toast--show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('toast--show'), 2200);
};

const showLoading = () => {
  loadingModal?.classList.add('modal--open');
};

const hideLoading = () => {
  loadingModal?.classList.remove('modal--open');
};

const openActionModal = ({
  title = 'Подтвердите действие',
  message = '',
  confirmText = 'Подтвердить',
  cancelText = 'Отмена',
  fields = [],
} = {}) => new Promise((resolve) => {
  if (!actionModal || !actionModalConfirm || !actionModalCancel) {
    resolve(null);
    return;
  }

  if (actionModalTitle) actionModalTitle.textContent = title;
  if (actionModalMessage) actionModalMessage.textContent = message;
  actionModalConfirm.textContent = confirmText;
  actionModalCancel.textContent = cancelText;

  if (actionModalForm) {
    actionModalForm.innerHTML = '';
    actionModalForm.classList.toggle('hidden', fields.length === 0);
    fields.forEach((field) => {
      const input = document.createElement('input');
      input.type = field.type ?? 'text';
      input.name = field.name;
      input.placeholder = field.placeholder ?? '';
      input.value = field.value ?? '';
      if (field.required) input.required = true;
      if (field.min !== undefined) input.min = field.min;
      if (field.max !== undefined) input.max = field.max;
      actionModalForm.appendChild(input);
    });
  }

  const close = (result) => {
    actionModalConfirm.removeEventListener('click', handleConfirm);
    actionModalCancel.removeEventListener('click', handleCancel);
    actionModalClose?.removeEventListener('click', handleCancel);
    actionModal.removeEventListener('click', handleBackdrop);
    actionModal.classList.remove('modal--open');
    resolve(result);
  };

  const handleConfirm = () => {
    if (actionModalForm && fields.length && !actionModalForm.reportValidity()) {
      return;
    }
    const values = actionModalForm && fields.length
      ? Object.fromEntries(new FormData(actionModalForm).entries())
      : {};
    close({ confirmed: true, values });
  };

  const handleCancel = () => close(null);
  const handleBackdrop = (event) => {
    if (event.target === actionModal) {
      close(null);
    }
  };

  actionModalConfirm.addEventListener('click', handleConfirm);
  actionModalCancel.addEventListener('click', handleCancel);
  actionModalClose?.addEventListener('click', handleCancel);
  actionModal.addEventListener('click', handleBackdrop);

  actionModal.classList.add('modal--open');
});

const confirmAction = async (message, title = 'Подтвердите действие') => {
  const result = await openActionModal({ title, message, confirmText: 'Удалить' });
  return Boolean(result?.confirmed);
};

const promptAction = async ({ title, message, fields, confirmText = 'Сохранить' }) => {
  const result = await openActionModal({ title, message, confirmText, fields });
  return result?.confirmed ? result.values : null;
};

const setupZoneDelayFields = (form) => {
  if (!form) return;
  const zoneTypeSelect = form.querySelector('select[name="zoneType"]');
  const delayInput = form.querySelector('input[name="delaySeconds"]');
  if (!zoneTypeSelect || !delayInput) return;

  const update = () => {
    const needsDelay = zoneTypeSelect.value === 'delayed';
    delayInput.classList.toggle('hidden', !needsDelay);
    delayInput.disabled = !needsDelay;
    delayInput.required = needsDelay;
    if (!needsDelay) {
      delayInput.value = '';
    }
  };

  zoneTypeSelect.addEventListener('change', update);
  update();
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

const loadSpaces = async () => {
  try {
    spaces = await apiFetch('/api/spaces');
    const params = new URLSearchParams(window.location.search);
    const requestedSpaceId = params.get('spaceId');
    if (requestedSpaceId && spaces.some((space) => space.id === requestedSpaceId)) {
      state.selectedSpaceId = requestedSpaceId;
      localStorage.setItem('selectedSpaceId', requestedSpaceId);
      params.delete('spaceId');
      const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
      window.history.replaceState({}, '', newUrl);
    }
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
      state.lastLogKey = `${logs.length}-${lastLog?.time ?? ''}-${lastLog?.text ?? ''}-${lastLog?.createdAt ?? ''}`;
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
      <div class="object-card__meta">${t('engineer.object.hubId')} ${space.hubId ?? '—'}</div>
      <div class="object-card__status ${statusTone[space.status] ?? ''}">${t(`status.${space.status}`) ?? statusMap[space.status] ?? space.status}</div>
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
  spaceStateEl.textContent = t(`status.${space.status}`) ?? statusMap[space.status] ?? space.status;
  spaceStateEl.className = `status-card__state ${statusTone[space.status] ?? ''}`;
  spaceMetaEl.textContent = `${t('engineer.object.coordsLabel')}: ${space.address} • ${space.city}`;
  hubLabel.textContent = space.hubId ? `Hub ${space.hubId}` : t('engineer.hub.unbound');
};

const renderDevices = (space) => {
  const deviceQuery = state.deviceSearch.trim().toLowerCase();
  const devices = deviceQuery
    ? space.devices.filter((device) => device.name.toLowerCase().includes(deviceQuery))
    : space.devices;

  deviceList.innerHTML = '';
  if (!devices.length) {
    deviceList.innerHTML = `<div class="empty-state">${t('engineer.empty.devicesSearch')}</div>`;
    deviceDetails.innerHTML = `<div class="empty-state">${t('engineer.device.select')}</div>`;
    return;
  }

  if (!state.selectedDeviceId || !devices.some((device) => device.id === state.selectedDeviceId)) {
    state.selectedDeviceId = devices[0].id;
  }

  devices.forEach((device) => {
    const statusText = device.type === 'zone' || device.type === 'hub' ? device.status : '';
    const item = document.createElement('button');
    item.className = `device-item ${device.id === state.selectedDeviceId ? 'device-item--active' : ''}`;
    item.innerHTML = `
      <div>
        <div class="device-item__title">${device.name}</div>
        <div class="device-item__meta">${device.room}</div>
      </div>
      <span class="device-item__status">${statusText}</span>
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
  const statusBlock = device.type === 'zone' || device.type === 'hub'
    ? `
      <div class="stat">
        <span>Статус</span>
        <strong>${device.status}</strong>
      </div>
    `
    : '';
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
        <select name="silent">
          <option value="false" ${device.config?.silent ? '' : 'selected'}>Тихая: нет</option>
          <option value="true" ${device.config?.silent ? 'selected' : ''}>Тихая: да</option>
        </select>
        <input
          type="number"
          name="delaySeconds"
          class="zone-delay hidden"
          value="${device.config?.delaySeconds ?? ''}"
          min="1"
          placeholder="Задержка (сек)"
        />
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
        <input type="number" name="alarmDuration" value="${device.config?.alarmDuration ?? ''}" min="1" placeholder="Время тревоги (сек)" />
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
      ${statusBlock}
      <div class="stat">
        <span>Тип</span>
        <strong>${device.type}</strong>
      </div>
      <div class="stat">
        <span>ID</span>
        <strong>${device.id}</strong>
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
          if (!await confirmAction('Удалить ключ?', 'Удаление ключа')) return;
          showLoading();
          await apiFetch(`/api/spaces/${space.id}/keys/${device.config.keyId}`, { method: 'DELETE' });
        } else {
          if (!await confirmAction('Удалить устройство?', 'Удаление устройства')) return;
          showLoading();
          await apiFetch(`/api/spaces/${space.id}/devices/${device.id}`, { method: 'DELETE' });
        }
        await loadSpaces();
        await loadLogs(space.id);
        renderAll();
        showToast('Устройство удалено.');
      } catch (error) {
        console.error(error);
        handleApiError(error, 'Не удалось удалить устройство.');
      } finally {
        hideLoading();
      }
    });
  }

  const editForm = document.getElementById('deviceEditForm');
  if (editForm) {
    if (device.type === 'zone') {
      setupZoneDelayFields(editForm);
    }
    editForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!ensureEditable()) return;
      const space = spaces.find((item) => item.id === state.selectedSpaceId);
      if (!space) return;

      const formData = new FormData(editForm);
      const payload = Object.fromEntries(formData.entries());
      try {
        showLoading();
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
      } finally {
        hideLoading();
      }
    });
  }
};

const renderObjectInfo = (space) => {
  objectInfo.innerHTML = `
    <div class="info-card">
      <span>${t('engineer.object.label.name')}</span>
      <strong>${space.name}</strong>
    </div>
    <div class="info-card">
      <span>${t('engineer.object.label.coords')}</span>
      <strong>${space.address}</strong>
    </div>
    <div class="info-card">
      <span>${t('engineer.object.label.city')}</span>
      <strong>${space.city}</strong>
    </div>
    <div class="info-card">
      <span>${t('engineer.object.label.hub')}</span>
      <strong>${space.hubId ?? '—'}</strong>
    </div>
    <div class="info-card">
      <span>${t('engineer.object.label.hubStatus')}</span>
      <strong>${space.hubId ? (space.hubOnline ? t('engineer.hub.online') : t('engineer.hub.offline')) : t('engineer.hub.none')}</strong>
    </div>
    <div class="info-card">
      <span>${t('engineer.object.label.mode')}</span>
      <strong>${t(`status.${space.status}`) ?? space.status}</strong>
    </div>
  `;

  if (editForm) {
    editForm.name.value = space.name;
    editForm.address.value = space.address;
    editForm.city.value = space.city;
  }
};

const renderMembers = (members) => {
  const installers = members.filter((member) => member.role === 'installer');
  const users = members.filter((member) => member.role !== 'installer');

  if (usersList) {
    usersList.innerHTML = '';
    if (!users.length) {
      usersList.innerHTML = `<div class="empty-state">${t('engineer.members.emptyUsers')}</div>`;
    } else {
      users.forEach((member) => {
        const card = document.createElement('div');
        card.className = 'member-card';
        const label = member.minecraft_nickname ? `${member.minecraft_nickname} (${member.email})` : member.email;
        card.innerHTML = `
          <div>
            <div class="member-card__title">${label}</div>
            <div class="member-card__meta">ID: ${member.id}</div>
          </div>
          <button class="button button--ghost button--danger" data-member-id="${member.id}">
            ${t('engineer.members.delete')}
          </button>
        `;
        card.querySelector('button').addEventListener('click', async () => {
          try {
            showLoading();
            await removeMember(member.id);
          } catch (error) {
            handleApiError(error, 'Не удалось удалить пользователя.');
          } finally {
            hideLoading();
          }
        });
        usersList.appendChild(card);
      });
    }
  }

  if (installersList) {
    installersList.innerHTML = '';
    if (!installers.length) {
      installersList.innerHTML = `<div class="empty-state">${t('engineer.members.emptyInstallers')}</div>`;
    } else {
      installers.forEach((member) => {
        const card = document.createElement('div');
        card.className = 'member-card';
        const label = member.minecraft_nickname ? `${member.minecraft_nickname} (${member.email})` : member.email;
        card.innerHTML = `
          <div>
            <div class="member-card__title">${label}</div>
            <div class="member-card__meta">ID: ${member.id}</div>
          </div>
          <button class="button button--ghost button--danger" data-member-id="${member.id}">
            ${t('engineer.members.delete')}
          </button>
        `;
        card.querySelector('button').addEventListener('click', async () => {
          try {
            showLoading();
            await removeMember(member.id);
          } catch (error) {
            if (error.message === 'last_installer') {
              showToast('Нельзя удалить последнего инженера монтажа.');
            } else {
              handleApiError(error, 'Не удалось удалить инженера.');
            }
          } finally {
            hideLoading();
          }
        });
        installersList.appendChild(card);
      });
    }
  }
};

const loadMembers = async () => {
  if (!state.selectedSpaceId) return;
  const members = await apiFetch(`/api/spaces/${state.selectedSpaceId}/members`);
  renderMembers(members);
};

const addMember = async (role, identifier) => {
  if (!state.selectedSpaceId) return;
  await apiFetch(`/api/spaces/${state.selectedSpaceId}/members`, {
    method: 'POST',
    body: JSON.stringify({ identifier, role }),
  });
  await loadMembers();
};

const removeMember = async (userId) => {
  if (!state.selectedSpaceId) return;
  await apiFetch(`/api/spaces/${state.selectedSpaceId}/members/${userId}`, { method: 'DELETE' });
  await loadMembers();
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
            if (!await confirmAction('Удалить контактное лицо?', 'Удаление контакта')) return;
            showLoading();
            await apiFetch(`/api/spaces/${space.id}/contacts/${index}`, { method: 'DELETE' });
            await refreshAll();
            showToast('Контакт удалён.');
          } catch (error) {
            console.error(error);
            handleApiError(error, 'Не удалось удалить контакт.');
          } finally {
            hideLoading();
          }
        } else {
          try {
            const values = await promptAction({
              title: 'Изменить контакт',
              message: 'Обновите данные контактного лица.',
              fields: [
                { name: 'name', placeholder: 'Имя', value: contact.name, required: true },
                { name: 'role', placeholder: 'Роль', value: contact.role },
                { name: 'phone', placeholder: 'Телефон', value: contact.phone },
              ],
            });
            if (!values) return;
            showLoading();
            const { name, role, phone } = values;
            await apiFetch(`/api/spaces/${space.id}/contacts/${index}`, {
              method: 'PATCH',
              body: JSON.stringify({ name, role, phone }),
            });
            await refreshAll();
            showToast('Контакт обновлён.');
          } catch (error) {
            console.error(error);
            handleApiError(error, 'Не удалось обновить контакт.');
          } finally {
            hideLoading();
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
            if (!await confirmAction('Удалить примечание?', 'Удаление примечания')) return;
            showLoading();
            await apiFetch(`/api/spaces/${space.id}/notes/${index}`, { method: 'DELETE' });
            await refreshAll();
            showToast('Примечание удалено.');
          } catch (error) {
            console.error(error);
            handleApiError(error, 'Не удалось удалить примечание.');
          } finally {
            hideLoading();
          }
        } else {
          try {
            const values = await promptAction({
              title: 'Изменить примечание',
              message: 'Обновите текст примечания.',
              fields: [
                { name: 'text', placeholder: 'Текст примечания', value: note, required: true },
              ],
            });
            if (!values) return;
            showLoading();
            const { text } = values;
            await apiFetch(`/api/spaces/${space.id}/notes/${index}`, {
              method: 'PATCH',
              body: JSON.stringify({ text }),
            });
            await refreshAll();
            showToast('Примечание обновлено.');
          } catch (error) {
            console.error(error);
            handleApiError(error, 'Не удалось обновить примечание.');
          } finally {
            hideLoading();
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
    photosList.innerHTML = `<div class="empty-state">${t('engineer.empty.photos')}</div>`;
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
            if (!await confirmAction('Удалить фото?', 'Удаление фото')) return;
            showLoading();
            await apiFetch(`/api/spaces/${space.id}/photos/${index}`, { method: 'DELETE' });
            await refreshAll();
            showToast('Фото удалено.');
          } catch (error) {
            console.error(error);
            handleApiError(error, 'Не удалось удалить фото.');
          } finally {
            hideLoading();
          }
        } else {
          try {
            const values = await promptAction({
              title: 'Изменить фото',
              message: 'Обновите ссылку и подпись.',
              fields: [
                { name: 'url', placeholder: 'URL фото', value: photo.url, required: true, type: 'url' },
                { name: 'label', placeholder: 'Подпись', value: photo.label },
              ],
            });
            if (!values) return;
            showLoading();
            const { url, label } = values;
            await apiFetch(`/api/spaces/${space.id}/photos/${index}`, {
              method: 'PATCH',
              body: JSON.stringify({ url, label }),
            });
            await refreshAll();
            showToast('Фото обновлено.');
          } catch (error) {
            console.error(error);
            handleApiError(error, 'Не удалось обновить фото.');
          } finally {
            hideLoading();
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
    ? logsSource.filter((log) => log.type !== 'hub_raw')
    : logsSource.filter((log) => {
        if (state.logFilter === 'security') {
          return log.type === 'security' || log.type === 'alarm' || log.type === 'restore';
        }
        if (state.logFilter === 'hub') {
          return log.type === 'hub_raw';
        }
        return log.type === state.logFilter;
      });

  logTable.innerHTML = '';
  let lastDate = null;
  logs.forEach((log) => {
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
    const flashKey = `logFlash:${space.id}:${logTimestamp ?? log.time}:${log.text}`;
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
      <span class="muted">${log.who}</span>
    `;
    logTable.appendChild(row);
  });

  if (!logs.length) {
    logTable.innerHTML = `<div class="empty-state">${t('engineer.empty.logs')}</div>`;
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
        showLoading();
        if (action === 'arm') {
          const updated = await apiFetch(`/api/spaces/${space.id}/arm`, { method: 'POST' });
          Object.assign(space, updated);
          showToast(updated.pendingArm ? 'Запущена постановка под охрану.' : 'Объект поставлен под охрану.');
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
    } finally {
      hideLoading();
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
  await loadMembers();
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
      if (!await confirmAction('Удалить объект?', 'Удаление объекта')) return;
      showLoading();
      await apiFetch(`/api/spaces/${space.id}`, { method: 'DELETE' });
      state.selectedSpaceId = null;
      state.selectedDeviceId = null;
      localStorage.removeItem('selectedSpaceId');
      await refreshAll();
      showToast('Пространство удалено.');
    } catch (error) {
      console.error(error);
      handleApiError(error, 'Не удалось удалить пространство.');
    } finally {
      hideLoading();
    }
  });
}

if (detachHubBtn) {
  detachHubBtn.addEventListener('click', async () => {
    if (!ensureEditable()) return;
    const space = spaces.find((item) => item.id === state.selectedSpaceId);
    if (!space) return;

    try {
      if (!await confirmAction('Удалить хаб из пространства?', 'Удаление хаба')) return;
      showLoading();
      await apiFetch(`/api/spaces/${space.id}/hub`, { method: 'DELETE' });
      await refreshAll();
      showToast('Хаб удалён из пространства.');
    } catch (error) {
      console.error(error);
      handleApiError(error, 'Не удалось удалить хаб.');
    } finally {
      hideLoading();
    }
  });
}

const pollLogs = async () => {
  const space = spaces.find((item) => item.id === state.selectedSpaceId);
  if (!space) return;

  try {
    const logs = await apiFetch(`/api/spaces/${space.id}/logs`);
    const lastLog = logs[0];
    const logKey = `${logs.length}-${lastLog?.time ?? ''}-${lastLog?.text ?? ''}-${lastLog?.createdAt ?? ''}`;
    if (logKey !== state.lastLogKey) {
      state.lastLogKey = logKey;
      space.logs = logs;
      renderLogs(space);
      if (lastLog?.type === 'alarm' || lastLog?.type === 'restore') {
        await refreshAll();
      }
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
      showLoading();
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
    } finally {
      hideLoading();
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
      input.required = isReader && input.name === 'id';
    });
    sirenFields?.querySelectorAll('input').forEach((input) => {
      input.disabled = !isSiren;
      input.required = isSiren && input.name !== 'alarmDuration';
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

    if (readerIdInput && !isReader) {
      readerIdInput.value = '';
    }
  };

  deviceType.addEventListener('change', updateDeviceFields);
  updateDeviceFields();
  setupZoneDelayFields(deviceForm);
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
      showLoading();
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
      deviceModal?.classList.remove('modal--open');
    } catch (error) {
      console.error(error);
      handleApiError(error, 'Не удалось добавить устройство.');
    } finally {
      hideLoading();
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

if (readKeyButton && deviceForm) {
  readKeyButton.addEventListener('click', async () => {
    const space = spaces.find((item) => item.id === state.selectedSpaceId);
    if (!space) return;

    let countdown;
    try {
      readKeyButton.disabled = true;
      let remaining = 60;
      readKeyButton.textContent = `Считывание (${remaining})`;
      countdown = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) return;
        readKeyButton.textContent = `Считывание (${remaining})`;
      }, 1000);

      const scan = await apiFetch(`/api/spaces/${space.id}/await-key-scan`);
      const keyInput = deviceForm.querySelector('input[name=\"keyName\"]');
      const readerInput = deviceForm.querySelector('input[name=\"readerId\"]');
      if (keyInput) keyInput.value = scan.keyName ?? '';
      if (readerInput) readerInput.value = scan.readerId ?? '';
      showToast('Ключ считан.');
    } catch (error) {
      console.error(error);
      handleApiError(error, 'Не удалось считать ключ.');
    } finally {
      readKeyButton.disabled = false;
      readKeyButton.textContent = 'Считать ключ';
      if (countdown) {
        clearInterval(countdown);
      }
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
      showLoading();
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
    } finally {
      hideLoading();
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
      showLoading();
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
    } finally {
      hideLoading();
    }
  });
}

if (usersForm) {
  usersForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.selectedSpaceId) return;
    const identifier = usersForm.identifier.value.trim();
    if (!identifier) return;
    try {
      showLoading();
      await addMember('user', identifier);
      usersForm.reset();
      showToast('Пользователь добавлен.');
    } catch (error) {
      handleApiError(error, 'Не удалось добавить пользователя.');
    } finally {
      hideLoading();
    }
  });
}

if (installersForm) {
  installersForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.selectedSpaceId) return;
    const identifier = installersForm.identifier.value.trim();
    if (!identifier) return;
    try {
      showLoading();
      await addMember('installer', identifier);
      installersForm.reset();
      showToast('Инженер добавлен.');
    } catch (error) {
      handleApiError(error, 'Не удалось добавить инженера.');
    } finally {
      hideLoading();
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
      showLoading();
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
    } finally {
      hideLoading();
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
      showLoading();
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
    } finally {
      hideLoading();
    }
  });
}

if (openCreate && modal) {
  openCreate.addEventListener('click', () => {
    modal.classList.add('modal--open');
  });
}

if (backToMain) {
  backToMain.addEventListener('click', () => {
    window.location.href = 'index.html';
  });
}

if (openDeviceModal && deviceModal) {
  openDeviceModal.addEventListener('click', () => {
    deviceModal.classList.add('modal--open');
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
      showLoading();
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
    } finally {
      hideLoading();
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

if (deviceModalClose && deviceModal) {
  deviceModalClose.addEventListener('click', () => {
    deviceModal.classList.remove('modal--open');
  });
}

if (modal) {
  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      modal.classList.remove('modal--open');
    }
  });
}

if (deviceModal) {
  deviceModal.addEventListener('click', (event) => {
    if (event.target === deviceModal) {
      deviceModal.classList.remove('modal--open');
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
    apiFetch('/api/auth/me', {
      method: 'PATCH',
      body: JSON.stringify({ minecraft_nickname: state.nickname }),
    }).catch(() => null);
  });
  profileTimezone?.addEventListener('change', (event) => {
    state.timezone = event.target.value;
    saveProfileSettings();
    apiFetch('/api/auth/me', { method: 'PATCH', body: JSON.stringify({ timezone: state.timezone }) }).catch(() => null);
    loadLogs(state.selectedSpaceId).catch(() => null);
  });
  profileLanguage?.addEventListener('change', (event) => {
    state.language = event.target.value;
    saveProfileSettings();
    applyTranslations();
    apiFetch('/api/auth/me', { method: 'PATCH', body: JSON.stringify({ language: state.language }) }).catch(() => null);
  });
  profileLogout?.addEventListener('click', async () => {
    state.nickname = '';
    saveProfileSettings();
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
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

const init = async () => {
  if (!getAuthToken()) {
    window.location.href = 'login.html';
    return;
  }
  await initProfileMenu();
  if (state.role !== 'installer') {
    window.location.href = 'user.html';
    return;
  }
  await loadSpaces();
  if (state.selectedSpaceId) {
    await loadLogs(state.selectedSpaceId);
  }
  renderAll();
  if (modal) {
    const params = new URLSearchParams(window.location.search);
    if (params.get('create') === '1') {
      modal.classList.add('modal--open');
      params.delete('create');
      const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
      window.history.replaceState({}, '', newUrl);
    }
  }
  setInterval(pollLogs, 3000);
  setInterval(refreshAll, 12000);
};

init();
