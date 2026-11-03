(() => {
  const config = window.SOYUZ_AUTH_CONFIG || {};
  const dialog = document.querySelector('#auth-dialog');
  const form = document.querySelector('#auth-form');
  const phoneInput = document.querySelector('#auth-phone');
  const passwordInput = document.querySelector('#auth-password');
  const rememberInput = document.querySelector('#auth-remember');
  const message = document.querySelector('#auth-message');
  const submit = document.querySelector('.auth-submit');
  const sessionPanel = document.querySelector('#auth-session');
  const sessionPhone = document.querySelector('#auth-user-phone');
  const accountLabel = document.querySelector('#account-label');
  const accountButton = document.querySelector('#account-button');
  const storageKey = 'soyuz-auth-session';
  let mode = 'login';
  let session = null;

  const configured = () => Boolean(config.url && config.anonKey);
  const apiUrl = path => `${String(config.url).replace(/\/$/, '')}/auth/v1${path}`;
  const headers = token => ({
    apikey: config.anonKey,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'Content-Type': 'application/json'
  });
  const normalizePhone = value => {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
    if (digits.length === 10) digits = `7${digits}`;
    return digits.length >= 11 ? `+${digits}` : '';
  };
  const phoneEmail = phone => `p${phone.replace(/\D/g, '')}@phone.soyuz-music.local`;

  function setMessage(text = '', success = false) {
    message.textContent = text;
    message.classList.toggle('success', success);
  }

  function saveSession(next, remember) {
    localStorage.removeItem(storageKey);
    sessionStorage.removeItem(storageKey);
    if (!next) return;
    (remember ? localStorage : sessionStorage).setItem(storageKey, JSON.stringify(next));
  }

  function readSession() {
    const raw = localStorage.getItem(storageKey) || sessionStorage.getItem(storageKey);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function renderSession() {
    const phone = session?.user?.user_metadata?.phone || session?.phone || '';
    const signedIn = Boolean(session?.access_token && phone);
    form.hidden = signedIn;
    document.querySelector('.auth-tabs').hidden = signedIn;
    sessionPanel.hidden = !signedIn;
    sessionPhone.textContent = phone;
    accountLabel.textContent = signedIn ? phone : 'Войти';
    accountButton.setAttribute('aria-label', signedIn ? `Личный кабинет: ${phone}` : 'Войти или зарегистрироваться');
  }

  async function request(path, body, token = '') {
    const response = await fetch(apiUrl(path), {
      method: 'POST',
      headers: headers(token),
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.msg || data.error_description || data.message || 'Не удалось выполнить запрос');
    return data;
  }

  async function refreshStoredSession(stored) {
    if (!configured() || !stored?.refresh_token) return stored;
    const expiresAt = Number(stored.expires_at || 0);
    if (expiresAt > Math.floor(Date.now() / 1000) + 60) return stored;
    try {
      const refreshed = await request('/token?grant_type=refresh_token', { refresh_token: stored.refresh_token });
      refreshed.phone = stored.phone;
      const remember = Boolean(localStorage.getItem(storageKey));
      saveSession(refreshed, remember);
      return refreshed;
    } catch {
      saveSession(null, false);
      return null;
    }
  }

  function setMode(nextMode) {
    mode = nextMode;
    document.querySelectorAll('[data-auth-mode]').forEach(tab => {
      const active = tab.dataset.authMode === mode;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    document.querySelector('#auth-title').textContent = mode === 'register' ? 'Регистрация' : 'Вход';
    document.querySelector('#auth-subtitle').textContent = mode === 'register'
      ? 'Номер телефона станет вашим логином. Пароль придумайте сами.'
      : 'Войдите по номеру телефона и паролю.';
    submit.textContent = mode === 'register' ? 'Зарегистрироваться' : 'Войти';
    passwordInput.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    setMessage();
  }

  accountButton.addEventListener('click', () => {
    renderSession();
    if (!configured() && !session) setMessage('Регистрация подготовлена. Для запуска нужно один раз подключить бесплатный проект авторизации.');
    dialog.showModal();
  });
  document.querySelector('.auth-close').addEventListener('click', () => dialog.close());
  document.querySelectorAll('[data-auth-mode]').forEach(tab => tab.addEventListener('click', () => setMode(tab.dataset.authMode)));

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!configured()) {
      setMessage('Сервис авторизации ещё не подключён. Данные проекта нужно внести в auth-config.js.');
      return;
    }
    const phone = normalizePhone(phoneInput.value);
    if (!phone) {
      setMessage('Введите номер телефона полностью, например +7 999 123-45-67.');
      return;
    }
    if (passwordInput.value.length < 6) {
      setMessage('Пароль должен содержать не меньше 6 символов.');
      return;
    }
    submit.disabled = true;
    setMessage(mode === 'register' ? 'Создаём аккаунт…' : 'Входим…', true);
    try {
      const email = phoneEmail(phone);
      const data = mode === 'register'
        ? await request('/signup', { email, password: passwordInput.value, data: { phone } })
        : await request('/token?grant_type=password', { email, password: passwordInput.value });
      if (!data.access_token) throw new Error('Отключите подтверждение email в настройках проекта авторизации.');
      session = { ...data, phone };
      saveSession(session, rememberInput.checked);
      passwordInput.value = '';
      setMessage('Готово.', true);
      renderSession();
    } catch (error) {
      const replacements = {
        'Invalid login credentials': 'Неверный номер телефона или пароль.',
        'User already registered': 'Пользователь с таким номером уже зарегистрирован.',
        'Password should be at least 6 characters': 'Пароль должен содержать не меньше 6 символов.'
      };
      setMessage(replacements[error.message] || error.message);
    } finally {
      submit.disabled = false;
    }
  });

  document.querySelector('#auth-logout').addEventListener('click', async () => {
    if (configured() && session?.access_token) {
      await request('/logout', null, session.access_token).catch(() => {});
    }
    session = null;
    saveSession(null, false);
    setMode('login');
    renderSession();
  });

  (async () => {
    session = await refreshStoredSession(readSession());
    renderSession();
  })();
})();
