const authTabs = document.querySelectorAll('#authTabs .tab');
const authPanels = document.querySelectorAll('.panel');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const authError = document.getElementById('authError');

const showError = (message) => {
  authError.textContent = message;
  authError.classList.add('auth-error--show');
};

const clearError = () => {
  authError.textContent = '';
  authError.classList.remove('auth-error--show');
};

authTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    authTabs.forEach((btn) => btn.classList.remove('tab--active'));
    authPanels.forEach((panel) => panel.classList.remove('panel--active'));
    tab.classList.add('tab--active');
    const target = document.getElementById(tab.dataset.tab);
    if (target) {
      target.classList.add('panel--active');
    }
    clearError();
  });
});

const storeProfileSettings = (user) => {
  const profileSettings = {
    nickname: user.minecraft_nickname ?? '',
    language: user.language ?? 'ru',
    timezone: user.timezone ?? 'UTC',
  };
  localStorage.setItem('profileSettings', JSON.stringify(profileSettings));
};

const handleAuthSuccess = ({ token, user }) => {
  localStorage.setItem('authToken', token);
  storeProfileSettings(user);
  if (user.role === 'installer') {
    window.location.href = 'index.html';
  } else {
    window.location.href = 'user.html';
  }
};

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();
  const formData = new FormData(loginForm);
  const payload = Object.fromEntries(formData.entries());
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error ?? 'login_failed');
    }
    const data = await response.json();
    handleAuthSuccess(data);
  } catch (error) {
    showError('Не удалось войти. Проверьте логин и пароль.');
  }
});

registerForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();
  const formData = new FormData(registerForm);
  const payload = Object.fromEntries(formData.entries());
  try {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error ?? 'register_failed');
    }
    const data = await response.json();
    handleAuthSuccess(data);
  } catch (error) {
    showError('Не удалось зарегистрироваться. Возможно, email уже используется.');
  }
});
