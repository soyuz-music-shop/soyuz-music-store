const OWNER = 'soyuz-music-shop';
const REPO = 'soyuz-music-store';
const BRANCH = 'main';
const OVERRIDES_PATH = 'admin-overrides.json';
const SITE_CONTENT_PATH = 'site-content.json';
const AVITO_REPORT_PATH = 'avito-price-report.json';
const AVITO_XML_PRICES_PATH = 'avito-xml-prices.json';
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const SYNC_WORKFLOW_URL = `https://github.com/${OWNER}/${REPO}/actions/workflows/sync-ozon.yml`;
const GITHUB_SESSION_KEY = 'soyuz-admin-github-token';
const GITHUB_PERSISTENT_KEY = 'soyuz-admin-github-token-saved';

let baseProducts = [];
let overrides = emptyOverrides();
let githubToken = '';
let overridesSha = '';
let dirty = false;
let visibleCount = 100;
let editingId = '';
let addingProduct = false;
let selectedExcelFiles = [];
let selectedXmlFile = null;
let siteContent = defaultSiteContent();
let siteContentSha = '';
let aboutDirty = false;
let featuredDirty = false;
let featuredSlides = [];
let avitoReport = null;
let avitoReportVisibleCount = 200;
let sodiumPromise = null;

const el = selector => document.querySelector(selector);
const safe = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[character]));
const normalize = value => String(value || '').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim();
const money = value => `${new Intl.NumberFormat('ru-RU').format(Number(value) || 0)} ₽`;

function splitDisplayText(value) {
  const text = String(value || '').trim();
  const bracket = text.indexOf('(');
  if (bracket <= 0) return { main: text, details: '' };
  return { main: text.slice(0, bracket).trim(), details: text.slice(bracket).trim() };
}

function productDisplayName(product) {
  const artist = splitDisplayText(product.artist);
  const title = splitDisplayText(product.title);
  return {
    artist: artist.main || 'Без артиста',
    title: title.main,
    details: [artist.details, title.details].filter(Boolean).join(' ')
  };
}

function emptyOverrides() {
  return { version: 1, updatedAt: '', items: {}, added: [], deleted: [] };
}

function defaultSiteContent() {
  return {
    about: {
      eyebrow: 'О нас',
      heading: '🖤 Привет!\nМы - SOYUZ MUSIC.',
      paragraphs: []
    }
  };
}

function fillAboutEditor() {
  const about = siteContent.about || defaultSiteContent().about;
  el('#about-editor-eyebrow').value = about.eyebrow || 'О нас';
  el('#about-editor-heading').value = about.heading || '';
  el('#about-editor-paragraphs').value = (about.paragraphs || []).join('\n\n');
  aboutDirty = false;
  el('#save-about').disabled = true;
}

function readAboutEditor() {
  return {
    eyebrow: el('#about-editor-eyebrow').value.trim() || 'О нас',
    heading: el('#about-editor-heading').value.trim(),
    paragraphs: el('#about-editor-paragraphs').value
      .split(/\r?\n\s*\r?\n/)
      .map(value => value.trim())
      .filter(Boolean)
  };
}

function setAboutStatus(text, type = '') {
  const node = el('#about-editor-status');
  node.textContent = text;
  node.className = `field-status ${type}`;
}

function baseMap() {
  return new Map(baseProducts.map(product => [String(product.id), product]));
}

function addedMap() {
  return new Map((overrides.added || []).map(product => [String(product.id), product]));
}

function mergedProducts() {
  const deleted = new Set((overrides.deleted || []).map(String));
  const items = overrides.items || {};
  const result = baseProducts
    .filter(product => !deleted.has(String(product.id)))
    .map(product => ({ ...product, ...(items[String(product.id)] || {}) }));
  const positions = new Map(result.map((product, index) => [String(product.id), index]));
  (overrides.added || []).forEach(product => {
    const id = String(product.id || '');
    if (!id || deleted.has(id)) return;
    if (positions.has(id)) result[positions.get(id)] = product;
    else result.push(product);
  });
  return result;
}

function markDirty() {
  dirty = true;
  el('#unsaved-note').hidden = false;
  el('#publish-changes').disabled = !githubToken;
  renderStats();
}

function clearDirty() {
  dirty = false;
  el('#unsaved-note').hidden = true;
  el('#publish-changes').disabled = true;
}

let toastTimer;
function toast(text) {
  const node = el('#admin-toast');
  node.textContent = text;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 2200);
}

function statusFor(product, hidden = false) {
  const id = String(product.id);
  if (hidden) return { key: 'hidden', label: 'Скрыт' };
  if (addedMap().has(id)) return { key: 'manual', label: 'Добавлен вручную' };
  if (overrides.items?.[id]) return { key: 'changed', label: 'Изменён' };
  return { key: 'ozon', label: 'Ozon' };
}

function renderStats() {
  const products = mergedProducts();
  el('#stat-total').textContent = products.length;
  el('#stat-available').textContent = products.filter(product => product.available !== false).length;
  el('#stat-changed').textContent = Object.keys(overrides.items || {}).length + (overrides.added || []).length;
  el('#stat-hidden').textContent = (overrides.deleted || []).length;
}

function filteredRows() {
  const query = normalize(el('#admin-search').value);
  const category = el('#admin-category').value;
  const requestedState = el('#admin-state').value;
  const deleted = new Set((overrides.deleted || []).map(String));
  const hidden = requestedState === 'hidden';
  const source = hidden ? baseProducts.filter(product => deleted.has(String(product.id))) : mergedProducts();
  return source.filter(product => {
    const state = statusFor(product, hidden).key;
    const text = normalize(`${product.id} ${product.artist} ${product.title}`);
    return (!query || text.includes(query))
      && (category === 'all' || product.category === category)
      && (requestedState === 'visible' || requestedState === 'hidden' || state === requestedState);
  });
}

