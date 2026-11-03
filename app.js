let products = [];
let artistNames = [];
let waitlistRows = [];

const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
const currentTheme = () => document.documentElement.dataset.theme || (themeMedia.matches ? 'dark' : 'light');

function renderThemeToggle() {
  const dark = currentTheme() === 'dark';
  const button = document.querySelector('#theme-toggle');
  button.setAttribute('aria-label', dark ? 'Включить светлую тему' : 'Включить тёмную тему');
  button.setAttribute('aria-pressed', String(dark));
  button.dataset.theme = dark ? 'dark' : 'light';
  button.title = dark ? 'Светлая тема' : 'Тёмная тема';
  document.querySelector('#theme-color').content = dark ? '#11100e' : '#f6f3ed';
}

window.addEventListener('pageshow', () => {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  resetCategoryToAll();
  requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
});

const state = {
  search: '',
  category: 'all',
  artist: '',
  stockOnly: false,
  maxPrice: 100000,
  sort: 'new',
  favoritesOnly: false,
  visibleCount: 48,
  favorites: new Set(JSON.parse(localStorage.getItem('soyuz-favorites') || '[]')),
  cart: JSON.parse(localStorage.getItem('soyuz-cart') || '[]')
};

const el = (selector) => document.querySelector(selector);
const all = (selector) => [...document.querySelectorAll(selector)];
const money = (value) => new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
const normalizeSearchText = value => String(value ?? '')
  .toLocaleLowerCase('ru')
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, ' ')
  .trim();
const safe = (value) => String(value ?? '').replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));

function splitProductTitle(value) {
  const text = String(value || '').trim();
  const bracket = text.indexOf('(');
  if (bracket <= 0) return { main: text, details: '' };
  return {
    main: text.slice(0, bracket).trim(),
    details: text.slice(bracket).trim()
  };
}

const artistGroup = artist => {
  const firstLetter = normalizeSearchText(artist).charAt(0).toLocaleUpperCase('ru') || '#';
  return /[A-ZА-Я0-9]/.test(firstLetter) ? firstLetter : '#';
};

const artistNameScore = artist => {
  const letters = String(artist).replace(/[^a-zа-яё]/gi, '');
  const hasUpper = /[A-ZА-ЯЁ]/.test(letters);
  const hasLower = /[a-zа-яё]/.test(letters);
  return (hasUpper && hasLower ? 10 : 0) + Math.min(String(artist).length, 100) / 1000;
};

function renderArtistList(query = '') {
  const normalizedQuery = normalizeSearchText(query);
  const groups = new Map();
  artistNames
    .filter(artist => !normalizedQuery || normalizeSearchText(artist).includes(normalizedQuery))
    .forEach(artist => {
      const letter = artistGroup(artist);
      if (!groups.has(letter)) groups.set(letter, []);
      groups.get(letter).push(artist);
    });
  const rank = letter => /[А-Я]/.test(letter) ? 0 : /[A-Z]/.test(letter) ? 1 : /[0-9]/.test(letter) ? 2 : 3;
  const orderedGroups = [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b, 'ru'));
  el('#artist-dropdown').innerHTML = orderedGroups.length
    ? orderedGroups.map(([letter, names]) => `<div class="artist-letter">${safe(letter)}</div>${names.map(artist => `<button class="artist-option" type="button" role="option" data-artist="${safe(artist)}">${safe(artist)}</button>`).join('')}`).join('')
    : '<p class="artist-empty">Исполнители не найдены</p>';
}

function setArtistDropdown(open) {
  el('#artist-dropdown').hidden = !open;
  el('#artist-filter').setAttribute('aria-expanded', String(open));
}

