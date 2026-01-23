const authError = document.getElementById('authError');
const discordLogin = document.getElementById('discordLogin');
const urlParams = new URLSearchParams(window.location.search);

const translations = {
  ru: {
    'auth.actions.discordOnly': 'Войти через Discord',
    'auth.title': 'Авторизация',
    'auth.subtitle': 'Вход в систему через Discord',
    'auth.discord.note': 'Мы поддерживаем только авторизацию через Discord.',
    'auth.errors.discord': 'Не удалось войти через Discord.',
  },
  'en-US': {
    'auth.actions.discordOnly': 'Sign in with Discord',
    'auth.title': 'Sign in',
    'auth.subtitle': 'Sign in with Discord',
    'auth.discord.note': 'We only support Discord authentication.',
    'auth.errors.discord': 'Unable to sign in with Discord.',
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

const handleDiscordRedirect = async () => {
  const token = urlParams.get('token');
  const role = urlParams.get('role');
  const error = urlParams.get('error');
  if (error) {
    showError(translations[language]?.['auth.errors.discord'] ?? 'Discord login failed.');
    return;
  }
  if (token) {
    localStorage.setItem('authToken', token);
    try {
      const response = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const payload = await response.json();
        const profileSettings = {
          nickname: payload.user?.minecraft_nickname ?? '',
          language: payload.user?.language ?? 'ru',
          timezone: payload.user?.timezone ?? 'UTC',
        };
        localStorage.setItem('profileSettings', JSON.stringify(profileSettings));
        if (payload.user?.role === 'installer') {
          window.location.href = 'index.html';
          return;
        }
      }
    } catch {
      // ignore
    }
    window.location.href = role === 'installer' ? 'index.html' : 'user.html';
  }
};

const startDiscordAuth = () => {
  window.location.href = '/api/auth/discord/start';
};

discordLogin?.addEventListener('click', () => startDiscordAuth());

syncLanguageFromProfile();
applyTranslations();
handleDiscordRedirect();
