(() => {
  const config = window.SOYUZ_AUTH_CONFIG || {};
  const isAccountPage = document.body.dataset.page === 'account';
  const dialog = document.querySelector('#auth-dialog');
  const form = document.querySelector('#auth-form');
  const entryPanel = document.querySelector('#auth-entry');
  const nameInput = document.querySelector('#auth-name');
  const emailInput = document.querySelector('#auth-email');
  const phoneInput = document.querySelector('#auth-phone');
  const passwordInput = document.querySelector('#auth-password');
  const rememberInput = document.querySelector('#auth-remember');
  const message = document.querySelector('#auth-message');
  const submit = document.querySelector('.auth-submit');
  const sessionPanel = document.querySelector('#auth-session');
  const sessionName = document.querySelector('#auth-user-name');
  const sessionPhone = document.querySelector('#auth-user-phone');
  const profileForm = document.querySelector('#auth-profile-form');
  const profileName = document.querySelector('#auth-profile-name');
  const profileEmail = document.querySelector('#auth-profile-email');
  const profileMessage = document.querySelector('#auth-profile-message');
  const accountLabel = document.querySelector('#account-label');
  const accountButton = document.querySelector('#account-button');
  const deleteButton = document.querySelector('#auth-delete');
  const waitlistList = document.querySelector('#auth-waitlist-list');
  const waitlistCount = document.querySelector('#auth-waitlist-count');
  const storageKey = 'soyuz-auth-session';
  let mode = 'login';
  let session = null;
  let waitlistIds = new Set();
  let waitlistRows = [];

  const configured = () => Boolean(config.url && config.anonKey);
  const apiUrl = path => `${String(config.url).replace(/\/$/, '')}/auth/v1${path}`;
  const restUrl = path => `${String(config.url).replace(/\/$/, '')}/rest/v1${path}`;
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
    const name = session?.user?.user_metadata?.display_name || '';
    const email = session?.user?.user_metadata?.contact_email || '';
    const signedIn = Boolean(session?.access_token && phone);
    entryPanel.hidden = signedIn;
    sessionPanel.hidden = !signedIn;
    sessionName.textContent = name || phone;
    sessionPhone.textContent = phone;
    profileName.value = name;
    profileEmail.value = email;
    if (accountLabel) accountLabel.textContent = signedIn ? (name || phone) : 'Войти';
    if (accountButton) accountButton.setAttribute('aria-label', signedIn ? `Личный кабинет: ${name || phone}` : 'Войти или зарегистрироваться');
  }

  async function request(path, body, token = '', method = 'POST') {
    const response = await fetch(apiUrl(path), {
      method,
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
    document.querySelectorAll('.auth-register-field').forEach(field => { field.hidden = mode !== 'register'; });
    nameInput.required = mode === 'register';
    emailInput.required = mode === 'register';
    setMessage();
  }

  function dispatchAuthChange() {
    window.dispatchEvent(new CustomEvent('soyuz-auth-change', { detail: { signedIn: Boolean(session?.access_token) } }));
  }

  function dispatchWaitlistChange() {
    renderWaitlist();
    window.dispatchEvent(new CustomEvent('soyuz-waitlist-change', {
      detail: { ids: [...waitlistIds], rows: waitlistRows.map(row => ({ ...row })) }
    }));
  }

  function renderWaitlist() {
    waitlistCount.textContent = String(waitlistRows.length);
    waitlistList.replaceChildren();
    if (!waitlistRows.length) {
      const empty = document.createElement('p');
      empty.className = 'auth-waitlist-empty';
      empty.textContent = 'Список пока пуст. Добавьте отсутствующий товар кнопкой «Сообщить о поступлении».';
      waitlistList.append(empty);
      return;
    }
    waitlistRows.forEach(row => {
      const item = document.createElement('article');
      item.className = 'auth-waitlist-item';
      const title = document.createElement('strong');
      title.textContent = row.product_title || 'Товар';
      const status = document.createElement('span');
      status.className = row.notified_at ? 'ready' : '';
      status.textContent = row.notified_at ? '✓ Товар появился — уведомление отправлено' : '✓ В листе ожидания';
      item.append(title, status);
      waitlistList.append(item);
    });
  }

  async function loadWaitlist() {
    waitlistIds = new Set();
    waitlistRows = [];
    if (!configured() || !session?.access_token) {
      dispatchWaitlistChange();
      return;
    }
    const response = await fetch(restUrl('/waitlist?select=id,product_id,product_title,notified_at,read_at,created_at&order=created_at.desc'), {
      headers: headers(session.access_token)
    });
    if (!response.ok) return;
    waitlistRows = await response.json();
    waitlistIds = new Set(waitlistRows.map(row => String(row.product_id)));
    dispatchWaitlistChange();
  }

  async function addToWaitlist(product) {
    if (!session?.access_token) {
      window.location.href = 'account.html';
      return false;
    }
    const metadata = session.user?.user_metadata || {};
    if (!metadata.contact_email) {
      profileMessage.textContent = 'Укажите электронную почту, чтобы мы смогли сообщить о поступлении.';
      renderSession();
      if (!isAccountPage) window.location.href = 'account.html';
      return false;
    }
    const response = await fetch(restUrl('/waitlist?on_conflict=user_id,product_id'), {
      method: 'POST',
      headers: {
        ...headers(session.access_token),
        Prefer: 'resolution=ignore-duplicates,return=minimal'
      },
      body: JSON.stringify({
        user_id: session.user.id,
        product_id: String(product.id),
        product_title: [product.artist, product.title].filter(Boolean).join(' — '),
        email: metadata.contact_email,
        customer_name: metadata.display_name || ''
      })
    });
    if (!response.ok) throw new Error('Не удалось добавить товар в лист ожидания. Попробуйте ещё раз.');
    await loadWaitlist();
    return true;
  }

  async function markNotificationsRead(ids) {
    const rowIds = [...new Set((ids || []).map(Number).filter(Number.isFinite))];
    if (!session?.access_token || !rowIds.length) return;
    const response = await fetch(restUrl(`/waitlist?id=in.(${rowIds.join(',')})`), {
      method: 'PATCH',
      headers: { ...headers(session.access_token), Prefer: 'return=minimal' },
      body: JSON.stringify({ read_at: new Date().toISOString() })
    });
    if (!response.ok) throw new Error('Не удалось отметить уведомления прочитанными.');
    await loadWaitlist();
  }

  accountButton?.addEventListener('click', () => { window.location.href = 'account.html'; });
  document.querySelector('.auth-close')?.addEventListener('click', () => { window.location.href = './'; });
  document.querySelector('#auth-home').addEventListener('click', () => {
    window.location.href = './';
  });
  document.querySelector('#auth-home-public').addEventListener('click', () => {
    window.location.href = './';
  });
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
      const displayName = nameInput.value.trim();
      const contactEmail = emailInput.value.trim().toLocaleLowerCase('ru');
      if (mode === 'register' && !displayName) throw new Error('Укажите имя.');
      if (mode === 'register' && !emailInput.validity.valid) throw new Error('Укажите корректную электронную почту.');
      const data = mode === 'register'
        ? await request('/signup', { email, password: passwordInput.value, data: { phone, display_name: displayName, contact_email: contactEmail } })
        : await request('/token?grant_type=password', { email, password: passwordInput.value });
      if (!data.access_token) throw new Error('Отключите подтверждение email в настройках проекта авторизации.');
      session = { ...data, phone };
      saveSession(session, rememberInput.checked);
      passwordInput.value = '';
      setMessage('Готово.', true);
      renderSession();
      dispatchAuthChange();
      await loadWaitlist();
      if (!isAccountPage && typeof dialog.close === 'function') dialog.close();
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

  profileForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!session?.access_token) return;
    const displayName = profileName.value.trim();
    const contactEmail = profileEmail.value.trim().toLocaleLowerCase('ru');
    if (!displayName || !profileEmail.validity.valid) {
      profileMessage.textContent = 'Укажите имя и корректную электронную почту.';
      return;
    }
    profileMessage.textContent = 'Сохраняем…';
    try {
      const metadata = { ...(session.user?.user_metadata || {}), display_name: displayName, contact_email: contactEmail };
      const user = await request('/user', { data: metadata }, session.access_token, 'PUT');
      session.user = user;
      const remember = Boolean(localStorage.getItem(storageKey));
      saveSession(session, remember);
      renderSession();
      profileMessage.textContent = 'Данные сохранены.';
      profileMessage.classList.add('success');
      dispatchAuthChange();
    } catch (error) {
      profileMessage.textContent = error.message;
      profileMessage.classList.remove('success');
    }
  });

  document.querySelector('#auth-logout').addEventListener('click', async () => {
    if (configured() && session?.access_token) {
      await request('/logout', null, session.access_token).catch(() => {});
    }
    session = null;
    waitlistIds = new Set();
    waitlistRows = [];
    saveSession(null, false);
    setMode('login');
    renderSession();
    dispatchAuthChange();
    dispatchWaitlistChange();
  });

  deleteButton.addEventListener('click', async () => {
    if (!session?.access_token) return;
    const confirmed = window.confirm('Удалить аккаунт навсегда? Данные профиля и лист ожидания будут удалены. Это действие нельзя отменить.');
    if (!confirmed) return;
    deleteButton.disabled = true;
    profileMessage.textContent = 'Удаляем аккаунт…';
    profileMessage.classList.remove('success');
    try {
      const response = await fetch(restUrl('/rpc/delete_own_account'), {
        method: 'POST',
        headers: headers(session.access_token),
        body: '{}'
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'Не удалось удалить аккаунт.');
      }
      session = null;
      waitlistIds = new Set();
      waitlistRows = [];
      saveSession(null, false);
      setMode('login');
      renderSession();
      dispatchAuthChange();
      dispatchWaitlistChange();
      if (!isAccountPage && typeof dialog.close === 'function') dialog.close();
    } catch (error) {
      profileMessage.textContent = error.message;
    } finally {
      deleteButton.disabled = false;
    }
  });

  window.SOYUZ_AUTH = {
    addToWaitlist,
    isWaiting: productId => waitlistIds.has(String(productId)),
    getSession: () => session,
    getWaitlistRows: () => waitlistRows.map(row => ({ ...row })),
    markNotificationsRead
  };

  (async () => {
    session = await refreshStoredSession(readSession());
    renderSession();
    dispatchAuthChange();
    await loadWaitlist();
  })();
})();
