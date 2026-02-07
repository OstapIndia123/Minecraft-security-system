const isAdminPage = document.body?.dataset?.admin === 'true'
  || window.location.pathname.toLowerCase().includes('admin-panel')
  || Boolean(document.getElementById('adminLoginModal'));
const profileStorageKey = isAdminPage ? 'profileSettingsAdmin' : 'profileSettings';
const adminTokenKey = 'adminToken';

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
  lastNicknameChangeAt: null,
  lastSpaceCreateAt: null,
  spaceCreateLockUntil: null,
  avatarUrl: '',
  role: 'user',
  logsOffset: 0,
  logsHasMore: true,
};

const detectBrowserLanguage = () => {
  const lang = navigator.language ?? 'ru';
  return lang.toLowerCase().startsWith('en') ? 'en-US' : 'ru';
};

let spaces = [];
const FLASH_DURATION_MS = 15000;
const logFlashActive = new Map();
const NICKNAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const SPACE_CREATE_COOLDOWN_MS = 15 * 60 * 1000;
const ALARM_SOUND_PATH = '/alarm.mp3';
const ALARM_SOUND_COOLDOWN_MS = 5000;
const HUB_EXTENSION_TYPES = new Set([
  'hub_extension',
  'hub-extension',
  'hub extension',
  'hubextension',
  'extension',
]);

const isHubExtensionType = (type) => {
  if (typeof type !== 'string') return false;
  return HUB_EXTENSION_TYPES.has(type.trim().toLowerCase());
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const alarmAudio = typeof Audio !== 'undefined' ? new Audio(ALARM_SOUND_PATH) : null;
if (alarmAudio) {
  alarmAudio.loop = true;
  alarmAudio.preload = 'auto';
}
let alarmAudioActive = false;
let lastAlarmSoundAt = 0;

const setAlarmSoundActive = async (active) => {
  if (!alarmAudio) return;
  if (active === alarmAudioActive) return;
  alarmAudioActive = active;
  if (active) {
    const now = Date.now();
    if (now - lastAlarmSoundAt < ALARM_SOUND_COOLDOWN_MS) return;
    lastAlarmSoundAt = now;
    try {
      await alarmAudio.play();
    } catch {
      // Ignore autoplay restrictions until user interaction.
    }
  } else {
    alarmAudio.pause();
    alarmAudio.currentTime = 0;
  }
};

const notifySecurityEvent = async ({ title, body, tag }) => {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'denied') return;
  if (Notification.permission === 'default') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;
  }
  try {
    new Notification(title, { body, tag });
  } catch {
    // Ignore notification failures in unsupported contexts.
  }
};

const notifyLogEvent = async (space, log) => {
  if (!space || !log) return;
  if (log.type !== 'security' && log.type !== 'alarm') return;
  const key = `notify:${space.id}:${log.createdAt ?? log.time}:${log.text}`;
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, String(Date.now()));
  const title = log.type === 'alarm' ? 'Охранное событие: тревога' : 'Охранное событие';
  const body = `${space.name}: ${log.text}`;
  await notifySecurityEvent({ title, body, tag: key });
};

(() => {
  const maxAge = 24 * 60 * 60 * 1000;
  const now = Date.now();
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && (k.startsWith('notify:') || k.startsWith('logFlash:'))) {
      const ts = Number(localStorage.getItem(k));
      if (!ts || now - ts > maxAge) localStorage.removeItem(k);
    }
  }
})();

const objectList = document.getElementById('objectList');
const spaceNameEl = document.getElementById('spaceName');
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
const spaceSubmitButton = spaceForm?.querySelector('button[type="submit"]');
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
const sideInput = deviceForm?.querySelector('select[name="side"]');
const deviceNameInput = deviceForm?.querySelector('input[name="name"]');
const deviceRoomInput = deviceForm?.querySelector('input[name="room"]');
const bindTargetInput = deviceForm?.querySelector('select[name="bindTarget"]');
const bindExtensionInput = deviceForm?.querySelector('select[name="bindExtensionId"]');
const deviceGroupSelect = document.getElementById('deviceGroupSelect');
const bindingFields = document.getElementById('bindingFields');
const extensionFields = document.getElementById('extensionFields');
const readerIdInput = readerFields?.querySelector('input[name="id"]');
const attachHubForm = document.getElementById('attachHubForm');
const guardModal = document.getElementById('guardModal');
const guardModalClose = document.getElementById('closeGuardModal');
const guardModalOk = document.getElementById('guardModalOk');
const backToMain = document.getElementById('backToMain');
const avatarButton = document.getElementById('avatarButton');
const profileDropdown = document.getElementById('profileDropdown');
const profileNickname = document.getElementById('profileNickname');
const profileNicknameChange = document.getElementById('profileNicknameChange');
const profileTimezone = document.getElementById('profileTimezone');
const profileLanguage = document.getElementById('profileLanguage');
const profileLogout = document.getElementById('profileLogout');
const switchToUser = document.getElementById('switchToUser');
const avatarImages = document.querySelectorAll('[data-avatar]');
const avatarFallbacks = document.querySelectorAll('[data-avatar-fallback]');
const usersList = document.getElementById('usersList');
const usersForm = document.getElementById('usersForm');
const installersList = document.getElementById('installersList');
const installersForm = document.getElementById('installersForm');

const noteInput = noteForm?.querySelector('textarea[name="text"]');
const autoResize = (element) => {
  element.style.height = 'auto';
  element.style.height = `${element.scrollHeight}px`;
};
if (noteInput) {
  autoResize(noteInput);
  noteInput.addEventListener('input', () => autoResize(noteInput));
}

const statusMap = {
  armed: 'Под охраной',
  disarmed: 'Снято с охраны',
  night: 'Ночной режим',
  partial: 'Частично под охраной',
};

const getStatusLabel = (status) => {
  const key = `status.${status}`;
  const translated = t(key);
  if (!translated || translated === key) {
    return statusMap[status] ?? status;
  }
  return translated;
};

const statusTone = {
  armed: 'status--armed',
  disarmed: 'status--disarmed',
  night: 'status--night',
  partial: 'status--partial',
};

const chipActions = document.querySelectorAll('.status-actions .chip');
const filterButtons = document.querySelectorAll('.nav-pill');
const logFilters = document.querySelectorAll('#logFilters .chip');
const logMoreButton = document.getElementById('logMore');