function productRow(product, hidden = false) {
  const status = statusFor(product, hidden);
  const displayName = productDisplayName(product);
  const image = product.image
    ? `<img src="${safe(product.image)}" alt="" loading="lazy">`
    : '<div class="admin-image-placeholder">Нет фото</div>';
  const action = hidden
    ? `<button type="button" data-restore="${safe(product.id)}">Вернуть</button>`
    : `<button type="button" data-edit="${safe(product.id)}">Изменить</button>
       ${status.key === 'changed' || status.key === 'manual' ? `<button type="button" data-reset="${safe(product.id)}">Сбросить</button>` : ''}
       <button class="danger" type="button" data-hide="${safe(product.id)}">Скрыть</button>`;
  return `<article class="admin-product" data-admin-id="${safe(product.id)}">
    ${image}
    <div><h3>${safe(displayName.artist)}${displayName.title ? ` — ${safe(displayName.title)}` : ''}</h3>${displayName.details ? `<p class="admin-product-name-details">${safe(displayName.details)}</p>` : ''}<p>${safe(product.id)}</p><span class="admin-status ${status.key}">${status.label}</span></div>
    <div><small>Категория</small><p>${safe({ vinyl:'Винил', cd:'CD', tape:'Кассета', book:'Книга', movie:'Фильм' }[product.category] || product.category)}</p></div>
    <div><small>Цена</small><p class="admin-price">${money(product.price)}</p></div>
    <div><small>Остаток</small><p>${Number(product.stock) || 0}</p></div>
    <div class="admin-product-actions">${action}</div>
  </article>`;
}

function renderList() {
  const rows = filteredRows();
  const hidden = el('#admin-state').value === 'hidden';
  el('#product-admin-list').innerHTML = rows.length
    ? rows.slice(0, visibleCount).map(product => productRow(product, hidden)).join('')
    : '<p class="empty-list">По этим условиям товары не найдены.</p>';
  el('#load-more-admin').hidden = visibleCount >= rows.length;
}

function render() {
  renderStats();
  renderList();
  renderAvitoReport();
}

function filteredAvitoUnmatched() {
  const query = normalize(el('#avito-report-search').value);
  const rows = avitoReport?.unmatched || [];
  if (!query) return rows;
  return rows.filter(row => normalize(`${row.id} ${row.artist} ${row.title}`).includes(query));
}

function renderAvitoReport() {
  const summary = el('#avito-report-summary');
  const list = el('#avito-unmatched-list');
  const more = el('#avito-report-more');
  if (!avitoReport) {
    summary.textContent = 'Отчёт появится после первой синхронизации с ключами Avito.';
    list.innerHTML = '';
    more.hidden = true;
    return;
  }
  const updated = avitoReport.updatedAt
    ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(avitoReport.updatedAt))
    : '—';
  const statusText = avitoReport.status === 'success'
    ? `Найдено цен: ${avitoReport.matched || 0}. Не найдено: ${avitoReport.unmatchedCount || 0}. Объявлений Avito: ${avitoReport.listings || 0}.`
    : avitoReport.status === 'xml'
      ? `Цены из XML: найдено ${avitoReport.matched || 0}, не найдено ${avitoReport.unmatchedCount || 0}. Позиций в XML: ${avitoReport.listings || 0}.`
    : avitoReport.status === 'error'
      ? 'Avito был временно недоступен, поэтому сохранены цены Ozon.'
      : 'Ключи Avito ещё не настроены, поэтому сохранены цены Ozon.';
  const rows = filteredAvitoUnmatched();
  summary.textContent = `${statusText} Последняя проверка: ${updated}.`;
  list.innerHTML = rows.length
    ? rows.slice(0, avitoReportVisibleCount).map(row => `<article class="avito-unmatched-row"><strong>${safe(row.id)}</strong><span>${safe([row.artist, row.title].filter(Boolean).join(' — '))}</span><b>${money(row.ozonPrice)}</b></article>`).join('')
    : '<p class="empty-list">По этому запросу позиций нет.</p>';
  more.hidden = avitoReportVisibleCount >= rows.length;
}

async function loadData() {
  el('#product-admin-list').innerHTML = '<p class="loading">Загружаем каталог…</p>';
  try {
    const [productsResponse, overridesResponse, siteContentResponse, avitoReportResponse] = await Promise.all([
      // Revalidate rather than always redownloading ~10 MB on repeated admin visits.
      fetch('products.json', { cache: 'no-cache' }),
      fetch(`${OVERRIDES_PATH}?t=${Date.now()}`, { cache: 'no-store' }),
      fetch(`${SITE_CONTENT_PATH}?t=${Date.now()}`, { cache: 'no-store' }),
      fetch(`${AVITO_REPORT_PATH}?t=${Date.now()}`, { cache: 'no-store' })
    ]);
    if (!productsResponse.ok) throw new Error('Не удалось загрузить products.json');
    baseProducts = await productsResponse.json();
    overrides = overridesResponse.ok ? await overridesResponse.json() : emptyOverrides();
    overrides.items ||= {};
    overrides.added ||= [];
    overrides.deleted ||= [];
    siteContent = siteContentResponse.ok ? await siteContentResponse.json() : defaultSiteContent();
    avitoReport = avitoReportResponse.ok ? await avitoReportResponse.json() : null;
    avitoReportVisibleCount = 200;
    fillAboutEditor();
    fillFeaturedEditor();
    visibleCount = 100;
    render();
  } catch (error) {
    el('#product-admin-list').innerHTML = `<p class="empty-list">${safe(error.message)}</p>`;
  }
}

function githubHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${githubToken}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };
}