function descriptionHtml(value) {
  const raw = String(value || '').trim();
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const heading = raw.match(/трек\s*-?\s*лист\s*:?\s*/i);
  if (!heading) return `<p class="detail-description">${safe(text)}</p>`;

  const intro = raw.slice(0, heading.index).replace(/\s+/g, ' ').trim();
  const trackText = raw.slice(heading.index + heading[0].length).trim();
  let tracks = trackText.split(/\n+/).map(line => line.trim()).filter(Boolean);
  if (tracks.length < 2) {
    const markers = [...trackText.matchAll(/(?:^|\s)((?:[A-ZА-Я]\s*)?\d{1,3})[.)]\s*/gi)];
    tracks = markers.map((marker, index) => {
      const start = marker.index + marker[0].length;
      const end = index + 1 < markers.length ? markers[index + 1].index : trackText.length;
      const title = trackText.slice(start, end).trim();
      return title ? `${marker[1]}. ${title}` : '';
    }).filter(Boolean);
  }
  if (!tracks.length) return `<p class="detail-description">${safe(text)}</p>`;

  return `${intro ? `<p class="detail-description">${safe(intro)}</p>` : ''}
    <div class="tracklist-block">
      <strong>Треклист</strong>
      <div class="tracklist-lines">${tracks.map(track => `<div>${safe(track)}</div>`).join('')}</div>
    </div>`;
}
const categoryName = { vinyl: 'Винил', cd: 'CD', tape: 'Кассета', book: 'Книга', movie: 'Фильм' };
const categoryColor = {
  vinyl: 'linear-gradient(135deg,#111,#6b5018)',
  cd: 'linear-gradient(135deg,#1d2430,#5f6470)',
  tape: 'linear-gradient(135deg,#111,#b18c30)',
  book: 'linear-gradient(135deg,#171613,#876b32)',
  movie: 'linear-gradient(135deg,#251b1b,#7a2020)'
};

function filteredProducts() {
  const queryTokens = normalizeSearchText(state.search).split(/\s+/).filter(Boolean);
  const artistQuery = normalizeSearchText(state.artist);
  const result = products.filter(product => {
    const searchable = normalizeSearchText([
      product.artist,
      product.title,
      product.format,
      product.detail,
      product.genre,
      product.publisher,
      product.description,
      ...Object.entries(product.specs || {}).flat()
    ].join(' '));
    return (!queryTokens.length || queryTokens.every(token => searchable.includes(token)))
      && (state.category === 'all' || product.category === state.category)
      && (!artistQuery || normalizeSearchText(product.artist).includes(artistQuery))
      && (!state.stockOnly || product.available !== false)
      && product.price <= state.maxPrice
      && (!state.favoritesOnly || state.favorites.has(product.id));
  });
  result.sort((a, b) => {
    if (state.sort === 'price-asc') return a.price - b.price;
    if (state.sort === 'price-desc') return b.price - a.price;
    if (state.sort === 'title') return `${a.artist}${a.title}`.localeCompare(`${b.artist}${b.title}`, 'ru');
    return String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')) || (b.year || 0) - (a.year || 0);
  });
  return result;
}

function productCard(product) {
  const favorite = state.favorites.has(product.id);
  const available = product.available !== false;
  const waiting = window.SOYUZ_AUTH?.isWaiting(product.id) || false;
  const cover = product.image
    ? `<img class="cover-image" src="${safe(product.image)}" alt="" loading="lazy" decoding="async">`
    : '';
  const carrierLabel = { vinyl: 'LP', cd: 'CD', tape: 'MC', book: 'Книга', movie: 'Фильм' }[product.category] || product.format || product.detail || '';
  const title = splitProductTitle(product.title);
  return `<article class="product-card" data-category="${safe(product.category)}" data-product="${safe(product.id)}" tabindex="0" aria-label="Подробнее: ${safe(product.artist)} — ${safe(product.title)}">
    <div class="cover ${product.image ? 'has-image' : ''}" style="--cover:${categoryColor[product.category]}" data-mark="${safe(product.artist)}">
      ${cover}
      ${product.badge ? `<span class="badge">${safe(product.badge)}</span>` : ''}
    </div>
    <div class="product-info">
      <div class="product-title-row"><div class="product-title-copy"><h3>${safe(product.artist)}</h3>${title.main ? `<h4>${safe(title.main)}</h4>` : ''}</div><button class="favorite-button ${favorite ? 'active' : ''}" type="button" data-favorite="${safe(product.id)}" aria-label="${favorite ? 'Убрать из избранного' : 'Добавить в избранное'}">${favorite ? '♥' : '♡'}</button></div>
      ${title.details ? `<p class="album-details">${safe(title.details)}</p>` : '<p class="album-details empty" aria-hidden="true"></p>'}
      ${carrierLabel ? `<div class="chips"><span>${safe(carrierLabel)}</span></div>` : ''}
      <div class="price-row"><span class="price">${money(product.price)}</span><span class="stock ${available ? '' : 'out'}">${available ? '✓ В продаже' : 'Нет в наличии'}</span></div>
      <button class="buy-button" type="button" ${available ? `data-buy="${safe(product.id)}"` : `data-waitlist="${safe(product.id)}"${waiting ? ' data-waiting="true" aria-pressed="true"' : ''}`}>${available ? 'В корзину' : (waiting ? '✓ В листе ожидания' : 'Сообщить о поступлении')}</button>
    </div>
  </article>`;
}