const translations = {
  ru: {
    'admin.title': 'Админ-панель',
    'admin.subtitle': 'Полный доступ ко всем объектам',
    'admin.actions.users': 'Админ',
    'admin.users.title': 'Пользователи',
    'admin.login.title': 'Вход в админ-панель',
    'admin.login.password': 'Пароль',
    'admin.login.submit': 'Войти',
    'admin.logs.title': 'Логи',
    'admin.logs.days': 'Удалить старше (дней)',
    'admin.logs.purge': 'Очистить логи',
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
    'engineer.object.server': 'Сервер',
    'engineer.object.city': 'Город',
    'engineer.object.save': 'Сохранить',
    'engineer.object.removeHub': 'Удалить хаб',
    'engineer.object.delete': 'Удалить объект',
    'engineer.object.attachHub': 'Привязать хаб',
    'engineer.object.hubId': 'ID хаба',
    'engineer.object.hubOffline': 'Хаб не в сети',
    'engineer.object.attach': 'Привязать',
    'log.actions.more': 'Показать ещё',
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
    'engineer.filters.all': 'Все объекты',
    'engineer.filters.offline': 'С хабами не в сети',
    'engineer.filters.issues': 'С неисправностями',
    'engineer.users.add': 'Добавить пользователя',
    'engineer.users.email': 'Никнейм',
    'engineer.installers.add': 'Добавить инженера',
    'engineer.installers.email': 'Никнейм',
    'engineer.installers.note': 'Покинуть объект можно только если есть хотя бы ещё один инженер монтажа.',
    'engineer.members.emptyUsers': 'Нет пользователей',
    'engineer.members.emptyInstallers': 'Нет инженеров',
    'engineer.members.delete': 'Удалить',
    'engineer.members.leave': 'Покинуть пространство',
    'engineer.members.you': 'вы',
    'engineer.members.groups': 'Группы',
    'engineer.members.groupsTitle': 'Доступные группы',
    'engineer.members.groupsEmpty': 'Нет доступных групп',
    'engineer.empty.devicesSearch': 'Нет устройств по запросу',
    'engineer.empty.photos': 'Нет фотографий',
    'engineer.empty.logs': 'Нет событий по выбранному фильтру',
    'engineer.device.select': 'Выберите устройство',
    'engineer.object.coordsLabel': 'Координаты',
    'engineer.hub.unbound': 'Хаб не привязан',
    'engineer.object.label.name': 'Название',
    'engineer.object.label.coords': 'Координаты',
    'engineer.object.label.server': 'Сервер',
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
    'status.partial': 'Частично под охраной',
    'engineer.tabs.groups': 'Группы',
    'engineer.groups.title': 'Группы охраны',
    'engineer.groups.enable': 'Включить режим групп',
    'engineer.groups.name': 'Название группы',
    'engineer.groups.add': 'Создать',
    'engineer.groups.manage': 'Управление',
    'engineer.groups.manageTitle': 'Управление группами',
    'engineer.groups.arm': 'Под охрану',
    'engineer.groups.disarm': 'С охраны',
    'engineer.groups.delete': 'Удалить',
    'engineer.groups.rename': 'Переименовать',
    'engineer.groups.devices': 'Устройства',
    'engineer.groups.noDevices': 'Нет устройств',
    'engineer.groups.ungrouped': 'Без группы',
    'engineer.groups.noGroups': 'Нет групп',
    'engineer.groups.groupId': 'Группа',
    'engineer.groups.none': 'Без группы',
    'engineer.groups.assign.title': 'Назначение устройств',
    'engineer.groups.assign.device': 'Устройство',
    'engineer.groups.assign.group': 'Группа',
    'engineer.groups.assign.apply': 'Применить',
    'engineer.groups.assign.empty': 'Нет доступных устройств',
    'errors.groupLimit': 'В пространство можно добавить до 32 групп.',
    'profile.title': 'Профиль',
    'profile.nickname': 'Игровой ник',
    'profile.nickname.change': 'Сменить',
    'profile.timezone': 'Часовой пояс',
    'profile.language': 'Язык',
    'profile.switchUser': 'Перейти на обычный',
    'profile.logout': 'Выйти',
    'common.save': 'Сохранить',
    'errors.extensionLimit': 'В пространство можно добавить до 5 расширителей.',
    'errors.deviceTypeLimit': 'В пространство можно добавить до 6 устройств каждого типа.',
    'errors.zoneLimit': 'В пространство можно добавить до 32 зон.',
    'errors.keyLimit': 'В пространство можно добавить до 32 ключей.',
    'common.close': 'Закрыть',
    'common.back': 'Назад',
    'common.loading': 'Выполняется действие...',
    'common.actionConfirmTitle': 'Подтвердите действие',
    'common.cancel': 'Отмена',
    'common.confirm': 'Подтвердить',
    'common.guardTitle': 'Действие недоступно',
    'common.guardMessage': 'Невозможно выполнить действие: объект под охраной.',
    'common.ok': 'Понятно',
    'engineer.spaceModal.title': 'Создать пространство',
    'engineer.spaceModal.hubId': 'ID хаба',
    'engineer.spaceModal.name': 'Название',
    'engineer.spaceModal.address': 'Координаты',
    'engineer.spaceModal.server': 'Сервер',
    'engineer.spaceModal.city': 'Город',
    'engineer.spaceModal.submit': 'Создать',
    'engineer.deviceModal.title': 'Добавить устройство',
    'engineer.deviceModal.name': 'Имя устройства',
    'engineer.deviceModal.room': 'Комната',
    'engineer.deviceModal.type.zone': 'Шлейф/зона',
    'engineer.deviceModal.type.outputLight': 'Постановочный светодиод',
    'engineer.deviceModal.type.siren': 'Сирена',
    'engineer.deviceModal.type.reader': 'Считыватель',
    'engineer.deviceModal.type.extension': 'Модуль расширения',
    'engineer.deviceModal.type.key': 'Ключ',
    'engineer.deviceModal.side': 'Сторона (N/S/E/W/U/D)',
    'engineer.deviceModal.bindTarget.hub': 'К хабу',
    'engineer.deviceModal.bindTarget.extension': 'К модулю расширения',
    'engineer.deviceModal.bindExtension.empty': 'Нет модулей расширения',
    'engineer.deviceModal.bindExtension.select': 'Выберите модуль',
    'engineer.deviceModal.extension.id': 'ID модуля (HUB_EXT-...)',
    'engineer.deviceModal.extension.hubSide': 'Сторона хаба (N/S/E/W/U/D)',
    'engineer.deviceModal.extension.extensionSide': 'Сторона модуля (N/S/E/W/U/D)',
    'engineer.deviceModal.zoneType.instant': 'Нормальная',
    'engineer.deviceModal.zoneType.delayed': 'Задержанная',
    'engineer.deviceModal.zoneType.pass': 'Проходная',
    'engineer.deviceModal.zoneType.24h': '24-часовая',
    'engineer.deviceModal.bypass.false': 'Обход: нет',
    'engineer.deviceModal.bypass.true': 'Обход: да',
    'engineer.deviceModal.silent.false': 'Тихая: нет',
    'engineer.deviceModal.silent.true': 'Тихая: да',
    'engineer.deviceModal.delaySeconds': 'Задержка (сек)',
    'engineer.deviceModal.normalLevel': 'Норма уровня',
    'engineer.deviceModal.outputLevel': 'Уровень сигнала',
    'engineer.deviceModal.intervalMs': 'Интервал (мс)',
    'engineer.deviceModal.alarmDuration': 'Время тревоги (сек)',
    'engineer.deviceModal.reader.id': 'ID считывателя',
    'engineer.deviceModal.reader.outputLevel': 'Выходной уровень',
    'engineer.deviceModal.reader.inputLevel': 'Входной уровень',
    'engineer.deviceModal.key.name': 'Имя ключа',
    'engineer.deviceModal.key.readerId': 'ID считывателя',
    'engineer.deviceModal.key.read': 'Считать ключ',
    'engineer.deviceModal.key.generate': 'Сгенерировать',
    'engineer.deviceModal.submit': 'Добавить',
    'page.title.engineer': 'Minecraft Security System — Режим инженера',
    'page.title.admin': 'Minecraft Security System — Админ-панель',
  },
  'en-US': {
    'admin.title': 'Admin panel',
    'admin.subtitle': 'Full access to all spaces',
    'admin.actions.users': 'Admin',
    'admin.users.title': 'Users',
    'admin.login.title': 'Admin login',
    'admin.login.password': 'Password',
    'admin.login.submit': 'Sign in',
    'admin.logs.title': 'Logs',
    'admin.logs.days': 'Delete older than (days)',
    'admin.logs.purge': 'Purge logs',
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
    'engineer.object.server': 'Server',
    'engineer.object.city': 'City',
    'engineer.object.save': 'Save',
    'engineer.object.removeHub': 'Remove hub',
    'engineer.object.delete': 'Delete object',
    'engineer.object.attachHub': 'Attach hub',
    'engineer.object.hubId': 'Hub ID',
    'engineer.object.hubOffline': 'Hub offline',
    'engineer.object.attach': 'Attach',
    'log.actions.more': 'Show more',
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
    'engineer.filters.all': 'All objects',
    'engineer.filters.offline': 'Offline hubs',
    'engineer.filters.issues': 'With issues',
    'engineer.users.add': 'Add user',
    'engineer.users.email': 'Nickname',
    'engineer.installers.add': 'Add installer',
    'engineer.installers.email': 'Nickname',
    'engineer.installers.note': 'You can leave only if another installer still has access.',
    'engineer.members.emptyUsers': 'No users',
    'engineer.members.emptyInstallers': 'No installers',
    'engineer.members.delete': 'Remove',
    'engineer.members.leave': 'Leave space',
    'engineer.members.you': 'you',
    'engineer.members.groups': 'Groups',
    'engineer.members.groupsTitle': 'Allowed groups',
    'engineer.members.groupsEmpty': 'No groups available',
    'engineer.empty.devicesSearch': 'No devices for this search',
    'engineer.empty.photos': 'No photos',
    'engineer.empty.logs': 'No events for the selected filter',
    'engineer.device.select': 'Select a device',
    'engineer.object.coordsLabel': 'Coordinates',
    'engineer.hub.unbound': 'Hub not attached',
    'engineer.object.label.name': 'Name',
    'engineer.object.label.coords': 'Coordinates',
    'engineer.object.label.server': 'Server',
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
    'status.partial': 'Partially armed',
    'engineer.tabs.groups': 'Groups',
    'engineer.groups.title': 'Security groups',
    'engineer.groups.enable': 'Enable groups mode',
    'engineer.groups.name': 'Group name',
    'engineer.groups.add': 'Create',
    'engineer.groups.manage': 'Manage',
    'engineer.groups.manageTitle': 'Manage groups',
    'engineer.groups.arm': 'Arm',
    'engineer.groups.disarm': 'Disarm',
    'engineer.groups.delete': 'Delete',
    'engineer.groups.rename': 'Rename',
    'engineer.groups.devices': 'Devices',
    'engineer.groups.noDevices': 'No devices',
    'engineer.groups.ungrouped': 'Ungrouped',
    'engineer.groups.noGroups': 'No groups',
    'engineer.groups.groupId': 'Group',
    'engineer.groups.none': 'No group',
    'engineer.groups.assign.title': 'Assign devices',
    'engineer.groups.assign.device': 'Device',
    'engineer.groups.assign.group': 'Group',
    'engineer.groups.assign.apply': 'Apply',
    'engineer.groups.assign.empty': 'No devices available',
    'errors.groupLimit': 'You can add up to 32 groups to a space.',
    'profile.title': 'Profile',
    'profile.nickname': 'Game nickname',
    'profile.nickname.change': 'Change',
    'profile.timezone': 'Time zone',
    'profile.language': 'Language',
    'profile.switchUser': 'Go to user',
    'profile.logout': 'Sign out',
    'common.save': 'Save',
    'errors.extensionLimit': 'You can add up to 5 extensions to a space.',
    'errors.deviceTypeLimit': 'You can add up to 6 devices of each type to a space.',
    'errors.zoneLimit': 'You can add up to 32 zones to a space.',
    'errors.keyLimit': 'You can add up to 32 keys to a space.',
    'common.close': 'Close',
    'common.back': 'Back',
    'common.loading': 'Working on it...',
    'common.actionConfirmTitle': 'Confirm action',
    'common.cancel': 'Cancel',
    'common.confirm': 'Confirm',
    'common.guardTitle': 'Action unavailable',
    'common.guardMessage': 'Unable to perform the action: the space is armed.',
    'common.ok': 'OK',
    'engineer.spaceModal.title': 'Create space',
    'engineer.spaceModal.hubId': 'Hub ID',
    'engineer.spaceModal.name': 'Name',
    'engineer.spaceModal.address': 'Coordinates',
    'engineer.spaceModal.server': 'Server',
    'engineer.spaceModal.city': 'City',
    'engineer.spaceModal.submit': 'Create',
    'engineer.deviceModal.title': 'Add device',
    'engineer.deviceModal.name': 'Device name',
    'engineer.deviceModal.room': 'Room',
    'engineer.deviceModal.type.zone': 'Zone',
    'engineer.deviceModal.type.outputLight': 'Arming LED',
    'engineer.deviceModal.type.siren': 'Siren',
    'engineer.deviceModal.type.reader': 'Reader',
    'engineer.deviceModal.type.extension': 'Extension module',
    'engineer.deviceModal.type.key': 'Key',
    'engineer.deviceModal.side': 'Side (N/S/E/W/U/D)',
    'engineer.deviceModal.bindTarget.hub': 'To hub',
    'engineer.deviceModal.bindTarget.extension': 'To extension module',
    'engineer.deviceModal.bindExtension.empty': 'No extension modules',
    'engineer.deviceModal.bindExtension.select': 'Select a module',
    'engineer.deviceModal.extension.id': 'Module ID (HUB_EXT-...)',
    'engineer.deviceModal.extension.hubSide': 'Hub side (N/S/E/W/U/D)',
    'engineer.deviceModal.extension.extensionSide': 'Module side (N/S/E/W/U/D)',
    'engineer.deviceModal.zoneType.instant': 'Normal',
    'engineer.deviceModal.zoneType.delayed': 'Delayed',
    'engineer.deviceModal.zoneType.pass': 'Pass-through',
    'engineer.deviceModal.zoneType.24h': '24-hour',
    'engineer.deviceModal.bypass.false': 'Bypass: no',
    'engineer.deviceModal.bypass.true': 'Bypass: yes',
    'engineer.deviceModal.silent.false': 'Silent: no',
    'engineer.deviceModal.silent.true': 'Silent: yes',
    'engineer.deviceModal.delaySeconds': 'Delay (sec)',
    'engineer.deviceModal.normalLevel': 'Normal level',
    'engineer.deviceModal.outputLevel': 'Output level',
    'engineer.deviceModal.intervalMs': 'Interval (ms)',
    'engineer.deviceModal.alarmDuration': 'Alarm duration (sec)',
    'engineer.deviceModal.reader.id': 'Reader ID',
    'engineer.deviceModal.reader.outputLevel': 'Output level',
    'engineer.deviceModal.reader.inputLevel': 'Input level',
    'engineer.deviceModal.key.name': 'Key name',
    'engineer.deviceModal.key.readerId': 'Reader ID',
    'engineer.deviceModal.key.read': 'Read key',
    'engineer.deviceModal.key.generate': 'Generate',
    'engineer.deviceModal.submit': 'Add',
    'page.title.engineer': 'Minecraft Security System — Engineer mode',
    'page.title.admin': 'Minecraft Security System — Admin panel',
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
  document.querySelectorAll('[data-i18n-aria-label]').forEach((node) => {
    const key = node.dataset.i18nAriaLabel;
    if (dict[key]) {
      node.setAttribute('aria-label', dict[key]);
    }
  });
  const titleKey = isAdminPage ? 'page.title.admin' : 'page.title.engineer';
  if (dict[titleKey]) {
    document.title = dict[titleKey];
  }
};

const loadProfileSettings = () => {
  const raw = localStorage.getItem(profileStorageKey);
  if (!raw) {
    state.language = detectBrowserLanguage();
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    state.language = parsed.language ?? state.language;
    state.timezone = parsed.timezone ?? state.timezone;
    state.nickname = parsed.nickname ?? state.nickname;
    state.lastNicknameChangeAt = parsed.lastNicknameChangeAt ?? state.lastNicknameChangeAt;
    state.lastSpaceCreateAt = parsed.lastSpaceCreateAt ?? state.lastSpaceCreateAt;
    state.spaceCreateLockUntil = parsed.spaceCreateLockUntil ?? state.spaceCreateLockUntil;
    state.avatarUrl = parsed.avatarUrl ?? state.avatarUrl;
  } catch {
    // ignore
  }
};

const saveProfileSettings = () => {
  localStorage.setItem(profileStorageKey, JSON.stringify({
    language: state.language,
    timezone: state.timezone,
    nickname: state.nickname,
    lastNicknameChangeAt: state.lastNicknameChangeAt,
    lastSpaceCreateAt: state.lastSpaceCreateAt,
    spaceCreateLockUntil: state.spaceCreateLockUntil,
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

const syncProfileSettings = async () => {
  if (isAdminPage) return;
  try {
    const result = await apiFetch('/api/auth/me');
    if (!result?.user) return;
    state.language = result.user.language ?? state.language;
    state.timezone = result.user.timezone ?? state.timezone;
    state.nickname = result.user.minecraft_nickname ?? state.nickname;
    state.lastNicknameChangeAt = result.user?.last_nickname_change_at ?? null;
    state.lastSpaceCreateAt = result.user?.last_space_create_at ?? null;
    state.spaceCreateLockUntil = null;
    state.avatarUrl = result.user.discord_avatar_url ?? state.avatarUrl;
    state.role = result.user.role ?? state.role;
    saveProfileSettings();
    setAvatar(state.avatarUrl);
    updateNicknameControls();
    updateSpaceCreateControls();
  } catch {
    // ignore
  }
};

const formatLockUntil = (lockUntil) => {
  const date = new Date(lockUntil);
  return `${date.toLocaleDateString('ru-RU')} ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
};

const getNicknameLockUntil = (lastChangedAt) => {
  if (!lastChangedAt) return null;
  const lastTimestamp = new Date(lastChangedAt).getTime();
  if (Number.isNaN(lastTimestamp)) return null;
  const lockUntil = lastTimestamp + NICKNAME_COOLDOWN_MS;
  return Date.now() < lockUntil ? lockUntil : null;
};

const updateNicknameControls = () => {
  const lockUntil = getNicknameLockUntil(state.lastNicknameChangeAt);
  const locked = Boolean(lockUntil);
  if (profileNickname) profileNickname.disabled = locked;
  if (profileNicknameChange) {
    profileNicknameChange.disabled = locked;
    if (locked && lockUntil) {
      profileNicknameChange.title = translateMessage(`Смена доступна после ${formatLockUntil(lockUntil)}`);
    } else {
      profileNicknameChange.removeAttribute('title');
    }
  }
};

const getSpaceCreateLockUntil = () => {
  const lockUntilFromOverride = state.spaceCreateLockUntil;
  const lockUntilFromLastCreate = (() => {
    if (!state.lastSpaceCreateAt) return null;
    const lastTimestamp = new Date(state.lastSpaceCreateAt).getTime();
    if (Number.isNaN(lastTimestamp)) return null;
    const lockUntil = lastTimestamp + SPACE_CREATE_COOLDOWN_MS;
    return Date.now() < lockUntil ? lockUntil : null;
  })();
  const lockUntil = Math.max(lockUntilFromOverride ?? 0, lockUntilFromLastCreate ?? 0);
  return lockUntil > Date.now() ? lockUntil : null;
};

let spaceCreateUnlockTimerId = null;

const applyLockState = (button, locked, title) => {
  if (!button) return;
  button.disabled = false;
  button.classList.toggle('button--locked', locked);
  button.setAttribute('aria-disabled', locked ? 'true' : 'false');
  if (title) button.title = title;
  else button.removeAttribute('title');
};

const updateSpaceCreateControls = () => {
  const lockUntil = getSpaceCreateLockUntil();
  const locked = Boolean(lockUntil);
  const title = locked && lockUntil ? translateMessage(`Создание доступно после ${formatLockUntil(lockUntil)}`) : '';

  applyLockState(openCreate, locked, title);
  applyLockState(spaceSubmitButton, locked, title);

  if (spaceCreateUnlockTimerId) {
    clearTimeout(spaceCreateUnlockTimerId);
    spaceCreateUnlockTimerId = null;
  }
  if (lockUntil) {
    const delay = Math.max(lockUntil - Date.now(), 0) + 50;
    spaceCreateUnlockTimerId = setTimeout(() => {
      state.spaceCreateLockUntil = null;
      saveProfileSettings();
      updateSpaceCreateControls();
    }, delay);
  }
};

const messageTranslations = {
  'Подтвердите действие': 'Confirm action',
  'Подтвердить': 'Confirm',
  'Отмена': 'Cancel',
  'Такого игрока не существует.': 'Player not found.',
  'Ник должен быть не длиннее 16 символов.': 'Nickname must be 16 characters or fewer.',
  'Введите корректный ник.': 'Please enter a valid nickname.',
  'Такой ник уже используется.': 'That nickname is already in use.',
  'Сменить ник можно раз в 7 дней.': 'You can change your nickname once every 7 days.',
  'Создавать объекты можно не чаще, чем раз в 15 минут.': 'You can create spaces no more than once every 15 minutes.',
  'Примечание должно быть до 100 символов.': 'Notes must be 100 characters or fewer.',
  'Слишком длинное значение в поле.': 'Value is too long.',
  'Некорректная ссылка.': 'Invalid URL.',
  'Этот хаб уже ожидает регистрации.': 'This hub is already awaiting registration.',
  'Ваш аккаунт заблокирован администратором.': 'Your account has been blocked by an administrator.',
  'Ошибка подключения к базе данных. Проверьте POSTGRES_PASSWORD и перезапустите Docker Compose.':
    'Database connection error. Check POSTGRES_PASSWORD and restart Docker Compose.',
  'Некорректный ID хаба.': 'Invalid hub ID.',
  'Не удалось загрузить данные.': 'Failed to load data.',
  'Не удалось загрузить журнал.': 'Failed to load logs.',
  'Устройство удалено.': 'Device deleted.',
  'Устройство обновлено.': 'Device updated.',
  'Роль пользователя удалена.': 'User role removed.',
  'Нельзя удалить последнего инженера монтажа.': 'Cannot remove the last installer.',
  'Вы покинули пространство.': 'You left the space.',
  'Контакт удалён.': 'Contact removed.',
  'Контакт обновлён.': 'Contact updated.',
  'Примечание удалено.': 'Note removed.',
  'Примечание обновлено.': 'Note updated.',
  'Фото удалено.': 'Photo removed.',
  'Фото обновлено.': 'Photo updated.',
  'Запущена постановка под охрану.': 'Arming started.',
  'Объект поставлен под охрану.': 'Space armed.',
  'Объект снят с охраны.': 'Space disarmed.',
  'Ошибка обновления статуса.': 'Failed to update status.',
  'Данные синхронизированы с хабами.': 'Data synced with hubs.',
  'Пространство удалено.': 'Space deleted.',
  'Хаб удалён из пространства.': 'Hub removed from space.',
  'Пространство создано.': 'Space created.',
  'Устройство добавлено.': 'Device added.',
  'Ключ считан.': 'Key read.',
  'Контакт добавлен.': 'Contact added.',
  'Примечание добавлено.': 'Note added.',
  'Пользователь добавлен.': 'User added.',
  'Инженер добавлен.': 'Installer added.',
  'Фото добавлено.': 'Photo added.',
  'Информация обновлена.': 'Information updated.',
  'Хаб привязан.': 'Hub attached.',
  'Ник уже установлен.': 'Nickname already set.',
  'Сменить ник?': 'Change nickname?',
  'Ник нельзя сменить будет в течении следующих 7 дней.': 'Nickname can be changed again in 7 days.',
  'Сменить': 'Change',
  'Не удалось обновить ник.': 'Failed to update nickname.',
  'Удалить ключ?': 'Delete key?',
  'Удаление ключа': 'Delete key',
  'Удалить устройство?': 'Delete device?',
  'Удаление устройства': 'Delete device',
  'Удалить контактное лицо?': 'Delete contact?',
  'Удаление контакта': 'Delete contact',
  'Удалить примечание?': 'Delete note?',
  'Удаление примечания': 'Delete note',
  'Удалить фото?': 'Delete photo?',
  'Удаление фото': 'Delete photo',
  'Удалить объект?': 'Delete space?',
  'Удаление объекта': 'Delete space',
  'Удалить хаб из пространства?': 'Remove hub from space?',
  'Удаление хаба': 'Remove hub',
};

const translateMessage = (message) => {
  if (state.language !== 'en-US') return message;
  const raw = String(message ?? '');
  if (raw.startsWith('Создавать объекты можно не чаще, чем раз в 15 минут. Доступно после ')) {
    return raw.replace(
      'Создавать объекты можно не чаще, чем раз в 15 минут. Доступно после ',
      'You can create spaces no more than once every 15 minutes. Available after ',
    );
  }
  if (raw.startsWith('Создание доступно после ')) {
    return raw.replace('Создание доступно после ', 'Creation available after ');
  }
  if (raw.startsWith('Смена доступна после ')) {
    return raw.replace('Смена доступна после ', 'Change available after ');
  }
  return messageTranslations[raw] ?? raw;
};

const showToast = (message) => {
  toast.textContent = translateMessage(message);
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

  if (actionModalTitle) actionModalTitle.textContent = translateMessage(title);
  if (actionModalMessage) actionModalMessage.textContent = translateMessage(message);
  actionModalConfirm.textContent = translateMessage(confirmText);
  actionModalCancel.textContent = translateMessage(cancelText);

  if (actionModalForm) {
    actionModalForm.innerHTML = '';
    actionModalForm.classList.toggle('hidden', fields.length === 0);
    fields.forEach((field) => {
      const input = document.createElement('input');
      input.type = field.type ?? 'text';
      input.name = field.name;
      input.placeholder = field.placeholder ?? '';
      if (field.value !== undefined) {
        input.value = field.value ?? '';
      }
      if (field.checked !== undefined) {
        input.checked = Boolean(field.checked);
      }
      if (field.required) input.required = true;
      if (field.min !== undefined) input.min = field.min;
      if (field.max !== undefined) input.max = field.max;
      if (field.maxLength !== undefined) input.maxLength = field.maxLength;

      if (field.type === 'checkbox') {
        const label = document.createElement('label');
        label.className = 'checkbox-field';
        label.appendChild(input);
        const text = document.createElement('span');
        text.textContent = field.label ?? field.placeholder ?? '';
        label.appendChild(text);
        actionModalForm.appendChild(label);
      } else {
        actionModalForm.appendChild(input);
      }
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

const handleSpaceCreateCooldown = (retryAfterMs) => {
  const hasValidRetryAfter = typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0;
  const effectiveRetryAfterMs = hasValidRetryAfter ? retryAfterMs : SPACE_CREATE_COOLDOWN_MS;
  const lockUntil = Date.now() + effectiveRetryAfterMs;
  state.spaceCreateLockUntil = lockUntil;
  state.lastSpaceCreateAt = hasValidRetryAfter
    ? new Date(lockUntil - SPACE_CREATE_COOLDOWN_MS).toISOString()
    : new Date().toISOString();
  saveProfileSettings();
  updateSpaceCreateControls();
  return lockUntil;
};

const handleApiError = (error, fallbackMessage) => {
  if (error.message === 'space_armed') {
    showGuardModal();
    return;
  }
  if (error.message === 'user_not_found') {
    showToast('Такого игрока не существует.');
    return;
  }
  if (error.message === 'nickname_too_long') {
    showToast('Ник должен быть не длиннее 16 символов.');
    return;
  }
  if (error.message === 'invalid_nickname') {
    showToast('Введите корректный ник.');
    return;
  }
  if (error.message === 'nickname_taken') {
    showToast('Такой ник уже используется.');
    return;
  }
  if (error.message === 'nickname_cooldown') {
    showToast('Сменить ник можно раз в 7 дней.');
    return;
  }
  if (error.message === 'space_create_cooldown' || error.status === 429) {
    const lockUntil = handleSpaceCreateCooldown(error.retryAfterMs);
    if (lockUntil) {
      showToast(`Создавать объекты можно не чаще, чем раз в 15 минут. Доступно после ${formatLockUntil(lockUntil)}.`);
    } else {
      showToast('Создавать объекты можно не чаще, чем раз в 15 минут.');
    }
    return;
  }
  if (error.message === 'note_too_long') {
    showToast('Примечание должно быть до 100 символов.');
    return;
  }
  if (error.message === 'field_too_long') {
    showToast('Слишком длинное значение в поле.');
    return;
  }
  if (error.message === 'invalid_url') {
    showToast('Некорректная ссылка.');
    return;
  }
  if (error.message === 'hub_pending') {
    showToast('Этот хаб уже ожидает регистрации.');
    return;
  }
  if (error.message === 'user_blocked') {
    showToast('Ваш аккаунт заблокирован администратором.');
    return;
  }
  if (error.message === 'db_auth_failed') {
    showToast('Ошибка подключения к базе данных. Проверьте POSTGRES_PASSWORD и перезапустите Docker Compose.');
    return;
  }
  if (error.message === 'invalid_hub_id') {
    showToast('Некорректный ID хаба.');
    return;
  }
  if (error.message === 'invalid_extension_id') {
    showToast('Некорректный ID модуля расширения.');
    return;
  }
  if (error.message === 'extension_not_found') {
    showToast('Модуль расширения не найден.');
    return;
  }
  if (error.message === 'extension_id_taken') {
    showToast('Такой ID модуля расширения уже используется.');
    return;
  }
  const errorMessage = error?.message ?? '';
  if (errorMessage === 'extension_limit') {
    showToast(t('errors.extensionLimit'));
    return;
  }
  if (errorMessage === 'group_limit') {
    showToast(t('errors.groupLimit'));
    return;
  }
  if (errorMessage === 'device_type_limit' || errorMessage.includes('device_type_limit')) {
    showToast(t('errors.deviceTypeLimit'));
    return;
  }
  if (errorMessage === 'zone_limit' || errorMessage.includes('zone_limit')) {
    showToast(t('errors.zoneLimit'));
    return;
  }
  if (errorMessage === 'key_limit' || errorMessage.includes('key_limit')) {
    showToast(t('errors.keyLimit'));
    return;
  }
  showToast(fallbackMessage);
};

const getAuthToken = () => {
  if (isAdminPage) return localStorage.getItem(adminTokenKey);
  return localStorage.getItem('authToken');
};

const apiFetch = async (path, options = {}) => {
  const token = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    'X-App-Mode': 'pro',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(isAdminPage && token ? { 'X-Admin-Token': token } : {}),
    ...(options.headers ?? {}),
  };
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
  if (response.status === 401) {
    if (!isAdminPage) {
      localStorage.removeItem('authToken');
      window.location.href = 'login.html';
    }
    throw new Error('unauthorized');
  }
  const payload = await response.json().catch(() => ({}));
  if (payload?.error === 'user_blocked') {
    window.location.href = 'blocked.html';
    throw new Error('user_blocked');
  }
  const error = new Error(payload.error ?? `API error: ${response.status}`);
    error.status = response.status;
    if (payload.retryAfterMs !== undefined) error.retryAfterMs = payload.retryAfterMs;
    throw error;
  }
  return response.json();
};

const loadSpaces = async () => {
  try {
    const previousSpaces = new Map(spaces.map((space) => [space.id, space]));
    const nextSpaces = await apiFetch('/api/spaces');
    spaces = nextSpaces.map((space) => {
      const previous = previousSpaces.get(space.id);
      if (!previous) return space;
      return {
        ...space,
        logs: previous.logs,
        logsLimit: previous.logsLimit,
        logsOffset: previous.logsOffset,
        logsHasMore: previous.logsHasMore,
      };
    });
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

const fetchLogsChunked = async (baseUrl, totalLimit) => {
  let all = [];
  let offset = 0;
  let hasMore = true;
  while (all.length < totalLimit && hasMore) {
    const batch = Math.min(200, totalLimit - all.length);
    const resp = await apiFetch(`${baseUrl}${baseUrl.includes('?') ? '&' : '?'}limit=${batch}&offset=${offset}`);
    const logs = resp.logs ?? [];
    all = [...all, ...logs];
    hasMore = Boolean(resp.hasMore);
    offset += logs.length;
    if (!logs.length) break;
  }
  return { logs: all, hasMore };
};

const loadLogs = async (spaceId, reset = true) => {
  try {
    const space = spaces.find((item) => item.id === spaceId);
    if (!space) return;
    if (reset) {
      const limit = space.logsLimit ?? 200;
      const { logs, hasMore } = await fetchLogsChunked(`/api/spaces/${spaceId}/logs`, limit);
      space.logs = logs;
      space.logsOffset = logs.length;
      space.logsHasMore = hasMore;
      const lastLog = space.logs[0];
      state.lastLogKey = `${space.logs.length}-${lastLog?.time ?? ''}-${lastLog?.text ?? ''}-${lastLog?.createdAt ?? ''}`;
      return;
    }
    const resp = await apiFetch(`/api/spaces/${spaceId}/logs?limit=200&offset=${space.logsOffset ?? 0}`);
    const logs = resp.logs ?? [];
    space.logs = [...(space.logs ?? []), ...logs];
    space.logsOffset = (space.logsOffset ?? 0) + logs.length;
    space.logsLimit = space.logsOffset;
    space.logsHasMore = Boolean(resp.hasMore);
  } catch (error) {
    console.error(error);
    showToast('Не удалось загрузить журнал.');
  }
};

const applyFilter = (list) => {
  if (state.filter === 'offline') {
    return list.filter((space) => space.hubOnline === false);
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
  const offlineCount = spaces.filter((space) => space.hubOnline === false).length;
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
    const alarmFlash = isAlarm;
    const hubOfflineLabel = space.hubOnline === false
      ? `<div class="object-card__hub-offline">${t('engineer.object.hubOffline')}</div>`
      : '';
    card.className = `object-card ${space.id === state.selectedSpaceId ? 'object-card--active' : ''} ${
      isAlarm ? 'object-card--alarm' : ''
    } ${alarmFlash ? 'object-card--alarm-flash' : ''}`;
    card.innerHTML = `
      <div class="object-card__title">${escapeHtml(space.name)}</div>
      <div class="object-card__meta">${t('engineer.object.hubId')} ${escapeHtml(space.hubId ?? '—')}</div>
      ${hubOfflineLabel}
      <div class="object-card__status ${statusTone[space.status] ?? ''}">${getStatusLabel(space.status)}</div>
      <div class="object-card__meta">${t('engineer.object.server')}: ${escapeHtml(space.server ?? '—')}</div>
      <div class="object-card__meta">${escapeHtml(space.address)}</div>
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
  setAlarmSoundActive(spaces.some((space) => space.issues)).catch(() => null);
};

const renderSpaceHeader = (space) => {
  if (spaceNameEl) {
    spaceNameEl.textContent = space.name ?? space.id;
  }
  if (spaceIdEl) {
    spaceIdEl.textContent = space.id;
  }
  spaceStateEl.textContent = getStatusLabel(space.status);
  spaceStateEl.className = `status-card__state ${statusTone[space.status] ?? ''}`;
  spaceMetaEl.textContent = `${t('engineer.object.coordsLabel')}: ${space.address} • ${space.server ?? '—'} • ${space.city}`;
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
    const statusText = device.type === 'zone' || device.type === 'hub' || isHubExtensionType(device.type)
      ? device.status
      : '';
    const item = document.createElement('button');
    item.className = `device-item ${device.id === state.selectedDeviceId ? 'device-item--active' : ''}`;
    item.innerHTML = `
      <div>
        <div class="device-item__title">${escapeHtml(device.name)}</div>
        <div class="device-item__meta">${escapeHtml(device.room)}</div>
      </div>
      <span class="device-item__status">${escapeHtml(statusText)}</span>
    `;
    item.addEventListener('click', () => {
      state.selectedDeviceId = device.id;
      renderDevices(space);
    });
    deviceList.appendChild(item);
    if (device.id === state.selectedDeviceId) renderDeviceDetails(device);
  });
};

const getExtensionOptions = (extensions, selectedId = '') => {
  if (!extensions.length) {
    return `<option value="">${t('engineer.deviceModal.bindExtension.empty')}</option>`;
  }
  const options = extensions.map((device) => {
    const id = device.extensionId ?? device.id;
    const safeId = escapeHtml(id);
    const safeName = escapeHtml(device.name);
    const isSelected = id === selectedId ? ' selected' : '';
    return `<option value="${safeId}"${isSelected}>${safeName} (${safeId})</option>`;
  }).join('');
  return `<option value="">${t('engineer.deviceModal.bindExtension.select')}</option>${options}`;
};

const getSpaceExtensionDevices = (space) => (space?.devices ?? [])
  .filter((device) => isHubExtensionType(device.type));

const updateEditExtensionOptions = async ({ spaceId, selectEl, selectedId }) => {
  if (!selectEl || !spaceId) return;
  try {
    const response = await apiFetch(`/api/spaces/${spaceId}/extensions`);
    const extensions = response.extensions ?? [];
    selectEl.innerHTML = getExtensionOptions(extensions, selectedId);
    selectEl.disabled = !extensions.length;
    if (!extensions.length) {
      selectEl.value = '';
    }
  } catch (error) {
    console.error(error);
    selectEl.innerHTML = getExtensionOptions([], selectedId);
    selectEl.disabled = true;
    selectEl.value = '';
  }
};

const updateCreateExtensionOptions = async () => {
  if (!bindExtensionInput) return;
  const selectedId = bindExtensionInput.value;
  const spaceId = state.selectedSpaceId;
  if (!spaceId) return;
  try {
    const response = await apiFetch(`/api/spaces/${spaceId}/extensions`);
    const extensions = response.extensions ?? [];
    bindExtensionInput.innerHTML = getExtensionOptions(extensions, selectedId);
    bindExtensionInput.disabled = !extensions.length;
    if (!extensions.length) {
      bindExtensionInput.value = '';
    }
  } catch (error) {
    console.error(error);
    bindExtensionInput.innerHTML = getExtensionOptions([], selectedId);
    bindExtensionInput.disabled = true;
    bindExtensionInput.value = '';
  }
};

const renderDeviceDetails = (device) => {
  const canDelete = device.type !== 'hub';
  const deleteLabel = device.type === 'key' ? 'Удалить ключ' : 'Удалить устройство';
  const safeName = escapeHtml(device.name);
  const safeRoom = escapeHtml(device.room);
  const safeSide = escapeHtml(device.side ?? '');
  const safeStatus = escapeHtml(device.status ?? '');
  const safeReaderId = escapeHtml(device.config?.readerId ?? '');
  const safeType = escapeHtml(device.type);
  const safeId = escapeHtml(device.id);
  const space = spaces.find((item) => item.id === state.selectedSpaceId);
  const extensionDevices = getSpaceExtensionDevices(space);
  const statusBlock = device.type === 'zone' || device.type === 'hub' || isHubExtensionType(device.type)
    ? `
      <div class="stat">
        <span>Статус</span>
        <strong>${safeStatus}</strong>
      </div>
    `
    : '';
  const sideOptionValues = ['north', 'south', 'west', 'east', 'up', 'down'];
  const sideOptions = (value) => sideOptionValues
    .map((side) => `<option value="${side}" ${value === side ? 'selected' : ''}>${side}</option>`)
    .join('');

  const baseFields = device.type !== 'key'
    ? `
      <input type="text" name="name" value="${safeName}" placeholder="Имя" required />
      <input type="text" name="room" value="${safeRoom}" placeholder="Комната" required />
      ${!isHubExtensionType(device.type)
        ? `
          <select name="side" required>
            ${sideOptions(device.side ?? '')}
          </select>
        `
        : ''}
    `
    : (() => {
      let keyFields = `
        <input type="text" name="name" value="${escapeHtml(device.name.replace('Ключ: ', ''))}" placeholder="Имя ключа" required />
        <input type="text" name="readerId" value="${safeReaderId}" placeholder="ID считывателя" />
      `;
      if (space?.groupsEnabled) {
        const groups = space.groups ?? [];
        const keyGroups = device.config?.groups ?? [];
        if (groups.length) {
          keyFields += `<div class="group-checkboxes"><span style="font-size:12px;color:#888">${t('engineer.groups.groupId')}:</span>`;
          for (const g of groups) {
            const checked = keyGroups.includes(g.id) ? 'checked' : '';
            keyFields += `<label><input type="checkbox" name="keyGroup" value="${g.id}" ${checked} /> ${escapeHtml(g.name)}</label>`;
          }
          keyFields += '</div>';
        }
      }
      return keyFields;
    })();

  const groupIdField = (() => {
    if (!space?.groupsEnabled) return '';
    if (device.type !== 'zone' && device.type !== 'siren' && device.type !== 'output-light') return '';
    const groups = space.groups ?? [];
    const currentGroupId = device.config?.groupId ?? '';
    return `
      <select name="groupId">
        <option value="" ${!currentGroupId ? 'selected' : ''}>${t('engineer.groups.none')}</option>
        ${groups.map((g) => `<option value="${g.id}" ${currentGroupId === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
      </select>
    `;
  })();

  const configFields = (() => {
  if (isHubExtensionType(device.type)) {
    const safeExtensionId = escapeHtml(device.config?.extensionId ?? '');
    const safeHubSide = escapeHtml(device.config?.hubSide ?? '');
    const safeExtensionSide = escapeHtml(device.config?.extensionSide ?? '');
    return `
      <input type="text" name="extensionId" value="${safeExtensionId}" placeholder="ID модуля (HUB_EXT-...)" required />
      <select name="hubSide" required>
        ${sideOptions(safeHubSide)}
      </select>
      <select name="extensionSide" required>
        ${sideOptions(safeExtensionSide)}
      </select>
    `;
  }
    if (device.type === 'zone') {
      const bindTarget = device.config?.bindTarget === 'hub_extension' ? 'hub_extension' : 'hub';
      const bindExtensionId = device.config?.extensionId ?? '';
      return `
        <select name="bindTarget" id="bindTargetEdit">
          <option value="hub" ${bindTarget === 'hub' ? 'selected' : ''}>К хабу</option>
          <option value="hub_extension" ${bindTarget === 'hub_extension' ? 'selected' : ''}>К модулю расширения</option>
        </select>
        <select
          name="bindExtensionId"
          id="bindExtensionIdEdit"
          class="${bindTarget === 'hub_extension' ? '' : 'hidden'}"
        >
          ${getExtensionOptions(extensionDevices, bindTarget === 'hub_extension' ? bindExtensionId : '')}
        </select>
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
          max="120"
          placeholder="Задержка (сек)"
        />
        <input type="number" name="normalLevel" value="${device.config?.normalLevel ?? 15}" min="0" max="15" />
      `;
    }
    if (device.type === 'output-light') {
      const bindTarget = device.config?.bindTarget === 'hub_extension' ? 'hub_extension' : 'hub';
      const bindExtensionId = device.config?.extensionId ?? '';
      return `
        <select name="bindTarget" id="bindTargetEdit">
          <option value="hub" ${bindTarget === 'hub' ? 'selected' : ''}>К хабу</option>
          <option value="hub_extension" ${bindTarget === 'hub_extension' ? 'selected' : ''}>К модулю расширения</option>
        </select>
        <select
          name="bindExtensionId"
          id="bindExtensionIdEdit"
          class="${bindTarget === 'hub_extension' ? '' : 'hidden'}"
        >
          ${getExtensionOptions(extensionDevices, bindTarget === 'hub_extension' ? bindExtensionId : '')}
        </select>
        <input type="number" name="outputLevel" value="${device.config?.level ?? 15}" min="0" max="15" />
      `;
    }
    if (device.type === 'siren') {
      const bindTarget = device.config?.bindTarget === 'hub_extension' ? 'hub_extension' : 'hub';
      const bindExtensionId = device.config?.extensionId ?? '';
      return `
        <select name="bindTarget" id="bindTargetEdit">
          <option value="hub" ${bindTarget === 'hub' ? 'selected' : ''}>К хабу</option>
          <option value="hub_extension" ${bindTarget === 'hub_extension' ? 'selected' : ''}>К модулю расширения</option>
        </select>
        <select
          name="bindExtensionId"
          id="bindExtensionIdEdit"
          class="${bindTarget === 'hub_extension' ? '' : 'hidden'}"
        >
          ${getExtensionOptions(extensionDevices, bindTarget === 'hub_extension' ? bindExtensionId : '')}
        </select>
        <input type="number" name="outputLevel" value="${device.config?.level ?? 15}" min="0" max="15" />
        <input type="number" name="intervalMs" value="${device.config?.intervalMs ?? 1000}" min="300" max="60000" />
        <input type="number" name="alarmDuration" value="${device.config?.alarmDuration ?? ''}" min="1" max="120" placeholder="Время тревоги (сек)" />
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
        <div class="device-details__title">${safeName}</div>
        <div class="device-details__meta">${safeRoom}</div>
      </div>
    </div>
    <div class="device-details__stats">
      ${statusBlock}
      <div class="stat">
        <span>Тип</span>
        <strong>${safeType}</strong>
      </div>
      <div class="stat">
        <span>ID</span>
        <strong>${safeId}</strong>
      </div>
    </div>
    ${device.type !== 'hub' ? `
      <form class="form-grid device-edit" id="deviceEditForm">
        ${baseFields}
        ${groupIdField}
        ${configFields}
        <button class="button button--primary" type="submit">Сохранить</button>
      </form>
    ` : ''}
    ${isHubExtensionType(device.type)
      ? '<button class="button button--ghost" id="refreshExtensionStatus">Обновить статус</button>'
      : ''}
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
    const bindTargetSelect = editForm.querySelector('#bindTargetEdit');
    const bindExtensionField = editForm.querySelector('#bindExtensionIdEdit');
    const updateBindingFields = () => {
      if (!bindTargetSelect || !bindExtensionField) return;
      const isExtension = bindTargetSelect.value === 'hub_extension';
      const hasExtensions = Array.from(bindExtensionField.options).some((option) => option.value);
      bindExtensionField.classList.toggle('hidden', !isExtension);
      bindExtensionField.required = isExtension && hasExtensions;
      bindExtensionField.disabled = !isExtension || !hasExtensions;
      if (!isExtension || !hasExtensions) {
        bindExtensionField.value = '';
      }
    };
    const refreshBindExtensions = async () => {
      if (!bindExtensionField || !space) return;
      await updateEditExtensionOptions({
        spaceId: space.id,
        selectEl: bindExtensionField,
        selectedId: bindExtensionField.value,
      });
      updateBindingFields();
    };
    if (bindTargetSelect) {
      bindTargetSelect.addEventListener('change', () => {
        if (bindTargetSelect.value === 'hub_extension') {
          refreshBindExtensions().catch(() => null);
        } else {
          updateBindingFields();
        }
      });
      updateBindingFields();
    }
    if (bindTargetSelect?.value === 'hub_extension') {
      refreshBindExtensions().catch(() => null);
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
          const keyGroupCheckboxes = editForm.querySelectorAll('input[name="keyGroup"]:checked');
          const selectedGroups = Array.from(keyGroupCheckboxes).map((cb) => Number(cb.value));
          await apiFetch(`/api/spaces/${space.id}/keys/${device.config.keyId}`, {
            method: 'PATCH',
            body: JSON.stringify({
              name: payload.name,
              readerId: payload.readerId || null,
              groups: selectedGroups,
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

  const refreshExtensionButton = document.getElementById('refreshExtensionStatus');
  if (refreshExtensionButton) {
    refreshExtensionButton.addEventListener('click', async () => {
      if (!ensureEditable()) return;
      const space = spaces.find((item) => item.id === state.selectedSpaceId);
      if (!space) return;
      try {
        showLoading();
        await apiFetch(`/api/spaces/${space.id}/devices/${device.id}/refresh`, { method: 'POST' });
        await refreshAll();
        showToast('Статус обновлён.');
      } catch (error) {
        console.error(error);
        handleApiError(error, 'Ошибка обновления статуса.');
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
      <strong>${escapeHtml(space.name)}</strong>
    </div>
    <div class="info-card">
      <span>${t('engineer.object.label.coords')}</span>
      <strong>${escapeHtml(space.address)}</strong>
    </div>
    <div class="info-card">
      <span>${t('engineer.object.label.server')}</span>
      <strong>${escapeHtml(space.server ?? '—')}</strong>
    </div>
    <div class="info-card">
      <span>${t('engineer.object.label.city')}</span>
      <strong>${escapeHtml(space.city)}</strong>
    </div>
    <div class="info-card">
      <span>${t('engineer.object.label.hub')}</span>
      <strong>${escapeHtml(space.hubId ?? '—')}</strong>
    </div>
    <div class="info-card">
      <span>${t('engineer.object.label.hubStatus')}</span>
      <strong>${space.hubId ? (space.hubOnline === null ? '— —' : (space.hubOnline ? t('engineer.hub.online') : t('engineer.hub.offline'))) : t('engineer.hub.none')}</strong>
    </div>
    <div class="info-card">
      <span>${t('engineer.object.label.mode')}</span>
      <strong>${getStatusLabel(space.status)}</strong>
    </div>
  `;

  if (editForm) {
    editForm.name.value = space.name;
    editForm.address.value = space.address;
    editForm.server.value = space.server ?? '';
    editForm.city.value = space.city;
  }
};

const renderMembers = (members) => {
  const installers = members.filter((member) => member.space_role === 'installer');
  const users = members.filter((member) => member.space_role !== 'installer');
  const space = spaces.find((item) => item.id === state.selectedSpaceId);
  const groups = space?.groups ?? [];

  if (usersList) {
    usersList.innerHTML = '';
    if (!users.length) {
      usersList.innerHTML = `<div class="empty-state">${t('engineer.members.emptyUsers')}</div>`;
    } else {
      users.forEach((member) => {
        const card = document.createElement('div');
        card.className = 'member-card';
        const baseLabel = escapeHtml(member.minecraft_nickname ?? member.email ?? '—');
        const label = member.is_self ? `${baseLabel} (${t('engineer.members.you')})` : baseLabel;
        card.innerHTML = `
          <div>
            <div class="member-card__title">${label}</div>
            <div class="member-card__meta">ID: ${member.id}</div>
          </div>
          <div class="member-card__actions">
            <button class="button button--ghost" data-member-groups="${member.id}">
              ${t('engineer.members.groups')}
            </button>
            <button class="button button--ghost button--danger" data-member-id="${member.id}">
              ${t('engineer.members.delete')}
            </button>
          </div>
        `;
        const deleteButton = card.querySelector('[data-member-id]');
        deleteButton?.addEventListener('click', async () => {
          try {
            showLoading();
            const roleToRemove = member.space_role ?? 'user';
            await removeMember(member.id, roleToRemove);
            if (member.is_self) {
              showToast('Роль пользователя удалена.');
            }
          } catch (error) {
            if (error.message === 'last_installer') {
              showToast('Нельзя удалить последнего инженера монтажа.');
            } else {
              handleApiError(error, 'Не удалось удалить пользователя.');
            }
          } finally {
            hideLoading();
          }
        });
        const groupsButton = card.querySelector('[data-member-groups]');
        groupsButton?.addEventListener('click', async () => {
          if (!groups.length) {
            showToast(t('engineer.members.groupsEmpty'));
            return;
          }
          const fields = groups.map((group) => ({
            type: 'checkbox',
            name: `group_${group.id}`,
            label: group.name,
            checked: (member.group_ids ?? []).includes(group.id),
          }));
          const values = await promptAction({
            title: t('engineer.members.groupsTitle'),
            fields,
            confirmText: t('common.save'),
          });
          if (!values) return;
          const selectedGroups = groups
            .filter((group) => values[`group_${group.id}`])
            .map((group) => group.id);
          try {
            showLoading();
            await apiFetch(`/api/spaces/${state.selectedSpaceId}/members/${member.id}/groups`, {
              method: 'PATCH',
              body: JSON.stringify({ groups: selectedGroups }),
            });
            await loadMembers();
            showToast('Группы обновлены.');
          } catch (error) {
            console.error(error);
            handleApiError(error, 'Не удалось обновить группы пользователя.');
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
        const baseLabel = escapeHtml(member.minecraft_nickname ?? member.email ?? '—');
        const label = member.is_self ? `${baseLabel} (${t('engineer.members.you')})` : baseLabel;
        card.innerHTML = `
          <div>
            <div class="member-card__title">${label}</div>
            <div class="member-card__meta">ID: ${member.id}</div>
          </div>
          <button class="button button--ghost ${member.is_self ? '' : 'button--danger'}" data-member-id="${member.id}">
            ${member.is_self ? t('engineer.members.leave') : t('engineer.members.delete')}
          </button>
        `;
        card.querySelector('button').addEventListener('click', async () => {
          try {
            showLoading();
            if (member.is_self) {
              await leaveSpace(member.space_role);
              showToast('Вы покинули пространство.');
            } else {
              await removeMember(member.id, member.space_role);
            }
          } catch (error) {
            if (error.message === 'last_installer') {
              showToast('Нельзя удалить последнего инженера монтажа.');
            } else {
              handleApiError(error, member.is_self ? 'Не удалось покинуть пространство.' : 'Не удалось удалить инженера.');
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

const leaveSpace = async (role) => {
  if (!state.selectedSpaceId) return;
  const params = new URLSearchParams();
  if (role) params.set('role', role);
  const queryString = params.toString();
  await apiFetch(`/api/spaces/${state.selectedSpaceId}/leave${queryString ? `?${queryString}` : ''}`, { method: 'POST' });
  await refreshAll();
};

const removeMember = async (userId, role) => {
  if (!state.selectedSpaceId) return;
  const params = new URLSearchParams();
  if (role) params.set('role', role);
  const queryString = params.toString();
  await apiFetch(`/api/spaces/${state.selectedSpaceId}/members/${userId}${queryString ? `?${queryString}` : ''}`, { method: 'DELETE' });
  await loadMembers();
};

const renderContacts = (space) => {
  contactsList.innerHTML = '';
  space.contacts.forEach((contact, index) => {
    const card = document.createElement('div');
    card.className = 'contact-card';
    card.innerHTML = `
      <div class="contact-card__title">${escapeHtml(contact.name)}</div>
      <div class="contact-card__meta">${escapeHtml(contact.role)}</div>
      <div class="contact-card__meta">${escapeHtml(contact.phone)}</div>
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
                { name: 'name', placeholder: 'Имя', value: contact.name, required: true, maxLength: 60 },
                { name: 'role', placeholder: 'Роль', value: contact.role, maxLength: 60 },
                { name: 'phone', placeholder: 'Телефон', value: contact.phone, maxLength: 40 },
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
    const text = document.createElement('div');
    text.textContent = note;
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    actions.innerHTML = `
      <button class="button button--ghost" data-action="edit" data-index="${index}">Изменить</button>
      <button class="button button--ghost button--danger" data-action="delete" data-index="${index}">Удалить</button>
    `;
    card.appendChild(text);
    card.appendChild(actions);
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
                { name: 'text', placeholder: 'Текст примечания', value: note, required: true, maxLength: 100 },
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
      <img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.label)}" />
      <div>${escapeHtml(photo.label)}</div>
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
                { name: 'url', placeholder: 'URL фото', value: photo.url, required: true, type: 'url', maxLength: 200 },
                { name: 'label', placeholder: 'Подпись', value: photo.label, maxLength: 60 },
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
    { pattern: /^Хаб не в сети$/, replacement: 'Hub offline' },
    { pattern: /^Хаб снова в сети$/, replacement: 'Hub online again' },
    { pattern: /^Модуль расширения не в сети$/, replacement: 'Hub extension offline' },
    { pattern: /^Модуль расширения снова в сети$/, replacement: 'Hub extension online again' },
    { pattern: /^Добавлено устройство: (.+)$/, replacement: 'Device added: $1' },
    { pattern: /^Удалено устройство: (.+)$/, replacement: 'Device removed: $1' },
    { pattern: /^Обновлено устройство: (.+)$/, replacement: 'Device updated: $1' },
    { pattern: /^Добавлен ключ: (.+)$/, replacement: 'Key added: $1' },
    { pattern: /^Удалён ключ: (.+)$/, replacement: 'Key removed: $1' },
    { pattern: /^Обновлён ключ: (.+)$/, replacement: 'Key updated: $1' },
    { pattern: /^Пользователь покинул пространство: (.+)$/, replacement: 'User left space: $1' },
    { pattern: /^Пользователь удалён из пространства: (.+)$/, replacement: 'User removed from space: $1' },
    { pattern: /^Группа '(.+)' поставлена под охрану$/, replacement: "Group '$1' armed" },
    { pattern: /^Группа '(.+)' снята с охраны$/, replacement: "Group '$1' disarmed" },
    { pattern: /^Постановка группы '(.+)' ключом: (.+)$/, replacement: "Group '$1' armed by key: $2" },
    { pattern: /^Снятие группы '(.+)' ключом: (.+)$/, replacement: "Group '$1' disarmed by key: $2" },
    { pattern: /^Добавлена группа: (.+)$/, replacement: 'Group added: $1' },
    { pattern: /^Удалена группа: (.+)$/, replacement: 'Group removed: $1' },
    { pattern: /^Переименована группа: (.+)$/, replacement: 'Group renamed: $1' },
    { pattern: /^Режим групп включён$/, replacement: 'Groups mode enabled' },
    { pattern: /^Режим групп отключён$/, replacement: 'Groups mode disabled' },
    { pattern: /^Тревога шлейфа: (.+) \[(.+)\]$/, replacement: 'Zone alarm: $1 [$2]' },
    { pattern: /^Восстановление шлейфа: (.+) \[(.+)\]$/, replacement: 'Zone restored: $1 [$2]' },
  ];
  for (const entry of translations) {
    if (entry.pattern.test(text)) {
      return text.replace(entry.pattern, entry.replacement);
    }
  }
  return text;
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
    const translated = isHub ? log.text : translateLogText(log.text);
    const isHubOffline = log.text === 'Хаб не в сети' || translated === 'Hub offline';
    const isExtensionOffline = log.text === 'Модуль расширения не в сети' || translated === 'Hub extension offline';
    row.className = `log-row ${isAlarm ? 'log-row--alarm' : ''} ${shouldFlash ? 'log-row--alarm-flash' : ''} ${isRestore ? 'log-row--restore' : ''} ${isHub ? 'log-row--hub' : ''} ${(isHubOffline || isExtensionOffline) ? 'log-row--hub-offline' : ''}`;
    const safeText = escapeHtml(translated);
    const text = isHub ? safeText.replace(/\n/g, '<br />') : safeText;
    const timeLabel = escapeHtml(formatLogTime(logTimestamp) ?? log.time);
    const whoLabel = escapeHtml(log.who);
    row.innerHTML = `
      <span>${timeLabel}</span>
      <span>${text}</span>
      <span class="muted">${whoLabel}</span>
    `;
    logTable.appendChild(row);
  });

  if (!logs.length) {
    logTable.innerHTML = `<div class="empty-state">${t('engineer.empty.logs')}</div>`;
    logMoreButton?.classList.add('hidden');
  }
  logMoreButton?.classList.toggle('hidden', !space.logsHasMore);
};

const renderAll = () => {
  renderCounts();
  renderObjectList();
  const space = spaces.find((item) => item.id === state.selectedSpaceId) || spaces[0];
  if (!space) return;
  renderSpaceHeader(space);
  renderDevices(space);
  updateCreateExtensionOptions().catch(() => null);
  renderObjectInfo(space);
  renderContacts(space);
  renderNotes(space);
  renderPhotos(space);
  renderLogs(space);
  renderGroups(space);
  renderStatusActions(space);
};

const groupsManageModal = document.getElementById('groupsManageModal');
const groupsManageList = document.getElementById('groupsManageList');
const closeGroupsManageModal = document.getElementById('closeGroupsManageModal');
const groupsManageClose = document.getElementById('groupsManageClose');

const openGroupsManage = () => {
  if (!groupsManageModal) return;
  groupsManageModal.classList.add('modal--open');
  groupsManageModal.setAttribute('aria-hidden', 'false');
};

const closeGroupsManage = () => {
  if (!groupsManageModal) return;
  groupsManageModal.classList.remove('modal--open');
  groupsManageModal.setAttribute('aria-hidden', 'true');
};

if (closeGroupsManageModal) {
  closeGroupsManageModal.addEventListener('click', () => {
    closeGroupsManage();
  });
}
if (groupsManageClose) {
  groupsManageClose.addEventListener('click', () => {
    closeGroupsManage();
  });
}
if (groupsManageModal) {
  groupsManageModal.addEventListener('click', (event) => {
    if (event.target === groupsManageModal) {
      closeGroupsManage();
    }
  });
}

const renderStatusActions = (space) => {
  const actionsContainer = document.querySelector('.status-actions');
  if (!actionsContainer) return;
  if (space.groupsEnabled) {
    actionsContainer.innerHTML = `<button class="chip chip--info" id="openGroupsManage">${t('engineer.groups.manage')}</button>`;
  } else {
    actionsContainer.innerHTML = `
      <button class="chip chip--danger" data-action="arm">${t('engineer.actions.arm')}</button>
      <button class="chip chip--success" data-action="disarm">${t('engineer.actions.disarm')}</button>
    `;
    rebindChipActions();
  }
};

document.addEventListener('click', (event) => {
  const btn = event.target.closest('#openGroupsManage');
  if (!btn) return;
  const space = spaces.find((item) => item.id === state.selectedSpaceId);
  if (!space || !space.groupsEnabled) return;
  renderGroupsManageModal(space);
  openGroupsManage();
});

const updateDeviceGroupSelect = (space) => {
  if (!deviceGroupSelect) return;
  const groups = space?.groups ?? [];
  const selectedValue = deviceGroupSelect.value;
  deviceGroupSelect.innerHTML = [
    `<option value="">${t('engineer.groups.none')}</option>`,
    ...groups.map((group) => (
      `<option value="${group.id}" ${String(selectedValue) === String(group.id) ? 'selected' : ''}>${escapeHtml(group.name)}</option>`
    )),
  ].join('');

  const selectedType = deviceType?.value;
  const isSupportedType = ['zone', 'siren', 'output-light'].includes(selectedType);
  const shouldShow = Boolean(space?.groupsEnabled && isSupportedType && groups.length);
  deviceGroupSelect.classList.toggle('hidden', !shouldShow);
  deviceGroupSelect.disabled = !shouldShow;
  if (!shouldShow) {
    deviceGroupSelect.value = '';
  }
};

const rebindChipActions = () => {
  document.querySelectorAll('.status-actions .chip[data-action]').forEach((chip) => {
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
};

const renderGroups = (space) => {
  const container = document.getElementById('groupsContent');
  if (!container) return;
  const groups = space.groups ?? [];
  const devices = (space.devices ?? []).filter((d) => d.type !== 'hub' && d.type !== 'key');
  const assignableDevices = devices.filter((device) => ['zone', 'siren', 'output-light'].includes(device.type));

  const toggleChecked = space.groupsEnabled ? 'checked' : '';
  let html = `
    <label class="toggle-switch">
      <input type="checkbox" id="groupsModeToggle" ${toggleChecked} />
      <span>${t('engineer.groups.enable')}</span>
    </label>
  `;

  if (space.groupsEnabled) {
    html += `
      <div class="group-assign">
        <div class="group-assign__header">
          <h3>${t('engineer.groups.assign.title')}</h3>
        </div>
        <div class="group-assign__list">
          ${assignableDevices.length
            ? assignableDevices.map((device) => {
              const currentGroupId = device.config?.groupId ?? '';
              const groupOptions = [
                `<option value="" ${!currentGroupId ? 'selected' : ''}>${t('engineer.groups.none')}</option>`,
                ...groups.map((group) => (
                  `<option value="${group.id}" ${String(currentGroupId) === String(group.id) ? 'selected' : ''}>${escapeHtml(group.name)}</option>`
                )),
              ].join('');
              return `
                <div class="group-assign__item">
                  <div class="group-assign__info">
                    <span class="group-assign__name">${escapeHtml(device.name)}</span>
                    <span class="muted">${escapeHtml(device.room ?? '')}</span>
                  </div>
                  <div class="group-assign__controls">
                    <select data-device-group="${device.id}">
                      ${groupOptions}
                    </select>
                    <button class="button button--ghost" data-device-group-apply="${device.id}">
                      ${t('engineer.groups.assign.apply')}
                    </button>
                  </div>
                </div>
              `;
            }).join('')
            : `<div class="empty-state">${t('engineer.groups.assign.empty')}</div>`}
        </div>
      </div>
    `;

    if (groups.length) {
      html += '<div class="groups-list">';
      for (const group of groups) {
        const groupDevices = devices.filter((d) => d.config?.groupId === group.id);
        const statusLabel = t(`status.${group.status}`) ?? group.status;
        const statusClass = statusTone[group.status] ?? '';
        html += `
          <div class="group-card">
            <div class="group-card__header">
              <span class="group-card__title">${escapeHtml(group.name)}</span>
              <span class="group-card__status ${statusClass}">${escapeHtml(statusLabel)}</span>
            </div>
            <div class="group-card__devices">
              ${groupDevices.length
                ? groupDevices.map((d) => `<span class="tag">${escapeHtml(d.name)}</span>`).join('')
                : `<span class="muted">${t('engineer.groups.noDevices')}</span>`}
            </div>
            <div class="group-card__actions">
              <button class="button button--ghost" data-group-rename="${group.id}">${t('engineer.groups.rename')}</button>
              <button class="button button--ghost button--danger" data-group-delete="${group.id}">${t('engineer.groups.delete')}</button>
            </div>
          </div>
        `;
      }
      html += '</div>';
    } else {
      html += `<div class="empty-state" style="margin-top:12px">${t('engineer.groups.noGroups')}</div>`;
    }

    const ungroupedDevices = devices.filter((d) => !d.config?.groupId);
    if (ungroupedDevices.length) {
      html += `
        <div class="group-card group-card--muted" style="margin-top:12px">
          <div class="group-card__header">
            <span class="group-card__title">${t('engineer.groups.ungrouped')}</span>
          </div>
          <div class="group-card__devices">
            ${ungroupedDevices.map((d) => `<span class="tag tag--muted">${escapeHtml(d.name)}</span>`).join('')}
          </div>
        </div>
      `;
    }

    html += `
      <div class="groups-form">
        <input type="text" id="groupNameInput" placeholder="${t('engineer.groups.name')}" maxlength="60" />
        <button class="button button--primary" id="createGroupBtn">${t('engineer.groups.add')}</button>
      </div>
    `;
  }

  container.innerHTML = html;
  updateDeviceGroupSelect(space);

  // Bind toggle
  const toggle = document.getElementById('groupsModeToggle');
  if (toggle) {
    toggle.addEventListener('change', async () => {
      try {
        showLoading();
        await apiFetch(`/api/spaces/${space.id}/groups-mode`, {
          method: 'PATCH',
          body: JSON.stringify({ enabled: toggle.checked }),
        });
        await refreshAll();
      } catch (error) {
        console.error(error);
        toggle.checked = !toggle.checked;
        handleApiError(error, 'Не удалось переключить режим групп.');
      } finally {
        hideLoading();
      }
    });
  }

  // Bind create group
  const createBtn = document.getElementById('createGroupBtn');
  const nameInput = document.getElementById('groupNameInput');
  if (createBtn && nameInput) {
    createBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      if (!name) return;
      try {
        showLoading();
        await apiFetch(`/api/spaces/${space.id}/groups`, {
          method: 'POST',
          body: JSON.stringify({ name }),
        });
        await refreshAll();
        showToast('Группа создана.');
      } catch (error) {
        console.error(error);
        handleApiError(error, 'Не удалось создать группу.');
      } finally {
        hideLoading();
      }
    });
  }

  // Bind rename buttons
  container.querySelectorAll('[data-group-rename]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!ensureEditable()) return;
      const groupId = btn.dataset.groupRename;
      const group = groups.find((g) => String(g.id) === String(groupId));
      const values = await promptAction({
        title: t('engineer.groups.rename'),
        message: t('engineer.groups.name'),
        confirmText: t('common.save') ?? 'Сохранить',
        fields: [
          {
            name: 'name',
            value: group?.name ?? '',
            placeholder: t('engineer.groups.name'),
            required: true,
            maxLength: 60,
          },
        ],
      });
      const newName = values?.name?.trim();
      if (!newName) return;
      try {
        showLoading();
        await apiFetch(`/api/spaces/${space.id}/groups/${groupId}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: newName.trim() }),
        });
        await refreshAll();
        showToast('Группа переименована.');
      } catch (error) {
        console.error(error);
        handleApiError(error, 'Не удалось переименовать группу.');
      } finally {
        hideLoading();
      }
    });
  });

  container.querySelectorAll('[data-device-group-apply]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!ensureEditable()) return;
      const deviceId = btn.dataset.deviceGroupApply;
      const select = container.querySelector(`[data-device-group="${deviceId}"]`);
      if (!select) return;
      try {
        showLoading();
        await apiFetch(`/api/spaces/${space.id}/devices/${deviceId}`, {
          method: 'PATCH',
          body: JSON.stringify({ groupId: select.value }),
        });
        await refreshAll();
        showToast('Группа для устройства обновлена.');
      } catch (error) {
        console.error(error);
        handleApiError(error, 'Не удалось обновить группу устройства.');
      } finally {
        hideLoading();
      }
    });
  });

  // Bind delete buttons
  container.querySelectorAll('[data-group-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!ensureEditable()) return;
      const groupId = btn.dataset.groupDelete;
      try {
        if (!await confirmAction('Удалить группу?', 'Удаление группы')) return;
        showLoading();
        await apiFetch(`/api/spaces/${space.id}/groups/${groupId}`, { method: 'DELETE' });
        await refreshAll();
        showToast('Группа удалена.');
      } catch (error) {
        console.error(error);
        handleApiError(error, 'Не удалось удалить группу.');
      } finally {
        hideLoading();
      }
    });
  });
};

const renderGroupsManageModal = (space) => {
  if (!groupsManageList) return;
  const groups = space.groups ?? [];
  if (!groups.length) {
    groupsManageList.innerHTML = `<div class="empty-state">${t('engineer.groups.noGroups')}</div>`;
    return;
  }
  groupsManageList.innerHTML = groups.map((group) => {
    const statusLabel = t(`status.${group.status}`) ?? group.status;
    const statusClass = statusTone[group.status] ?? '';
    return `
      <div class="group-manage-item">
        <div class="group-manage-item__info">
          <span class="group-manage-item__name">${escapeHtml(group.name)}</span>
          <span class="group-manage-item__status ${statusClass}">${escapeHtml(statusLabel)}</span>
        </div>
        <div class="group-manage-item__actions">
          ${group.status === 'armed'
            ? `<button class="button button--ghost" data-group-disarm="${group.id}">${t('engineer.groups.disarm')}</button>`
            : `<button class="button button--primary" data-group-arm="${group.id}">${t('engineer.groups.arm')}</button>`}
        </div>
      </div>
    `;
  }).join('');

  // Bind arm buttons
  groupsManageList.querySelectorAll('[data-group-arm]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const groupId = btn.dataset.groupArm;
      try {
        showLoading();
        const updated = await apiFetch(`/api/spaces/${space.id}/groups/${groupId}/arm`, { method: 'POST' });
        Object.assign(space, updated);
        await loadLogs(space.id);
        renderAll();
        renderGroupsManageModal(space);
        showToast('Группа поставлена под охрану.');
      } catch (error) {
        console.error(error);
        handleApiError(error, 'Не удалось поставить группу под охрану.');
      } finally {
        hideLoading();
      }
    });
  });

  // Bind disarm buttons
  groupsManageList.querySelectorAll('[data-group-disarm]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const groupId = btn.dataset.groupDisarm;
      try {
        showLoading();
        const updated = await apiFetch(`/api/spaces/${space.id}/groups/${groupId}/disarm`, { method: 'POST' });
        Object.assign(space, updated);
        await loadLogs(space.id);
        renderAll();
        renderGroupsManageModal(space);
        showToast('Группа снята с охраны.');
      } catch (error) {
        console.error(error);
        handleApiError(error, 'Не удалось снять группу с охраны.');
      } finally {
        hideLoading();
      }
    });
  });
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

logMoreButton?.addEventListener('click', () => {
  if (!state.selectedSpaceId) return;
  const space = spaces.find((item) => item.id === state.selectedSpaceId);
  if (space) space.logsLimit = (space.logsLimit ?? 200) + 200;
  loadLogs(state.selectedSpaceId, false).then(() => {
    if (space) renderLogs(space);
  }).catch(() => null);
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
    const limit = space.logsLimit ?? 200;
    const { logs, hasMore } = await fetchLogsChunked(`/api/spaces/${space.id}/logs`, limit);
    const lastLog = logs[0];
    const logKey = `${logs.length}-${lastLog?.time ?? ''}-${lastLog?.text ?? ''}-${lastLog?.createdAt ?? ''}`;
    if (logKey !== state.lastLogKey) {
      state.lastLogKey = logKey;
      space.logs = logs;
      space.logsOffset = logs.length;
      space.logsHasMore = hasMore;
      renderLogs(space);
      notifyLogEvent(space, lastLog).catch(() => null);
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
    const lockUntil = getSpaceCreateLockUntil();
    if (lockUntil) {
      updateSpaceCreateControls();
      showToast(`Создавать объекты можно не чаще, чем раз в 15 минут. Доступно после ${formatLockUntil(lockUntil)}.`);
      return;
    }
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
      state.lastSpaceCreateAt = new Date().toISOString();
      state.spaceCreateLockUntil = null;
      saveProfileSettings();
      updateSpaceCreateControls();
    } catch (error) {
      console.error(error);
      handleApiError(error, 'Не удалось создать пространство.');
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
    const isExtension = value === 'hub_extension';
    const isKey = value === 'key';

    readerFields?.classList.toggle('hidden', !isReader);
    sirenFields?.classList.toggle('hidden', !isSiren);
    lightFields?.classList.toggle('hidden', !isLight);
    zoneFields?.classList.toggle('hidden', !isZone);
    keyFields?.classList.toggle('hidden', !isKey);
    bindingFields?.classList.toggle('hidden', isKey || isReader || isExtension);
    extensionFields?.classList.toggle('hidden', !isExtension);

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
      sideInput.disabled = isKey || isExtension;
      sideInput.required = !isKey && !isExtension;
      if (isKey || isExtension) {
        sideInput.value = '';
      }
    }

    const space = spaces.find((item) => item.id === state.selectedSpaceId);
    const hasExtensions = (space?.devices ?? []).some((device) => isHubExtensionType(device.type));
    bindingFields?.querySelectorAll('input, select').forEach((input) => {
      input.disabled = isKey || isReader || isExtension;
    });
    if (bindTargetInput && bindExtensionInput) {
      const isBindExtension = bindTargetInput.value === 'hub_extension';
      bindExtensionInput.disabled = isKey || isReader || isExtension || !hasExtensions;
      bindExtensionInput.required = !isKey && !isReader && !isExtension && isBindExtension;
      bindExtensionInput.classList.toggle('hidden', !isBindExtension);
      if (!isBindExtension) {
        bindExtensionInput.value = '';
      }
    }
    extensionFields?.querySelectorAll('input, select').forEach((input) => {
      input.disabled = !isExtension;
      input.required = isExtension;
    });
    updateDeviceGroupSelect(space);

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
  bindTargetInput?.addEventListener('change', updateDeviceFields);
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
      const arr = new Uint8Array(4);
      crypto.getRandomValues(arr);
      keyInput.value = `KEY-${Array.from(arr, (b) => b.toString(36)).join('').slice(0, 6).toUpperCase()}`;
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
      if (noteInput) autoResize(noteInput);
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
    const lockUntil = getSpaceCreateLockUntil();
    if (lockUntil) {
      updateSpaceCreateControls();
      showToast(`Создавать объекты можно не чаще, чем раз в 15 минут. Доступно после ${formatLockUntil(lockUntil)}.`);
      return;
    }
    modal.classList.add('modal--open');
  });
}

if (backToMain) {
  backToMain.addEventListener('click', () => {
    window.location.href = 'index.html';
  });
}

if (openDeviceModal && deviceModal) {
  openDeviceModal.addEventListener('click', async () => {
    await updateCreateExtensionOptions();
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
      handleApiError(error, 'Не удалось привязать хаб.');
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
  setAvatar(state.avatarUrl);
  updateNicknameControls();
  updateSpaceCreateControls();
  await syncProfileSettings();
  if (profileNickname) profileNickname.value = state.nickname;
  if (isAdminPage) {
    const subtitle = document.getElementById('profileSubtitle');
    if (subtitle) subtitle.textContent = 'Admin';
  }
  let confirmedNickname = state.nickname;
  updateNicknameControls();
  updateSpaceCreateControls();
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
  profileNicknameChange?.addEventListener('click', async () => {
    if (!profileNickname || profileNickname.disabled) return;
    const nextNickname = profileNickname.value.trim();
    if (!nextNickname) {
      showToast('Введите корректный ник.');
      return;
    }
    if (nextNickname === confirmedNickname) {
      showToast('Ник уже установлен.');
      return;
    }
    if (isAdminPage) {
      confirmedNickname = nextNickname;
      state.nickname = confirmedNickname;
      profileNickname.value = confirmedNickname;
      saveProfileSettings();
      updateNicknameControls();
      return;
    }
    const result = await openActionModal({
      title: 'Сменить ник?',
      message: 'Ник нельзя сменить будет в течении следующих 7 дней.',
      confirmText: 'Сменить',
    });
    if (!result?.confirmed) {
      profileNickname.value = confirmedNickname;
      return;
    }
    try {
      const response = await apiFetch('/api/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ minecraft_nickname: nextNickname }),
      });
      confirmedNickname = response.user.minecraft_nickname ?? nextNickname;
      state.nickname = confirmedNickname;
      state.lastNicknameChangeAt = response.user?.last_nickname_change_at ?? null;
      profileNickname.value = confirmedNickname;
      saveProfileSettings();
      updateNicknameControls();
    } catch (error) {
      handleApiError(error, 'Не удалось обновить ник.');
      state.nickname = confirmedNickname;
      profileNickname.value = confirmedNickname;
      saveProfileSettings();
    }
  });
  profileTimezone?.addEventListener('change', (event) => {
    state.timezone = event.target.value;
    saveProfileSettings();
    if (!isAdminPage) {
      apiFetch('/api/auth/me', { method: 'PATCH', body: JSON.stringify({ timezone: state.timezone }) }).catch(() => null);
      loadLogs(state.selectedSpaceId).catch(() => null);
    }
  });
  profileLanguage?.addEventListener('change', (event) => {
    state.language = event.target.value;
    saveProfileSettings();
    applyTranslations();
    if (!isAdminPage) {
      apiFetch('/api/auth/me', { method: 'PATCH', body: JSON.stringify({ language: state.language }) }).catch(() => null);
    }
  });
  profileLogout?.addEventListener('click', async () => {
    state.nickname = '';
    state.lastNicknameChangeAt = null;
    state.lastSpaceCreateAt = null;
    state.spaceCreateLockUntil = null;
    state.avatarUrl = '';
    saveProfileSettings();
    if (!isAdminPage) {
      try {
        await apiFetch('/api/auth/logout', { method: 'POST' });
      } catch {
        // ignore
      }
      localStorage.removeItem('authToken');
      toggle(false);
      window.location.href = 'login.html';
      return;
    }
    localStorage.removeItem(adminTokenKey);
    toggle(false);
    window.location.href = window.location.pathname;
  });
  switchToUser?.addEventListener('click', () => {
    window.location.href = 'user.html';
  });
};

const init = async () => {
  if (!getAuthToken()) {
    if (!isAdminPage) {
      window.location.href = 'login.html';
    }
    return;
  }
  await initProfileMenu();
  setAvatar(state.avatarUrl);
  await loadSpaces();
  if (state.selectedSpaceId) {
    await loadLogs(state.selectedSpaceId);
  }
  renderAll();
  if (modal) {
    const params = new URLSearchParams(window.location.search);
    if (params.get('create') === '1') {
      const lockUntil = getSpaceCreateLockUntil();
      if (lockUntil) {
        updateSpaceCreateControls();
        showToast(`Создавать объекты можно не чаще, чем раз в 15 минут. Доступно после ${formatLockUntil(lockUntil)}.`);
      } else {
        modal.classList.add('modal--open');
      }
      params.delete('create');
      const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
      window.history.replaceState({}, '', newUrl);
    }
  }
  setInterval(pollLogs, 3000);
  setInterval(refreshAll, 12000);
};

init();
