const OWNER = 'varvara9911';
const REPO = 'soyuz-music-store';
const BRANCH = 'main';
const OVERRIDES_PATH = 'admin-overrides.json';
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const SYNC_WORKFLOW_URL = `https://github.com/${OWNER}/${REPO}/actions/workflows/sync-ozon.yml`;

let baseProducts = [];
let overrides = emptyOverrides();
let githubToken = '';
let overridesSha = '';
let dirty = false;
let visibleCount = 100;
let editingId = '';
let addingProduct = false;
let selectedExcelFiles = [];

const el = selector => document.querySelector(selector);
const safe = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[character]));
const normalize = value => String(value || '').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim();
const money = value => `${new Intl.NumberFormat('ru-RU').format(Number(value) || 0)} ₽`;

function emptyOverrides() {
  return { version: 1, updatedAt: '', items: {}, added: [], deleted: [] };
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
    <div><h3>${safe(product.artist || 'Без артиста')} — ${safe(product.title || 'Без названия')}</h3><p>${safe(product.id)}</p><span class="admin-status ${status.key}">${status.label}</span></div>
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
}

async function loadData() {
  el('#product-admin-list').innerHTML = '<p class="loading">Загружаем каталог…</p>';
  try {
    const [productsResponse, overridesResponse] = await Promise.all([
      fetch(`products.json?t=${Date.now()}`, { cache: 'no-store' }),
      fetch(`${OVERRIDES_PATH}?t=${Date.now()}`, { cache: 'no-store' })
    ]);
    if (!productsResponse.ok) throw new Error('Не удалось загрузить products.json');
    baseProducts = await productsResponse.json();
    overrides = overridesResponse.ok ? await overridesResponse.json() : emptyOverrides();
    overrides.items ||= {};
    overrides.added ||= [];
    overrides.deleted ||= [];
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

el('#connect-github').addEventListener('click', async () => {
  const token = el('#github-token').value.trim();
  if (!token) {
    setGithubStatus('Вставьте GitHub token.', 'error');
    return;
  }
  githubToken = token;
  el('#connect-github').disabled = true;
  setGithubStatus('Проверяем доступ…');
  try {
    const file = await github(`/contents/${OVERRIDES_PATH}?ref=${BRANCH}`);
    overridesSha = file.sha;
    el('#github-token').value = '';
    el('#connection-badge').textContent = 'GitHub подключён';
    el('#connection-badge').classList.add('connected');
    setGithubStatus('Подключено. Токен хранится только до закрытия вкладки.', 'success');
    el('#publish-changes').disabled = !dirty;
    el('#upload-excel').disabled = !selectedExcelFiles.length;
    el('#sync-now').disabled = false;
    el('#sync-status').textContent = 'Готово к запуску. Обычно обновление занимает 1–5 минут.';
    el('#sync-status').className = 'field-status success';
  } catch (error) {
    githubToken = '';
    setGithubStatus(`Не удалось подключиться: ${error.message}`, 'error');
  } finally {
    el('#connect-github').disabled = false;
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
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

loadData();
loadAutomationStatus();
