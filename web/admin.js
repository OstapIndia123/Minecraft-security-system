(() => {
const adminLoginModal = document.getElementById('adminLoginModal');
const adminLoginForm = document.getElementById('adminLoginForm');
const adminPassword = document.getElementById('adminPassword');
const openAdminUsers = document.getElementById('openAdminUsers');
const adminUsersModal = document.getElementById('adminUsersModal');
const closeAdminUsers = document.getElementById('closeAdminUsers');
const adminUsersList = document.getElementById('adminUsersList');
const adminUsersSearch = document.getElementById('adminUsersSearch');
const adminLogsDays = document.getElementById('adminLogsDays');
const adminLogsPurge = document.getElementById('adminLogsPurge');
const profileLanguage = document.getElementById('profileLanguage');

const getAdminToken = () => localStorage.getItem('adminToken');

const adminTranslations = {
  ru: {
    emptyUsers: 'Пользователи не найдены.',
    emptyFilteredUsers: 'По вашему запросу ничего не найдено.',
    block: 'Заблокировать',
    unblock: 'Разблокировать',
    remove: 'Удалить',
    removeConfirm: (name) => `Удалить аккаунт ${name}? Это действие необратимо.`,
    invalidPassword: 'Неверный пароль.',
    purgeConfirm: (days) => `Удалить логи старше ${days} дн.?`,
    purgeDone: (count) => `Удалено логов: ${count}`,
    purgeFailed: 'Не удалось очистить логи.',
  },
  'en-US': {
    emptyUsers: 'No users found.',
    emptyFilteredUsers: 'No users match your query.',
    block: 'Block',
    unblock: 'Unblock',
    remove: 'Delete',
    removeConfirm: (name) => `Delete account ${name}? This action cannot be undone.`,
    invalidPassword: 'Incorrect password.',
    purgeConfirm: (days) => `Delete logs older than ${days} days?`,
    purgeDone: (count) => `Logs deleted: ${count}`,
    purgeFailed: 'Failed to purge logs.',
  },
};

const getAdminLanguage = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem('profileSettingsAdmin') ?? '{}');
    return parsed.language ?? 'ru';
  } catch {
    return 'ru';
  }
};

const detectBrowserLanguage = () => {
  const lang = navigator.language ?? 'ru';
  return lang.toLowerCase().startsWith('en') ? 'en-US' : 'ru';
};

const ensureAdminLanguage = () => {
  const raw = localStorage.getItem('profileSettingsAdmin');
  if (raw) return;
  const language = detectBrowserLanguage();
  localStorage.setItem('profileSettingsAdmin', JSON.stringify({ language }));
};

const tAdmin = (key, arg) => {
  const lang = getAdminLanguage();
  const dict = adminTranslations[lang] ?? adminTranslations.ru;
  const value = dict[key] ?? adminTranslations.ru[key] ?? key;
  return typeof value === 'function' ? value(arg) : value;
};

let adminUsersCache = [];

const normalizeValue = (value) => String(value ?? '').trim().toLowerCase();

const getFilteredUsers = (users, query) => {
  const normalizedQuery = normalizeValue(query);
  if (!normalizedQuery) return users;
  return users.filter((user) => {
    const nickname = normalizeValue(user.minecraft_nickname);
    const email = normalizeValue(user.email);
    const role = normalizeValue(user.role);
    const discordId = normalizeValue(user.discord_id);
    const id = normalizeValue(user.id);
    return nickname.includes(normalizedQuery)
      || email.includes(normalizedQuery)
      || role.includes(normalizedQuery)
      || discordId.includes(normalizedQuery)
      || id.includes(normalizedQuery);
  });
};