async function github(path, options = {}) {
  const response = await fetch(`${API}${path}`, { ...options, headers: { ...githubHeaders(), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `GitHub: HTTP ${response.status}`);
  return data;
}

function setGithubStatus(text, type = '') {
  const node = el('#github-status');
  node.textContent = text;
  node.className = `field-status ${type}`;
}

function setAvitoSecretStatus(text, type = '') {
  const node = el('#avito-secret-status');
  node.textContent = text;
  node.className = `field-status ${type}`;
}

function setGithubConnected(connected) {
  el('#disconnect-github').hidden = !connected;
  el('#github-setup').hidden = connected;
  el('#save-avito-secrets').disabled = !connected;
  el('#connection-badge').textContent = connected ? 'GitHub подключён' : 'Автоматизация GitHub подключена';
  el('#connection-badge').classList.toggle('connected', connected);
}

async function connectGithubToken(token, restored = false) {
  if (!token) {
    setGithubStatus('Вставьте GitHub token.', 'error');
    return false;
  }
  githubToken = token;
  el('#connect-github').disabled = true;
  setGithubStatus(restored ? 'Восстанавливаем подключение…' : 'Проверяем доступ…');
  try {
    const [file, contentFile] = await Promise.all([
      github(`/contents/${OVERRIDES_PATH}?ref=${BRANCH}`),
      github(`/contents/${SITE_CONTENT_PATH}?ref=${BRANCH}`)
    ]);
    overridesSha = file.sha;
    siteContentSha = contentFile.sha;
    el('#github-token').value = '';
    sessionStorage.setItem(GITHUB_SESSION_KEY, token);
    localStorage.setItem(GITHUB_PERSISTENT_KEY, token);
    setGithubConnected(true);
    setGithubStatus('Админка подключена. Повторно вводить токен не нужно.', 'success');
    setAvitoSecretStatus('Можно сохранить или заменить ключи Avito.', 'success');
    el('#publish-changes').disabled = !dirty;
    el('#save-about').disabled = !aboutDirty;
    el('#save-featured').disabled = !featuredDirty;
    el('#upload-excel').disabled = !selectedExcelFiles.length;
    el('#upload-xml-prices').disabled = !selectedXmlFile;
    el('#sync-now').disabled = false;
    el('#sync-status').textContent = 'Готово к запуску. Обычно обновление занимает 1–5 минут.';
    el('#sync-status').className = 'field-status success';
    return true;
  } catch (error) {
    githubToken = '';
    sessionStorage.removeItem(GITHUB_SESSION_KEY);
    localStorage.removeItem(GITHUB_PERSISTENT_KEY);
    setGithubConnected(false);
    setGithubStatus(`Не удалось подключиться: ${error.message}`, 'error');
    return false;
  } finally {
    el('#connect-github').disabled = false;
  }
}

el('#connect-github').addEventListener('click', async () => {
  await connectGithubToken(el('#github-token').value.trim());
});

el('#disconnect-github').addEventListener('click', () => {
  githubToken = '';
  sessionStorage.removeItem(GITHUB_SESSION_KEY);
  localStorage.removeItem(GITHUB_PERSISTENT_KEY);
  setGithubConnected(false);
  el('#publish-changes').disabled = true;
  el('#save-about').disabled = true;
  el('#upload-excel').disabled = true;
  el('#upload-xml-prices').disabled = true;
  el('#sync-now').disabled = false;
  setGithubStatus('Отключено. Сохранённый доступ удалён из браузера.', 'success');
  setAvitoSecretStatus('Подключите GitHub в первом блоке, затем сохраните оба ключа.');
  el('#save-featured').disabled = true;
});

async function encryptGithubSecret(value, publicKey) {
  sodiumPromise ||= import('https://cdn.jsdelivr.net/npm/libsodium-wrappers@0.7.15/+esm')
    .then(module => module.default || module);
  const sodium = await sodiumPromise;
  await sodium.ready;
  const keyBytes = sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL);
  const encrypted = sodium.crypto_box_seal(sodium.from_string(value), keyBytes);
  return sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);
}

async function saveGithubSecret(name, value, publicKey) {
  const encryptedValue = await encryptGithubSecret(value, publicKey.key);
  await github(`/actions/secrets/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify({ encrypted_value: encryptedValue, key_id: publicKey.key_id })
  });
}

el('#save-avito-secrets').addEventListener('click', async () => {
  if (!githubToken) return;
  const clientId = el('#avito-client-id').value.trim();
  const clientSecret = el('#avito-client-secret').value.trim();
  if (!clientId || !clientSecret) {
    setAvitoSecretStatus('Заполните оба поля: Client ID и Client Secret.', 'error');
    return;
  }
  const button = el('#save-avito-secrets');
  button.disabled = true;
  button.textContent = 'Шифруем и сохраняем…';
  setAvitoSecretStatus('Получаем открытый ключ GitHub…');
  try {
    const publicKey = await github('/actions/secrets/public-key');
    await saveGithubSecret('AVITO_CLIENT_ID', clientId, publicKey);
    await saveGithubSecret('AVITO_CLIENT_SECRET', clientSecret, publicKey);
    el('#avito-client-id').value = '';
    el('#avito-client-secret').value = '';
    setAvitoSecretStatus('Ключи Avito сохранены. Нажмите «Обновить сейчас», чтобы применить цены.', 'success');
    toast('Ключи Avito сохранены');
  } catch (error) {
    setAvitoSecretStatus(`Не удалось сохранить: ${error.message}`, 'error');
  } finally {
    button.disabled = !githubToken;
    button.textContent = 'Сохранить ключи Avito';
  }
});

el('#sync-now').addEventListener('click', async () => {
  const button = el('#sync-now');
  const status = el('#sync-status');
  if (!githubToken) {
    window.open(SYNC_WORKFLOW_URL, '_blank', 'noopener');
    status.textContent = 'Страница запуска открыта. Нажмите «Run workflow», затем ещё раз «Run workflow». Автоматические обновления продолжат работать каждый час независимо от этого.';
    status.className = 'field-status success';
    return;
  }
  button.disabled = true;
  button.textContent = 'Запускаем…';
  status.textContent = 'Передаём команду GitHub…';
  status.className = 'field-status';
  try {
    const marker = await github(`/contents/.github/refresh-catalog?ref=${BRANCH}`);
    await github('/contents/.github/refresh-catalog', {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Запустить обновление каталога сейчас',
        content: utf8Base64(`Ручной запуск: ${new Date().toISOString()}\n`),
        sha: marker.sha,
        branch: BRANCH
      })
    });
    status.textContent = 'Обновление запущено. Новые данные появятся на сайте автоматически, обычно через 1–5 минут.';
    status.className = 'field-status success';
    toast('Обновление каталога запущено');
  } catch (error) {
    status.textContent = `Не удалось запустить: ${error.message}`;
    status.className = 'field-status error';
  } finally {
    button.disabled = false;
    button.textContent = 'Обновить сейчас';
  }
});

async function loadAutomationStatus() {
  try {
    const response = await fetch(`${API}/actions/workflows/sync-ozon.yml/runs?per_page=1`, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store'
    });
    if (!response.ok) return;
    const data = await response.json();
    const run = data.workflow_runs?.[0];
    if (!run) return;
    const updated = new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(new Date(run.updated_at));
    const label = run.status === 'completed'
      ? (run.conclusion === 'success' ? 'успешно' : 'с ошибкой')
      : 'выполняется';
    el('#sync-status').textContent = `Последняя проверка: ${updated}, ${label}. Автоматическая проверка выполняется каждый час.`;
    el('#sync-status').className = `field-status ${run.conclusion === 'success' ? 'success' : ''}`;
  } catch (_) {
    // Страница остаётся рабочей, даже если GitHub временно не отдал публичный статус.
  }
}

function utf8Base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

['#about-editor-eyebrow', '#about-editor-heading', '#about-editor-paragraphs'].forEach(selector => {
  el(selector).addEventListener('input', () => {
    aboutDirty = true;
    el('#save-about').disabled = !githubToken;
    setAboutStatus(githubToken ? 'Есть неопубликованные изменения.' : 'Изменения сохранены в форме. Для публикации подключите GitHub в первом блоке.');
  });
});

el('#save-about').addEventListener('click', async () => {
  if (!githubToken || !aboutDirty) return;
  const button = el('#save-about');
  button.disabled = true;
  button.textContent = 'Публикуем…';
  try {
    siteContent = { ...siteContent, about: readAboutEditor() };
    const result = await github(`/contents/${SITE_CONTENT_PATH}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Обновить текст О нас из админки',
        content: utf8Base64(`${JSON.stringify(siteContent, null, 2)}\n`),
        sha: siteContentSha,
        branch: BRANCH
      })
    });
    siteContentSha = result.content.sha;
    aboutDirty = false;
    setAboutStatus('Текст опубликован. На сайте он обновится через 1–2 минуты.', 'success');
    toast('Текст «О нас» опубликован');
  } catch (error) {
    setAboutStatus(`Не удалось опубликовать: ${error.message}`, 'error');
    button.disabled = false;
  } finally {
    button.textContent = 'Опубликовать текст';
  }
});

