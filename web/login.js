const authTabs = document.querySelectorAll('#authTabs .tab');
const authPanels = document.querySelectorAll('.panel');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const authError = document.getElementById('authError');
const discordLogin = document.getElementById('discordLogin');
const discordRegister = document.getElementById('discordRegister');
const urlParams = new URLSearchParams(window.location.search);

const translations = {
  ru: {
    'auth.tabs.login': 'Вход',
    'auth.tabs.register': 'Регистрация',
    'auth.fields.email': 'Email',
    'auth.fields.password': 'Пароль',
    'auth.fields.nickname': 'Игровой ник',
    'auth.actions.login': 'Войти',
    'auth.actions.register': 'Создать аккаунт',
    'auth.actions.discordLogin': 'Войти через Discord',
    'auth.actions.discordRegister': 'Зарегистрироваться через Discord',
    'auth.divider': 'или',
    'auth.roles.user': 'Пользователь',
    'auth.roles.installer': 'Инженер монтажа',
    'auth.languages.ru': 'Русский',
    'auth.languages.en': 'English (US)',
    'auth.errors.login': 'Не удалось войти. Проверьте логин и пароль.',
    'auth.errors.register': 'Не удалось зарегистрироваться. Возможно, email уже используется.',
    'auth.errors.discord': 'Не удалось войти через Discord.',
    'auth.errors.discordLink': 'Discord не связан с аккаунтом. Используйте регистрацию.',
  },
  'en-US': {
    'auth.tabs.login': 'Sign in',
    'auth.tabs.register': 'Register',
    'auth.fields.email': 'Email',
    'auth.fields.password': 'Password',
    'auth.fields.nickname': 'Game nickname',
    'auth.actions.login': 'Sign in',
    'auth.actions.register': 'Create account',
    'auth.actions.discordLogin': 'Sign in with Discord',
    'auth.actions.discordRegister': 'Register with Discord',
    'auth.divider': 'or',
    'auth.roles.user': 'User',
    'auth.roles.installer': 'Installer',
    'auth.languages.ru': 'Russian',
    'auth.languages.en': 'English (US)',
    'auth.errors.login': 'Unable to sign in. Check your email and password.',
    'auth.errors.register': 'Unable to register. The email might already be used.',
    'auth.errors.discord': 'Unable to sign in with Discord.',
    'auth.errors.discordLink': 'Discord is not linked. Use registration instead.',
  },
};

let language = 'ru';

const applyTranslations = () => {
  const dict = translations[language] ?? translations.ru;
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

const syncLanguageFromProfile = () => {
  const raw = localStorage.getItem('profileSettings');
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    language = parsed.language ?? language;
  } catch {
    // ignore
  }
};

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

const handleDiscordRedirect = async () => {
  const token = urlParams.get('token');
  const role = urlParams.get('role');
  const error = urlParams.get('error');
  if (error) {
    if (error === 'discord-not-linked') {
      showError(translations[language]?.['auth.errors.discordLink'] ?? 'Discord не связан с аккаунтом.');
    } else {
      showError(translations[language]?.['auth.errors.discord'] ?? 'Discord login failed.');
    }
    return;
  }
  if (token) {
    localStorage.setItem('authToken', token);
    if (role === 'installer') {
      window.location.href = 'index.html';
    } else {
      window.location.href = 'user.html';
    }
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
    showError(translations[language]?.['auth.errors.login'] ?? 'Login failed.');
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
    showError(translations[language]?.['auth.errors.register'] ?? 'Register failed.');
  }
});

const startDiscordAuth = (mode) => {
  window.location.href = `/api/auth/discord/start?mode=${mode}`;
};

discordLogin?.addEventListener('click', () => startDiscordAuth('login'));
discordRegister?.addEventListener('click', () => startDiscordAuth('register'));

syncLanguageFromProfile();
applyTranslations();
handleDiscordRedirect();
