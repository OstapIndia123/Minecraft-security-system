const authError = document.getElementById('authError');
const discordLogin = document.getElementById('discordLogin');
const urlParams = new URLSearchParams(window.location.search);
const nicknameModal = document.getElementById('nicknameModal');
const nicknameForm = document.getElementById('nicknameForm');

const translations = {
  ru: {
    'auth.actions.discordOnly': 'Войти через Discord',
    'auth.title': 'Авторизация',
    'auth.subtitle': 'Вход в систему через Discord или лаунчер',
    'auth.discord.note':
      'Мы поддерживаем авторизацию только через Discord/наш лаучер. При первом входе нужно указать игровой ник.',
    'auth.nickname.title': 'Введите игровой ник',
    'auth.nickname.placeholder': 'Игровой ник',
    'auth.nickname.save': 'Сохранить',
    'auth.errors.discord': 'Не удалось войти через Discord.',
    'auth.errors.launcher': 'Не удалось войти через лаунчер.',
    'auth.errors.nickname_taken': 'Такой ник уже занят.',
  },
  'en-US': {
    'auth.actions.discordOnly': 'Sign in with Discord',
    'auth.title': 'Sign in',
    'auth.subtitle': 'Sign in with Discord or the launcher',
    'auth.discord.note':
      'We only support Discord/launcher authentication. Provide your game nickname on first sign-in.',
    'auth.nickname.title': 'Enter game nickname',
    'auth.nickname.placeholder': 'Game nickname',
    'auth.nickname.save': 'Save',
    'auth.errors.discord': 'Unable to sign in with Discord.',
    'auth.errors.launcher': 'Unable to sign in with the launcher.',
    'auth.errors.nickname_taken': 'That nickname is already taken.',
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

const showNicknameModal = (role, token) => {
  if (!nicknameModal || !nicknameForm) return;
  nicknameModal.classList.add('modal--open');
  nicknameModal.setAttribute('aria-hidden', 'false');
  nicknameForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const nickname = new FormData(nicknameForm).get('nickname')?.toString().trim();
    if (!nickname) return;
    try {
      const response = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ minecraft_nickname: nickname }),
      });
      if (!response.ok) {
        if (response.status === 409) {
          showError(translations[language]?.['auth.errors.nickname_taken'] ?? 'Nickname already taken.');
          return;
        }
        throw new Error('nickname_update_failed');
      }
      let timezoneValue = 'UTC';
      let avatarUrl = '';
      const rawSettings = localStorage.getItem('profileSettings');
      if (rawSettings) {
        try {
          const parsed = JSON.parse(rawSettings);
          timezoneValue = parsed.timezone ?? timezoneValue;
          avatarUrl = parsed.avatarUrl ?? avatarUrl;
        } catch {
          // ignore
        }
      }
      const profileSettings = {
        nickname,
        language,
        timezone: timezoneValue,
        avatarUrl,
      };
      localStorage.setItem('profileSettings', JSON.stringify(profileSettings));
      nicknameModal.classList.remove('modal--open');
      nicknameModal.setAttribute('aria-hidden', 'true');
      window.location.href = role === 'installer' ? 'index.html' : 'user.html';
    } catch {
      showError(translations[language]?.['auth.errors.discord'] ?? 'Discord login failed.');
    }
  }, { once: true });
};

const handleLauncherLogin = async (launcherToken) => {
  try {
    const response = await fetch(`/api/auth/launcher?token=${encodeURIComponent(launcherToken)}`);
    if (!response.ok) {
      if (response.status === 409) {
        showError(translations[language]?.['auth.errors.nickname_taken'] ?? 'Nickname already taken.');
      } else {
        showError(translations[language]?.['auth.errors.launcher'] ?? 'Launcher login failed.');
      }
      return;
    }
    const payload = await response.json();
    const authToken = payload.token;
    const user = payload.user ?? {};
    if (!authToken) {
      showError(translations[language]?.['auth.errors.launcher'] ?? 'Launcher login failed.');
      return;
    }
    localStorage.setItem('authToken', authToken);
    const nickname = user.minecraft_nickname ?? '';
    const profileSettings = {
      nickname,
      language: user.language ?? 'ru',
      timezone: user.timezone ?? 'UTC',
      avatarUrl: user.discord_avatar_url ?? '',
    };
    localStorage.setItem('profileSettings', JSON.stringify(profileSettings));
    const resolvedRole = user.role ?? 'user';
    if (!nickname) {
      showNicknameModal(resolvedRole, authToken);
      return;
    }
    window.location.href = resolvedRole === 'installer' ? 'index.html' : 'user.html';
  } catch {
    showError(translations[language]?.['auth.errors.launcher'] ?? 'Launcher login failed.');
  }
};

const handleDiscordRedirect = async () => {
  const token = urlParams.get('token');
  const role = urlParams.get('role');
  const error = urlParams.get('error');
  if (error) {
    showError(translations[language]?.['auth.errors.discord'] ?? 'Discord login failed.');
    return;
  }
  if (token && !role) {
    await handleLauncherLogin(token);
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
        const nickname = payload.user?.minecraft_nickname ?? '';
        const profileSettings = {
          nickname,
          language: payload.user?.language ?? 'ru',
          timezone: payload.user?.timezone ?? 'UTC',
          avatarUrl: payload.user?.discord_avatar_url ?? '',
        };
        localStorage.setItem('profileSettings', JSON.stringify(profileSettings));
        const resolvedRole = payload.user?.role ?? role ?? 'user';
        if (!nickname) {
          showNicknameModal(resolvedRole, token);
          return;
        }
        window.location.href = resolvedRole === 'installer' ? 'index.html' : 'user.html';
        return;
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