const renderUsers = (users) => {
  if (!adminUsersList) return;
  const query = adminUsersSearch?.value ?? '';
  const filteredUsers = getFilteredUsers(users, query);
  adminUsersList.innerHTML = '';
  if (!filteredUsers.length) {
    adminUsersList.textContent = query ? tAdmin('emptyFilteredUsers') : tAdmin('emptyUsers');
    return;
  }
  filteredUsers.forEach((user) => {
    const row = document.createElement('div');
    row.className = 'admin-users__row';

    const info = document.createElement('div');
    info.className = 'admin-users__info';
    const name = user.minecraft_nickname || user.email || `#${user.id}`;
    info.innerHTML = `
      <div class="admin-users__name">${name}</div>
      <div class="admin-users__meta">${user.email ?? '—'} • ${user.role} • ${user.discord_id ?? '—'}</div>
    `;

    const actions = document.createElement('div');
    actions.className = 'admin-users__actions';
    const toggle = document.createElement('button');
    toggle.className = `button ${user.is_blocked ? 'button--primary' : 'button--ghost'}`;
    toggle.textContent = user.is_blocked ? tAdmin('unblock') : tAdmin('block');
    toggle.addEventListener('click', async () => {
      const token = getAdminToken();
      if (!token) return;
      const path = user.is_blocked ? 'unblock' : 'block';
      const response = await fetch(`/api/admin/users/${user.id}/${path}`, {
        method: 'POST',
        headers: { 'X-Admin-Token': token },
      });
      if (response.ok) {
        const updated = await response.json();
        user.is_blocked = updated.is_blocked;
        renderUsers(adminUsersCache);
      }
    });
    actions.appendChild(toggle);

    const remove = document.createElement('button');
    remove.className = 'button button--danger';
    remove.textContent = tAdmin('remove');
    remove.addEventListener('click', async () => {
      const confirmed = window.confirm(tAdmin('removeConfirm', name));
      if (!confirmed) return;
      const token = getAdminToken();
      if (!token) return;
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: 'DELETE',
        headers: { 'X-Admin-Token': token },
      });
      if (response.ok) {
        adminUsersCache = adminUsersCache.filter((item) => item.id !== user.id);
        renderUsers(adminUsersCache);
      }
    });
    actions.appendChild(remove);

    row.appendChild(info);
    row.appendChild(actions);
    adminUsersList.appendChild(row);
  });
};

const loadUsers = async () => {
  const token = getAdminToken();
  if (!token) return;
  const response = await fetch('/api/admin/users', {
    headers: { 'X-Admin-Token': token },
  });
  if (!response.ok) return;
  adminUsersCache = await response.json();
  renderUsers(adminUsersCache);
};

const openUsersModal = async () => {
  if (!adminUsersModal) return;
  adminUsersModal.classList.add('modal--open');
  adminUsersModal.setAttribute('aria-hidden', 'false');
  await loadUsers();
};

const closeUsersModal = () => {
  adminUsersModal?.classList.remove('modal--open');
  adminUsersModal?.setAttribute('aria-hidden', 'true');
};

const openLoginModal = () => {
  if (!adminLoginModal) return;
  adminLoginModal.classList.add('modal--open');
  adminLoginModal.setAttribute('aria-hidden', 'false');
  adminPassword?.focus();
};

const closeLoginModal = () => {
  adminLoginModal?.classList.remove('modal--open');
  adminLoginModal?.setAttribute('aria-hidden', 'true');
};

openAdminUsers?.addEventListener('click', () => {
  if (!getAdminToken()) {
    openLoginModal();
    return;
  }
  openUsersModal().catch(() => null);
});

closeAdminUsers?.addEventListener('click', closeUsersModal);

adminUsersSearch?.addEventListener('input', () => {
  renderUsers(adminUsersCache);
});

adminLoginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = adminPassword?.value ?? '';
  if (!password) return;
  const response = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!response.ok) {
    alert(tAdmin('invalidPassword'));
    return;
  }
  const payload = await response.json();
  localStorage.setItem('adminToken', payload.token);
  closeLoginModal();
  window.location.reload();
});

if (!getAdminToken()) {
  openLoginModal();
}

adminLogsPurge?.addEventListener('click', async () => {
  const token = getAdminToken();
  if (!token) return;
  const days = Number(adminLogsDays?.value ?? 0);
  if (!Number.isFinite(days) || days <= 0) return;
  const confirmed = window.confirm(tAdmin('purgeConfirm', days));
  if (!confirmed) return;
  const response = await fetch('/api/admin/logs/purge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
    body: JSON.stringify({ days }),
  });
  if (!response.ok) {
    window.alert(tAdmin('purgeFailed'));
    return;
  }
  const payload = await response.json();
  window.alert(tAdmin('purgeDone', payload.deleted ?? 0));
});

ensureAdminLanguage();

profileLanguage?.addEventListener('change', () => {
  if (adminUsersModal?.classList.contains('modal--open')) {
    loadUsers().catch(() => null);
  }
});
})();