el('#publish-changes').addEventListener('click', async () => {
  if (!githubToken || !dirty) return;
  const button = el('#publish-changes');
  button.disabled = true;
  button.textContent = 'Публикуем…';
  try {
    overrides.updatedAt = new Date().toISOString();
    const result = await github(`/contents/${OVERRIDES_PATH}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Обновить товары из админки',
        content: utf8Base64(`${JSON.stringify(overrides, null, 2)}\n`),
        sha: overridesSha,
        branch: BRANCH
      })
    });
    overridesSha = result.content.sha;
    clearDirty();
    toast('Изменения опубликованы');
  } catch (error) {
    toast(`Ошибка: ${error.message}`);
    button.disabled = false;
  } finally {
    button.textContent = 'Опубликовать изменения';
  }
});

function findProduct(id) {
  return mergedProducts().find(product => String(product.id) === String(id))
    || baseProducts.find(product => String(product.id) === String(id));
}

function specsToText(specs = {}) {
  return Object.entries(specs).map(([key, value]) => `${key}: ${value}`).join('\n');
}

function parseSpecs(text) {
  return String(text || '').split(/\r?\n/).reduce((result, line) => {
    const separator = line.indexOf(':');
    if (separator > 0) result[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    return result;
  }, {});
}

function openEditor(product = null) {
  addingProduct = !product;
  editingId = product ? String(product.id) : '';
  const current = product || {
    id: `manual-${Date.now()}`, category: 'vinyl', artist: '', title: '', price: 0, oldPrice: 0,
    stock: 0, available: false, year: new Date().getFullYear(), publishedAt: new Date().toISOString().slice(0, 10),
    format: '', detail: '', genre: '', publisher: 'Союз Мьюзик', image: '', images: [], description: '', specs: {}, source: 'manual'
  };
  const form = el('#product-form');
  Object.entries(current).forEach(([key, value]) => {
    const field = form.elements.namedItem(key);
    if (!field) return;
    if (field.type === 'checkbox') field.checked = Boolean(value);
    else if (key === 'images') field.value = (value || []).join('\n');
    else if (key === 'specs') field.value = specsToText(value);
    else field.value = value ?? '';
  });
  form.elements.id.readOnly = !addingProduct;
  el('#editor-title').textContent = addingProduct ? 'Новый товар' : 'Редактирование';
  updateImagePreview();
  el('#editor-dialog').showModal();
}

function updateImagePreview() {
  const url = el('#product-form').elements.image.value.trim();
  const image = el('#editor-image');
  image.hidden = !url;
  el('#editor-image-empty').hidden = Boolean(url);
  if (url) image.src = url;
}

el('#product-form').elements.image.addEventListener('input', updateImagePreview);
el('#editor-close').addEventListener('click', () => el('#editor-dialog').close());
el('#editor-cancel').addEventListener('click', () => el('#editor-dialog').close());
el('#add-product').addEventListener('click', () => openEditor());

el('#product-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  const existing = addingProduct ? {} : (findProduct(editingId) || {});
  const id = String(form.elements.id.value).trim();
  if (!id) return;
  if (addingProduct && (baseMap().has(id) || addedMap().has(id))) {
    toast('Товар с таким артикулом уже существует');
    return;
  }
  const images = form.elements.images.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  const mainImage = form.elements.image.value.trim();
  if (mainImage && !images.includes(mainImage)) images.unshift(mainImage);
  const product = {
    ...existing,
    id,
    category: form.elements.category.value,
    artist: form.elements.artist.value.trim(),
    title: form.elements.title.value.trim(),
    price: Number(form.elements.price.value) || 0,
    oldPrice: Number(form.elements.oldPrice.value) || 0,
    stock: Number(form.elements.stock.value) || 0,
    available: form.elements.available.checked,
    year: Number(form.elements.year.value) || 0,
    publishedAt: form.elements.publishedAt.value,
    format: form.elements.format.value.trim(),
    detail: form.elements.detail.value.trim(),
    genre: form.elements.genre.value.trim(),
    publisher: form.elements.publisher.value.trim(),
    image: mainImage || images[0] || '',
    image2: images[1] || '',
    images,
    description: form.elements.description.value.trim(),
    specs: parseSpecs(form.elements.specs.value),
    source: addingProduct ? 'manual' : (existing.source || 'manual')
  };
  overrides.deleted = overrides.deleted.filter(value => String(value) !== id);
  if (addingProduct || addedMap().has(id)) {
    const index = overrides.added.findIndex(item => String(item.id) === id);
    if (index >= 0) overrides.added[index] = product;
    else overrides.added.push(product);
  } else {
    overrides.items[id] = product;
  }
  markDirty();
  renderList();
  el('#editor-dialog').close();
  toast('Сохранено в черновик');
});

el('#product-admin-list').addEventListener('click', event => {
  const edit = event.target.closest('[data-edit]');
  const hide = event.target.closest('[data-hide]');
  const restore = event.target.closest('[data-restore]');
  const reset = event.target.closest('[data-reset]');
  if (edit) openEditor(findProduct(edit.dataset.edit));
  if (hide) {
    const id = String(hide.dataset.hide);
    if (!window.confirm('Скрыть этот товар с сайта?')) return;
    if (!overrides.deleted.includes(id)) overrides.deleted.push(id);
    markDirty(); render();
  }
  if (restore) {
    const id = String(restore.dataset.restore);
    overrides.deleted = overrides.deleted.filter(value => String(value) !== id);
    markDirty(); render();
  }
  if (reset) {
    const id = String(reset.dataset.reset);
    if (!window.confirm('Убрать ручные изменения и вернуть данные из Ozon?')) return;
    delete overrides.items[id];
    overrides.added = overrides.added.filter(product => String(product.id) !== id);
    overrides.deleted = overrides.deleted.filter(value => String(value) !== id);
    markDirty(); render();
  }
});

['#admin-search', '#admin-category', '#admin-state'].forEach(selector => {
  el(selector).addEventListener(selector === '#admin-search' ? 'input' : 'change', () => {
    visibleCount = 100;
    renderList();
  });
});
el('#load-more-admin').addEventListener('click', () => { visibleCount += 100; renderList(); });
el('#refresh-data').addEventListener('click', loadData);
el('#avito-report-search').addEventListener('input', () => {
  avitoReportVisibleCount = 200;
  renderAvitoReport();
});
el('#avito-report-more').addEventListener('click', () => {
  avitoReportVisibleCount += 200;
  renderAvitoReport();
});

function setXmlFile(file) {
  const valid = file && /\.xml(?:\.gz)?$/i.test(file.name);
  selectedXmlFile = valid ? file : null;
  el('#xml-file-info').innerHTML = selectedXmlFile
    ? `<span>${safe(selectedXmlFile.name)} · ${(selectedXmlFile.size / 1024 / 1024).toFixed(1)} МБ</span>`
    : '<span>Файл не выбран</span>';
  el('#upload-xml-prices').disabled = !githubToken || !selectedXmlFile;
  if (file && !valid) {
    el('#xml-status').textContent = 'Выберите файл с расширением .xml или .xml.gz.';
    el('#xml-status').className = 'field-status error';
  }
}

async function xmlTextFromFile(file) {
  if (!file.name.toLowerCase().endsWith('.gz')) return file.text();
  if (!('DecompressionStream' in window)) {
    throw new Error('Этот браузер не умеет распаковывать .gz. Распакуйте файл и загрузите обычный .xml.');
  }
  const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

function directChildText(node, name) {
  const child = [...node.children].find(item => item.localName === name);
  return child?.textContent?.trim() || '';
}

async function parseAvitoXml(file) {
  const source = await xmlTextFromFile(file);
  const documentNode = new DOMParser().parseFromString(source, 'application/xml');
  const parserError = documentNode.querySelector('parsererror');
  if (parserError) throw new Error('Файл не удалось прочитать как XML. Проверьте, что выгрузка не повреждена.');
  const prices = [...documentNode.getElementsByTagName('Ad')].map(ad => ({
    offerId: directChildText(ad, 'Id'),
    avitoId: directChildText(ad, 'AvitoId'),
    title: directChildText(ad, 'Title'),
    price: Number(directChildText(ad, 'Price').replace(/\s/g, '').replace(',', '.')) || 0
  })).filter(item => item.offerId && item.price > 0);
  if (!prices.length) throw new Error('В XML не найдено ни одной позиции с Id и Price.');
  return {
    version: 1,
    source: 'avito-xml',
    originalName: file.name,
    uploadedAt: new Date().toISOString(),
    count: prices.length,
    prices
  };
}

async function saveAvitoXmlPrices(payload) {
  let current = null;
  try {
    current = await github(`/contents/${AVITO_XML_PRICES_PATH}?ref=${BRANCH}`);
  } catch (error) {
    if (!/404|Not Found/i.test(error.message)) throw error;
  }
  const body = {
    message: 'Обновить цены Avito из XML',
    content: utf8Base64(`${JSON.stringify(payload)}\n`),
    branch: BRANCH
  };
  if (current?.sha) body.sha = current.sha;
  await github(`/contents/${AVITO_XML_PRICES_PATH}`, {
    method: 'PUT',
    body: JSON.stringify(body)
  });
}

el('#xml-file').addEventListener('change', event => setXmlFile(event.target.files[0]));
['dragenter', 'dragover'].forEach(type => el('#xml-drop-zone').addEventListener(type, event => {
  event.preventDefault();
  el('#xml-drop-zone').classList.add('dragging');
}));
['dragleave', 'drop'].forEach(type => el('#xml-drop-zone').addEventListener(type, event => {
  event.preventDefault();
  el('#xml-drop-zone').classList.remove('dragging');
}));
el('#xml-drop-zone').addEventListener('drop', event => setXmlFile(event.dataTransfer.files[0]));

el('#upload-xml-prices').addEventListener('click', async () => {
  if (!githubToken || !selectedXmlFile) return;
  const button = el('#upload-xml-prices');
  const status = el('#xml-status');
  button.disabled = true;
  button.textContent = 'Читаем XML…';
  status.textContent = 'Распаковываем и проверяем файл…';
  status.className = 'field-status';
  try {
    const payload = await parseAvitoXml(selectedXmlFile);
    status.textContent = `Найдено ${payload.count} цен. Сохраняем и запускаем обновление каталога…`;
    button.textContent = 'Сохраняем…';
    await saveAvitoXmlPrices(payload);
    status.textContent = `Загружено ${payload.count} цен. Каталог обновляется автоматически; обычно это занимает 1–5 минут.`;
    status.className = 'field-status success';
    selectedXmlFile = null;
    el('#xml-file').value = '';
    setXmlFile(null);
    toast('Цены из XML отправлены на обновление');
  } catch (error) {
    status.textContent = `Не удалось загрузить XML: ${error.message}`;
    status.className = 'field-status error';
  } finally {
    button.textContent = 'Загрузить цены из XML';
    button.disabled = !githubToken || !selectedXmlFile;
  }
});

function setExcelFiles(files) {
  selectedExcelFiles = [...files].filter(file => file.name.toLowerCase().endsWith('.xlsx'));
  el('#excel-file-list').innerHTML = selectedExcelFiles.length
    ? selectedExcelFiles.map(file => `<span>${safe(file.name)} · ${(file.size / 1024 / 1024).toFixed(1)} МБ</span>`).join('')
    : '<span>Файлы не выбраны</span>';
  el('#upload-excel').disabled = !githubToken || !selectedExcelFiles.length;
}

el('#excel-files').addEventListener('change', event => setExcelFiles(event.target.files));
['dragenter', 'dragover'].forEach(type => el('#drop-zone').addEventListener(type, event => { event.preventDefault(); el('#drop-zone').classList.add('dragging'); }));
['dragleave', 'drop'].forEach(type => el('#drop-zone').addEventListener(type, event => { event.preventDefault(); el('#drop-zone').classList.remove('dragging'); }));
el('#drop-zone').addEventListener('drop', event => setExcelFiles(event.dataTransfer.files));

async function fileBase64(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  return String(dataUrl).split(',')[1];
}

async function commitExcelFiles(files) {
  const ref = await github(`/git/ref/heads/${BRANCH}`);
  const headSha = ref.object.sha;
  const commit = await github(`/git/commits/${headSha}`);
  const treeEntries = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name}: размер больше 25 МБ`);
    el('#excel-status').textContent = `Загружаем ${index + 1} из ${files.length}: ${file.name}`;
    const blob = await github('/git/blobs', {
      method: 'POST',
      body: JSON.stringify({ content: await fileBase64(file), encoding: 'base64' })
    });
    treeEntries.push({
      path: `imports/ozon-${Date.now()}-${index + 1}.xlsx`,
      mode: '100644',
      type: 'blob',
      sha: blob.sha
    });
  }
  const tree = await github('/git/trees', {
    method: 'POST',
    body: JSON.stringify({ base_tree: commit.tree.sha, tree: treeEntries })
  });
  const newCommit = await github('/git/commits', {
    method: 'POST',
    body: JSON.stringify({
      message: 'Загрузить товары из Excel Ozon',
      tree: tree.sha,
      parents: [headSha]
    })
  });
  await github(`/git/refs/heads/${BRANCH}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: newCommit.sha, force: false })
  });
}

el('#upload-excel').addEventListener('click', async () => {
  if (!githubToken || !selectedExcelFiles.length) return;
  const button = el('#upload-excel');
  button.disabled = true;
  button.textContent = 'Загружаем…';
  const status = el('#excel-status');
  status.className = 'field-status';
  try {
    await commitExcelFiles(selectedExcelFiles);
    status.textContent = 'Файлы загружены. GitHub сейчас проверяет Excel и обновляет сайт; обычно это занимает 1–3 минуты.';
    status.classList.add('success');
    selectedExcelFiles = [];
    el('#excel-files').value = '';
    setExcelFiles([]);
    toast('Excel отправлен на обработку');
  } catch (error) {
    status.textContent = `Не удалось загрузить Excel: ${error.message}`;
    status.classList.add('error');
  } finally {
    button.textContent = 'Загрузить и обновить каталог';
    button.disabled = !githubToken || !selectedExcelFiles.length;
  }
});

window.addEventListener('beforeunload', event => {
  if (!dirty && !aboutDirty && !featuredDirty) return;
  event.preventDefault();
  event.returnValue = '';
});

// --- V42: New release carousel: text + per-product PNG, GitHub commit ---
const FEATURED_LIMIT = 8;
const FEATURED_MAX_PNG_BYTES = 8 * 1024 * 1024;
const featuredConfigDefault = () => ({ enabled: false, title: 'Новинки', text: 'Свежие поступления', autoplay: false, intervalSeconds: 5, slides: [] });

function fillFeaturedEditor() {
  const config = { ...featuredConfigDefault(), ...(siteContent.newReleases || {}) };
  featuredSlides.forEach(slide => { if (slide.previewUrl) URL.revokeObjectURL(slide.previewUrl); });
  featuredSlides = (config.slides || []).slice(0, FEATURED_LIMIT).map(slide => ({ productId: String(slide.productId || ''), image: String(slide.image || ''), optimizedImage: String(slide.optimizedImage || ''), pendingFile: null, previewUrl: null }));
  el('#featured-enabled').checked = Boolean(config.enabled);
  el('#featured-title').value = config.title || 'Новинки';
  el('#featured-text').value = config.text ?? config.subtitle ?? '';
  el('#featured-autoplay').checked = Boolean(config.autoplay);
  el('#featured-interval').value = String(config.intervalSeconds || 5);
  featuredDirty = false;
  el('#save-featured').disabled = true;
  setFeaturedStatus('Для публикации изменений подключите GitHub в первом блоке.');
  renderFeaturedSelected();
}

function setFeaturedStatus(message, type = '') {
  const node = el('#featured-status');
  node.textContent = message;
  node.className = `field-status ${type}`;
}

function markFeaturedDirty() {
  featuredDirty = true;
  el('#save-featured').disabled = !githubToken;
  setFeaturedStatus(githubToken ? 'Есть неопубликованные изменения.' : 'Изменения не опубликованы. Подключите GitHub.', '');
}

function featuredProductName(id) {
  const product = findProduct(id);
  if (!product) return { artist: 'Товар не найден', title: id };
  return productDisplayName(product);
}

function renderFeaturedSelected() {
  el('#featured-count').textContent = `${featuredSlides.length} из ${FEATURED_LIMIT}`;
  const list = el('#featured-admin-products');
  if (!featuredSlides.length) { list.innerHTML = '<p class="field-status">Добавьте релизы из каталога. Каждый релиз требует отдельный PNG.</p>'; return; }
  list.innerHTML = featuredSlides.map((slide, i) => {
    const name = featuredProductName(slide.productId);
    const image = slide.previewUrl || slide.image;
    const preview = image ? `<img src="${safe(image)}" alt="" loading="lazy">` : '<span class="featured-no-image">Нет PNG</span>';
    return `<div class="featured-selected-product" data-featured-index="${i}">
      <span class="featured-position">${i + 1}</span>
      <div class="featured-upload-preview">${preview}</div>
      <span class="featured-selected-name"><strong>${safe(name.artist)}</strong><small>${safe(name.title)}</small><small>ID Ozon: ${safe(slide.productId)}</small></span>
      <label class="featured-upload-button">${image ? 'Заменить PNG' : 'Загрузить PNG'}<input type="file" accept=".png,image/png" data-featured-upload="${i}"></label>
      <div class="featured-reorder"><button type="button" data-featured-up="${i}" aria-label="Выше" title="Выше" ${i===0?'disabled':''}>↑</button><button type="button" data-featured-down="${i}" aria-label="Ниже" title="Ниже" ${i===featuredSlides.length-1?'disabled':''}>↓</button><button type="button" data-featured-remove="${i}" aria-label="Удалить" title="Удалить">×</button></div>
    </div>`;
  }).join('');
}

function renderFeaturedSearch() {
  const query = normalize(el('#featured-search').value);
  const list = el('#featured-search-results');
  if (!query) { list.hidden = true; list.innerHTML = ''; return; }
  const selected = new Set(featuredSlides.map(slide => slide.productId));
  const tokens = query.split(/\s+/).filter(Boolean);
  const matches = mergedProducts().filter(product => !selected.has(String(product.id)) && tokens.every(token => normalize(`${product.id} ${product.artist} ${product.title}`).includes(token))).slice(0, 14);
  list.hidden = false;
  list.innerHTML = matches.length ? matches.map(product => {
    const name = productDisplayName(product);
    return `<button class="featured-search-hit" type="button" data-featured-add="${safe(product.id)}"><img src="${safe(product.image || '')}" alt="" loading="lazy"><span><strong>${safe(name.artist)}</strong><small>${safe(name.title)} · ${safe(product.id)}</small></span></button>`;
  }).join('') : '<p class="field-status">Не найдено. Попробуйте другой запрос.</p>';
}

['#featured-enabled', '#featured-title', '#featured-text', '#featured-autoplay', '#featured-interval'].forEach(selector => {
  el(selector).addEventListener(selector === '#featured-enabled' || selector === '#featured-autoplay' || selector === '#featured-interval' ? 'change' : 'input', markFeaturedDirty);
});
el('#featured-search').addEventListener('input', renderFeaturedSearch);
el('#featured-search-results').addEventListener('click', event => {
  const add = event.target.closest('[data-featured-add]');
  if (!add) return;
  if (featuredSlides.length >= FEATURED_LIMIT) { setFeaturedStatus(`Не более ${FEATURED_LIMIT} релизов.`, 'error'); return; }
  featuredSlides.push({ productId: String(add.dataset.featuredAdd), image: '', optimizedImage: '', pendingFile: null, previewUrl: null });
  el('#featured-search').value = '';
  renderFeaturedSearch(); renderFeaturedSelected(); markFeaturedDirty();
});
el('#featured-admin-products').addEventListener('click', event => {
  const remove = event.target.closest('[data-featured-remove]');
  const up = event.target.closest('[data-featured-up]');
  const down = event.target.closest('[data-featured-down]');
  if (remove) {
    const slide = featuredSlides.splice(Number(remove.dataset.featuredRemove), 1)[0];
    if (slide?.previewUrl) URL.revokeObjectURL(slide.previewUrl);
  } else if (up || down) {
    const i = Number((up || down).dataset[up ? 'featuredUp' : 'featuredDown']);
    const j = i + (up ? -1 : 1);
    if (j < 0 || j >= featuredSlides.length) return;
    [featuredSlides[i], featuredSlides[j]] = [featuredSlides[j], featuredSlides[i]];
  } else return;
  renderFeaturedSelected(); markFeaturedDirty();
});
el('#featured-admin-products').addEventListener('change', async event => {
  const input = event.target.closest('[data-featured-upload]');
  if (!input || !input.files?.length) return;
  const index = Number(input.dataset.featuredUpload);
  const slide = featuredSlides[index];
  if (!slide) return;
  const file = input.files[0];
  if (!/\.png$/i.test(file.name) || (file.type && file.type !== 'image/png')) { setFeaturedStatus('Можно загрузить только PNG.', 'error'); input.value = ''; return; }
  if (file.size > FEATURED_MAX_PNG_BYTES) { setFeaturedStatus('PNG должен быть не больше 8 МБ.', 'error'); input.value = ''; return; }
  const magic = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (magic.join(',') !== '137,80,78,71,13,10,26,10') { setFeaturedStatus('Файл не является PNG.', 'error'); input.value = ''; return; }
  if (slide.previewUrl) URL.revokeObjectURL(slide.previewUrl);
  slide.pendingFile = file;
  // A newly selected PNG invalidates the old lightweight image until publication.
  slide.optimizedImage = '';
  slide.previewUrl = URL.createObjectURL(file);
  renderFeaturedSelected(); markFeaturedDirty();
});

async function optimizedFeaturedWebp(file) {
  // Keep the original PNG, generate a smaller transparent WebP for display.
  // Maximum 1200px per side maintains sharpness on high-DPI screens.
  if (typeof document.createElement('canvas').toBlob !== 'function') return null;
  let image, objectUrl;
  try {
    if (typeof createImageBitmap === 'function') image = await createImageBitmap(file);
    else {
      objectUrl = URL.createObjectURL(file);
      image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = objectUrl; });
    }
    const width = image.width || image.naturalWidth;
    const height = image.height || image.naturalHeight;
    if (!width || !height) return null;
    const ratio = Math.min(1, 1200 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return null;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const webp = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .91));
    return webp?.type === 'image/webp' && webp.size < file.size ? webp : null;
  } catch (error) {
    console.warn('Облегчённая копия PNG не создана; оригинал сохранится.', error);
    return null;
  } finally {
    if (typeof image?.close === 'function') image.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

async function commitFeaturedImageAndConfig(config) {
  // Original PNG + optimized display version + config are committed atomically.
  const head = await github(`/git/ref/heads/${BRANCH}`);
  const parentSha = head.object.sha;
  const parent = await github(`/git/commits/${parentSha}`);
  const updates = [];
  const nonce = Date.now();
  for (let i=0; i<featuredSlides.length; i++) {
    const slide = featuredSlides[i];
    if (!slide.pendingFile) continue;
    setFeaturedStatus(`Загружаем PNG ${i+1} из ${featuredSlides.length}…`);
    const filePath = `new-release-images/${slide.productId}-${nonce}-${i}.png`;
    const blob = await github('/git/blobs', { method: 'POST', body: JSON.stringify({ content: await fileBase64(slide.pendingFile), encoding: 'base64' }) });
    updates.push({ path: filePath, mode: '100644', type: 'blob', sha: blob.sha });
    config.slides[i].image = filePath;
    setFeaturedStatus(`Оптимизируем PNG ${i+1} из ${featuredSlides.length}…`);
    const optimized = await optimizedFeaturedWebp(slide.pendingFile);
    if (optimized) {
      const optimizedPath = filePath.replace(/\.png$/, '.webp');
      const optimizedBlob = await github('/git/blobs', { method: 'POST', body: JSON.stringify({ content: await fileBase64(optimized), encoding: 'base64' }) });
      updates.push({ path: optimizedPath, mode: '100644', type: 'blob', sha: optimizedBlob.sha });
      config.slides[i].optimizedImage = optimizedPath;
    } else {
      // No WebP support: display the original PNG without cropping.
      delete config.slides[i].optimizedImage;
    }
  }
  const payload = { ...siteContent, newReleases: config };
  const contentBlob = await github('/git/blobs', { method: 'POST', body: JSON.stringify({ content: utf8Base64(`${JSON.stringify(payload,null,2)}\n`), encoding: 'base64' }) });
  updates.push({ path: SITE_CONTENT_PATH, mode: '100644', type: 'blob', sha: contentBlob.sha });
  const tree = await github('/git/trees', {method:'POST',body:JSON.stringify({base_tree:parent.tree.sha,tree:updates})});
  const commit = await github('/git/commits',{method:'POST',body:JSON.stringify({message:'Обновить карусель Новинки и PNG',tree:tree.sha,parents:[parentSha]})});
  await github(`/git/refs/heads/${BRANCH}`, {method:'PATCH',body:JSON.stringify({sha:commit.sha,force:false})});
  return { payload, sha: contentBlob.sha };
}

el('#save-featured').addEventListener('click', async () => {
  if (!githubToken || !featuredDirty) return;
  const enabled = el('#featured-enabled').checked;
  const title = el('#featured-title').value.trim();
  if (!title) { setFeaturedStatus('Введите заголовок шапки.', 'error'); return; }
  const missing = featuredSlides.find(slide => !slide.pendingFile && !slide.image);
  if (enabled && (!featuredSlides.length || missing)) { setFeaturedStatus('Чтобы включить карусель, выберите релизы и загрузите PNG для каждого.', 'error'); return; }
  const missingProduct = featuredSlides.find(slide => !findProduct(slide.productId));
  if (enabled && missingProduct) { setFeaturedStatus(`Товар ${missingProduct.productId} больше не найден в каталоге.`, 'error'); return; }
  const config = { enabled, title, text: el('#featured-text').value.trim(), autoplay: el('#featured-autoplay').checked, intervalSeconds: Number(el('#featured-interval').value)||5,
    slides: featuredSlides.map(slide => ({productId: slide.productId, image: slide.image, ...(slide.optimizedImage ? {optimizedImage: slide.optimizedImage} : {})})) };
  const button = el('#save-featured'); button.disabled = true; button.textContent = 'Публикуем…';
  try {
    const result = await commitFeaturedImageAndConfig(config);
    siteContent = result.payload;
    siteContentSha = result.sha;
    fillFeaturedEditor();
    setFeaturedStatus('Шапка опубликована. После обновления GitHub Pages изменения появятся на сайте.', 'success');
    toast('Шапка «Новинки» опубликована');
  } catch (error) {
    setFeaturedStatus(`Не удалось опубликовать: ${error.message}`, 'error');
    button.disabled = false;
  } finally { button.textContent = 'Опубликовать карусель'; }
});

loadData();
loadAutomationStatus();
const savedGithubToken = localStorage.getItem(GITHUB_PERSISTENT_KEY) || sessionStorage.getItem(GITHUB_SESSION_KEY);
if (savedGithubToken) connectGithubToken(savedGithubToken, true);
