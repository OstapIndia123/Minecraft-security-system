const adminLoginModal = document.getElementById('adminLoginModal');
const adminLoginForm = document.getElementById('adminLoginForm');
const adminPassword = document.getElementById('adminPassword');
const openAdminUsers = document.getElementById('openAdminUsers');
const adminUsersModal = document.getElementById('adminUsersModal');
const closeAdminUsers = document.getElementById('closeAdminUsers');
const adminUsersList = document.getElementById('adminUsersList');
const profileLanguage = document.getElementById('profileLanguage');

const getAdminToken = () => localStorage.getItem('adminToken');

const adminTranslations = {
  ru: {
    emptyUsers: 'Пользователи не найдены.',
    block: 'Заблокировать',
    unblock: 'Разблокировать',
    remove: 'Удалить',
    removeConfirm: (name) => `Удалить аккаунт ${name}? Это действие необратимо.`,
    invalidPassword: 'Неверный пароль.',
  },
  'en-US': {
    emptyUsers: 'No users found.',
    block: 'Block',
    unblock: 'Unblock',
    remove: 'Delete',
    removeConfirm: (name) => `Delete account ${name}? This action cannot be undone.`,
    invalidPassword: 'Incorrect password.',
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

const tAdmin = (key, arg) => {
  const lang = getAdminLanguage();
  const dict = adminTranslations[lang] ?? adminTranslations.ru;
  const value = dict[key] ?? adminTranslations.ru[key] ?? key;
  return typeof value === 'function' ? value(arg) : value;
};

const renderUsers = (users) => {
  if (!adminUsersList) return;
  adminUsersList.innerHTML = '';
  if (!users.length) {
    adminUsersList.textContent = tAdmin('emptyUsers');
    return;
  }
  users.forEach((user) => {
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
        renderUsers(users);
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
        const next = users.filter((item) => item.id !== user.id);
        renderUsers(next);
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
  const users = await response.json();
  renderUsers(users);
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

profileLanguage?.addEventListener('change', () => {
  if (adminUsersModal?.classList.contains('modal--open')) {
    loadUsers().catch(() => null);
  }
});