let openProductId = null;

function openProduct(product) {
  if (!product) return;
  openProductId = product.id;
  const favorite = state.favorites.has(product.id);
  const available = product.available !== false;
  const waiting = window.SOYUZ_AUTH?.isWaiting(product.id) || false;
  const images = (product.images?.length ? product.images : [product.image]).filter(Boolean);
  const specs = Object.entries(product.specs || {});
  const description = descriptionHtml(product.description);
  const defaultTab = description ? 'description' : 'specs';
  el('#product-detail').innerHTML = `
    <div class="detail-gallery">
      ${images[0] ? `<img class="detail-main-image" id="detail-main-image" src="${safe(images[0])}" alt="${safe(product.title)}">` : '<div class="detail-image-placeholder">Нет изображения</div>'}
      ${images.length > 1 ? `<div class="detail-thumbnails">${images.slice(0, 10).map((image, index) => `<button type="button" data-detail-image="${safe(image)}" aria-label="Показать фото ${index + 1}"><img src="${safe(image)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
    </div>
    <div class="detail-content">
      <p class="eyebrow">${safe(categoryName[product.category] || 'Товар')}</p>
      <h2>${safe(product.artist)}</h2>
      <p class="detail-title">${safe(product.title)}</p>
      <div class="detail-price-row"><strong>${money(product.price)}</strong><span class="stock ${available ? '' : 'out'}">${available ? '✓ В продаже' : 'Нет в наличии'}</span></div>
      <div class="detail-actions">
        <button class="buy-button" type="button" ${available ? `data-buy="${safe(product.id)}"` : `data-waitlist="${safe(product.id)}"${waiting ? ' data-waiting="true" aria-pressed="true"' : ''}`}>${available ? 'В корзину' : (waiting ? '✓ В листе ожидания' : 'Сообщить о поступлении')}</button>
        <button class="detail-favorite ${favorite ? 'active' : ''}" type="button" data-favorite="${safe(product.id)}">${favorite ? '♥ В избранном' : '♡ В избранное'}</button>
      </div>
      <div class="detail-tabs" role="tablist" aria-label="Информация о товаре">
        <button class="detail-tab ${defaultTab === 'description' ? 'active' : ''}" type="button" role="tab" aria-selected="${defaultTab === 'description'}" data-detail-tab="description" ${description ? '' : 'disabled'}>Описание</button>
        <button class="detail-tab ${defaultTab === 'specs' ? 'active' : ''}" type="button" role="tab" aria-selected="${defaultTab === 'specs'}" data-detail-tab="specs" ${specs.length ? '' : 'disabled'}>Характеристики</button>
      </div>
      <section class="detail-tab-panel" data-detail-panel="description" role="tabpanel" ${defaultTab === 'description' ? '' : 'hidden'}>
        ${description || '<p class="detail-empty">Описание пока не добавлено.</p>'}
      </section>
      <section class="detail-tab-panel" data-detail-panel="specs" role="tabpanel" ${defaultTab === 'specs' ? '' : 'hidden'}>
        ${specs.length ? `<dl class="detail-specs">${specs.map(([label, value]) => `<div><dt>${safe(label)}</dt><dd>${safe(value)}</dd></div>`).join('')}</dl>` : '<p class="detail-empty">Характеристики пока не добавлены.</p>'}
      </section>
    </div>`;
  if (!el('#product-dialog').open) el('#product-dialog').showModal();
}

function render() {
  const result = filteredProducts();
  el('#product-grid').innerHTML = result.slice(0, state.visibleCount).map(productCard).join('');
  el('#result-count').textContent = result.length;
  el('#empty-state').hidden = result.length !== 0;
  el('#load-more').hidden = state.visibleCount >= result.length;
  el('#favorite-count').textContent = state.favorites.size;
  el('#cart-count').textContent = state.cart.length;
  el('#favorites-button').classList.toggle('selected', state.favoritesOnly);
  renderNotifications();
}

function availableNotifications() {
  const productMap = new Map(products.map(product => [String(product.id), product]));
  return waitlistRows
    .map(row => ({ row, product: productMap.get(String(row.product_id)) }))
    .filter(item => item.product?.available !== false);
}

function renderNotifications() {
  const notifications = availableNotifications();
  const unread = notifications.filter(item => !item.row.read_at);
  const counter = el('#notification-count');
  counter.textContent = unread.length;
  counter.hidden = unread.length === 0;
  el('#notification-list').innerHTML = notifications.length
    ? notifications.map(({ row, product }) => `
      <button class="notification-item" type="button" data-notification-product="${safe(product.id)}">
        <strong>${safe(row.product_title || [product.artist, product.title].filter(Boolean).join(' — '))}</strong>
        <span>Товар снова в наличии — открыть карточку</span>
      </button>`).join('')
    : '<p class="notification-empty">Новых уведомлений нет.</p>';
}

function persist() {
  localStorage.setItem('soyuz-favorites', JSON.stringify([...state.favorites]));
  localStorage.setItem('soyuz-cart', JSON.stringify(state.cart));
}

let toastTimer;
function toast(message) {
  const node = el('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 1800);
}

document.addEventListener('click', async event => {
  const favorite = event.target.closest('[data-favorite]');
  const buy = event.target.closest('[data-buy]');
  const waitlist = event.target.closest('[data-waitlist]');
  const jump = event.target.closest('[data-category-jump]');
  const detailImage = event.target.closest('[data-detail-image]');
  const detailTab = event.target.closest('[data-detail-tab]');
  const notificationProduct = event.target.closest('[data-notification-product]');
  const card = event.target.closest('[data-product]');
  if (notificationProduct) {
    el('#notification-dialog').close();
    openProduct(products.find(item => item.id === notificationProduct.dataset.notificationProduct));
    return;
  }
  if (favorite) {
    const id = favorite.dataset.favorite;
    state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id);
    persist();
    render();
    if (el('#product-dialog')?.open && openProductId === id) openProduct(products.find(item => item.id === id));
    return;
  }
  if (buy) {
    const product = products.find(item => item.id === buy.dataset.buy);
    if (!product) return;
    state.cart.push(product.id);
    persist();
    render();
    toast(`${product.artist} — добавлено в корзину`);
    return;
  }
  if (waitlist) {
    const product = products.find(item => item.id === waitlist.dataset.waitlist);
    if (!product) return;
    if (window.SOYUZ_AUTH?.isWaiting(product.id)) {
      toast('Вы уже в листе ожидания');
      return;
    }
    try {
      const added = await window.SOYUZ_AUTH?.addToWaitlist(product);
      if (added) {
        render();
        if (el('#product-dialog')?.open && openProductId === product.id) openProduct(product);
        toast('Товар добавлен в лист ожидания');
      }
    } catch (error) {
      toast(error.message);
    }
    return;
  }
  if (jump) {
    const input = document.querySelector(`input[name="category"][value="${jump.dataset.categoryJump}"]`);
    input.checked = true;
    state.category = input.value;
    state.visibleCount = 48;
    render();
    el('#catalog').scrollIntoView();
    return;
  }
  if (detailImage) {
    el('#detail-main-image').src = detailImage.dataset.detailImage;
    return;
  }
  if (detailTab && !detailTab.disabled) {
    all('[data-detail-tab]').forEach(tab => {
      const active = tab === detailTab;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    all('[data-detail-panel]').forEach(panel => {
      panel.hidden = panel.dataset.detailPanel !== detailTab.dataset.detailTab;
    });
    return;
  }
  if (card) openProduct(products.find(item => item.id === card.dataset.product));
});

document.addEventListener('keydown', event => {
  const card = event.target.closest?.('[data-product]');
  if (card && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    openProduct(products.find(item => item.id === card.dataset.product));
  }
});

all('input[name="category"]').forEach(input => input.addEventListener('change', () => {
  state.category = input.value;
  state.visibleCount = 48;
  render();
}));

function resetCategoryToAll() {
  state.category = 'all';
  state.visibleCount = 48;
  const allCategory = document.querySelector('input[name="category"][value="all"]');
  if (allCategory) allCategory.checked = true;
  if (products.length) render();
}

window.addEventListener('soyuz-auth-change', resetCategoryToAll);
window.addEventListener('soyuz-waitlist-change', event => {
  waitlistRows = event.detail?.rows || [];
  if (products.length) render();
  else renderNotifications();
});
el('#artist-filter').addEventListener('input', event => {
  state.artist = event.target.value;
  state.visibleCount = 48;
  renderArtistList(event.target.value);
  setArtistDropdown(true);
  render();
});
el('#artist-filter').addEventListener('focus', () => {
  renderArtistList();
  setArtistDropdown(true);
});
el('#artist-filter').addEventListener('keydown', event => {
  if (event.key === 'Escape') setArtistDropdown(false);
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    setArtistDropdown(true);
    el('#artist-dropdown .artist-option')?.focus();
  }
});
el('#artist-dropdown').addEventListener('click', event => {
  const option = event.target.closest('[data-artist]');
  if (!option) return;
  state.artist = option.dataset.artist;
  state.visibleCount = 48;
  el('#artist-filter').value = state.artist;
  setArtistDropdown(false);
  render();
});
document.addEventListener('click', event => {
  if (!event.target.closest('.artist-combobox')) setArtistDropdown(false);
});
el('#stock-only').addEventListener('change', event => {
  state.stockOnly = event.target.checked;
  state.visibleCount = 48;
  render();
});
el('#price-range').addEventListener('input', event => {
  state.maxPrice = Number(event.target.value);
  state.visibleCount = 48;
  el('#price-output').textContent = money(state.maxPrice);
  render();
});
el('#sort-select').addEventListener('change', event => {
  state.sort = event.target.value;
  state.visibleCount = 48;
  render();
});
el('#search-form').addEventListener('submit', event => {
  event.preventDefault();
  state.search = el('#header-search').value.trim();
  state.category = 'all';
  state.artist = '';
  state.stockOnly = false;
  state.maxPrice = Number(el('#price-range').max);
  state.favoritesOnly = false;
  state.visibleCount = 48;
  el('#artist-filter').value = '';
  el('#stock-only').checked = false;
  el('#price-range').value = state.maxPrice;
  el('#price-output').textContent = money(state.maxPrice);
  document.querySelector('input[name="category"][value="all"]').checked = true;
  setArtistDropdown(false);
  render();
  el('#catalog').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
el('#header-search').addEventListener('input', event => {
  if (event.target.value || !state.search) return;
  state.search = '';
  state.visibleCount = 48;
  render();
});
el('#favorites-button').addEventListener('click', () => {
  state.favoritesOnly = !state.favoritesOnly;
  state.visibleCount = 48;
  render();
  el('#catalog').scrollIntoView();
});
el('#theme-toggle').addEventListener('click', () => {
  const nextTheme = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem('soyuz-theme', nextTheme);
  renderThemeToggle();
});
themeMedia.addEventListener('change', () => {
  if (!document.documentElement.dataset.theme) renderThemeToggle();
});
renderThemeToggle();
function resetFilters() {
  const maxPrice = Number(el('#price-range').max);
  state.search = '';
  state.category = 'all';
  state.artist = '';
  state.stockOnly = false;
  state.maxPrice = maxPrice;
  state.favoritesOnly = false;
  state.visibleCount = 48;
  el('#header-search').value = '';
  el('#artist-filter').value = '';
  el('#stock-only').checked = false;
  el('#price-range').value = maxPrice;
  el('#price-output').textContent = money(maxPrice);
  document.querySelector('input[name="category"][value="all"]').checked = true;
  render();
}
document.querySelectorAll('[data-reset-filters]').forEach(button => button.addEventListener('click', resetFilters));
el('#filter-toggle').addEventListener('click', () => el('#filters').classList.toggle('open'));
el('#load-more').addEventListener('click', () => {
  state.visibleCount += 48;
  render();
});
el('.menu-toggle').addEventListener('click', event => {
  const open = el('#main-nav').classList.toggle('open');
  event.currentTarget.setAttribute('aria-expanded', String(open));
});

function renderCart() {
  const counts = state.cart.reduce((acc, id) => ((acc[id] = (acc[id] || 0) + 1), acc), {});
  const lines = Object.entries(counts).map(([id, count]) => {
    const product = products.find(item => item.id === id);
    if (!product) return '';
    return `<div class="cart-line"><span><b>${safe(product.artist)}</b><br><small>${safe(product.title)}</small></span><span>${count} × ${money(product.price)}</span><button type="button" data-remove="${safe(id)}">Удалить</button></div>`;
  });
  el('#cart-items').innerHTML = lines.join('') || '<p>Корзина пока пуста.</p>';
  el('#cart-total').textContent = money(state.cart.reduce((sum, id) => sum + (products.find(product => product.id === id)?.price || 0), 0));
}

el('#cart-button').addEventListener('click', () => {
  renderCart();
  el('#cart-dialog').showModal();
});
el('#notification-button').addEventListener('click', async () => {
  if (!window.SOYUZ_AUTH?.getSession()?.access_token) {
    el('#account-button').click();
    return;
  }
  renderNotifications();
  el('#notification-dialog').showModal();
  const unreadIds = availableNotifications().filter(item => !item.row.read_at).map(item => item.row.id);
  if (unreadIds.length) {
    try { await window.SOYUZ_AUTH.markNotificationsRead(unreadIds); } catch (error) { console.error(error); }
  }
});
el('.notification-close').addEventListener('click', () => el('#notification-dialog').close());
el('.notification-home').addEventListener('click', () => {
  el('#notification-dialog').close();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
el('.cart-dialog .close-button').addEventListener('click', () => el('#cart-dialog').close());
el('.product-close').addEventListener('click', () => el('#product-dialog').close());
el('#cart-items').addEventListener('click', event => {
  const remove = event.target.closest('[data-remove]');
  if (!remove) return;
  const index = state.cart.indexOf(remove.dataset.remove);
  if (index >= 0) state.cart.splice(index, 1);
  persist();
  render();
  renderCart();
});
el('.checkout-button').addEventListener('click', () => toast('Ozon Pay будет подключён после получения токена'));
el('#year').textContent = new Date().getFullYear();

async function loadProducts() {
  try {
    const [response, overridesResponse] = await Promise.all([
      fetch('products.json'),
      fetch(`admin-overrides.json?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null)
    ]);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const baseProducts = await response.json();
    const overrides = overridesResponse?.ok
      ? await overridesResponse.json()
      : { items: {}, added: [], deleted: [] };
    const deleted = new Set((overrides.deleted || []).map(String));
    const itemOverrides = overrides.items || {};
    products = baseProducts
      .filter(product => !deleted.has(String(product.id)))
      .map(product => ({ ...product, ...(itemOverrides[String(product.id)] || {}) }));
    const positions = new Map(products.map((product, index) => [String(product.id), index]));
    (overrides.added || []).forEach(product => {
      const id = String(product.id || '');
      if (!id || deleted.has(id)) return;
      if (positions.has(id)) products[positions.get(id)] = product;
      else {
        positions.set(id, products.length);
        products.push(product);
      }
    });
    const validIds = new Set(products.map(product => product.id));
    state.cart = state.cart.filter(id => validIds.has(id));
    state.favorites = new Set([...state.favorites].filter(id => validIds.has(id)));
    const counts = products.reduce((acc, product) => {
      acc[product.category] = (acc[product.category] || 0) + 1;
      return acc;
    }, {});
    all('[data-count]').forEach(node => {
      node.textContent = node.dataset.count === 'all' ? products.length : (counts[node.dataset.count] || 0);
    });
    const canonicalArtists = new Map();
    products.forEach(product => {
      const artist = String(product.artist || '').trim();
      if (!artist) return;
      const key = normalizeSearchText(artist);
      const current = canonicalArtists.get(key);
      if (!current || artistNameScore(artist) > artistNameScore(current)) canonicalArtists.set(key, artist);
    });
    products.forEach(product => {
      const key = normalizeSearchText(product.artist);
      if (key && canonicalArtists.has(key)) product.artist = canonicalArtists.get(key);
    });
    artistNames = [...canonicalArtists.values()]
      .sort((a, b) => a.localeCompare(b, 'ru', { sensitivity: 'base' }));
    renderArtistList();
    const maxPrice = Math.ceil(Math.max(...products.map(product => product.price), 1000) / 5000) * 5000;
    el('#price-range').max = maxPrice;
    el('#price-range').value = maxPrice;
    state.maxPrice = maxPrice;
    el('#price-output').textContent = money(maxPrice);
    persist();
    render();
  } catch (error) {
    el('#product-grid').innerHTML = '<p class="loading">Не удалось загрузить каталог. Обновите страницу.</p>';
    console.error(error);
  }
}

loadProducts();
