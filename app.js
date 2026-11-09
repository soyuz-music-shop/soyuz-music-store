// V42: editor-curated new-release carousel. Product ids are links only;
// slide artwork is a separately uploaded PNG, never a product photo from Ozon.
let featuredConfig = null;
let featuredPage = 0;
let featuredTimer = null;
let featuredProductsById = new Map();

function featuredPageSize() {
  return window.innerWidth < 700 ? 1 : (window.innerWidth < 960 ? 2 : 3);
}

function visibleFeaturedSlides() {
  const config = featuredConfig;
  if (!config?.enabled || !Array.isArray(config.slides)) return [];
  return config.slides.filter(slide => /^new-release-images\/[a-zA-Z0-9._-]+\.png$/.test(slide.image || '')
    && featuredProductsById.has(String(slide.productId)) && slide.productId).map(slide => ({
      product: featuredProductsById.get(String(slide.productId)),
      image: slide.image,
      optimizedImage: /^new-release-images\/[a-zA-Z0-9._-]+\.webp$/.test(slide.optimizedImage || '') ? slide.optimizedImage : '',
      // Existing v42/v43 slides have no editable labels: use the COMPLETE catalog strings.
      artist: typeof slide.artist === 'string' ? slide.artist : null,
      title: typeof slide.title === 'string' ? slide.title : null,
      text: typeof slide.text === 'string' ? slide.text : ''
    }));
}

function stopFeaturedTimer() {
  if (featuredTimer) clearInterval(featuredTimer);
  featuredTimer = null;
}

function renderFeaturedCarousel() {
  const section = document.querySelector('#new-carousel');
  if (!section) return;
  const slides = visibleFeaturedSlides();
  section.hidden = !slides.length;
  stopFeaturedTimer();
  if (!slides.length) return;
  el('#featured-carousel-title').textContent = String(featuredConfig.title || 'Новинки');
  el('#featured-carousel-subtitle').textContent = String(featuredConfig.text || featuredConfig.subtitle || '');
  el('#featured-carousel-subtitle').hidden = !(featuredConfig.text || featuredConfig.subtitle);
  const pageSize = featuredPageSize();
  const pageCount = Math.ceil(slides.length / pageSize);
  featuredPage = Math.max(0, Math.min(featuredPage, pageCount - 1));
  const slice = slides.slice(featuredPage * pageSize, (featuredPage + 1) * pageSize);
  // v45: fill the entire carousel width with the cards on the CURRENT page,
  // including partially filled last pages (1 or 2 items of a 3-item page).
  const featuredGrid = el('#featured-items');
  featuredGrid.style.setProperty('--featured-visible-columns', String(slice.length));
  featuredGrid.dataset.visibleCount = String(slice.length);
  featuredGrid.innerHTML = slice.map(({product,image,optimizedImage,artist,title,text}) => {
    // Do NOT use productDisplayName(): it splits off bracketed details.
    // Editing only changes carousel presentation, never product data or its link.
    const slideArtist = artist === null ? String(product.artist || '').trim() : artist;
    const slideTitle = title === null ? String(product.title || '').trim() : title;
    const slideText = String(text || '');
    const responsiveImage = optimizedImage
      ? `<picture><source srcset="${safe(optimizedImage)}" type="image/webp"><img src="${safe(image)}" alt="" loading="lazy" decoding="async"></picture>`
      : `<img src="${safe(image)}" alt="" loading="lazy" decoding="async">`;
    return `<button class="featured-item" type="button" data-featured-product="${safe(product.id)}" aria-label="Открыть карточку: ${safe(slideArtist)} — ${safe(slideTitle)}">
      <span class="featured-image">${responsiveImage}</span>
      <span class="featured-item-text"><strong class="featured-item-artist">${safe(slideArtist)}</strong><span class="featured-item-album">${safe(slideTitle)}</span>${slideText ? `<span class="featured-item-description">${safe(slideText)}</span>` : ''}</span>
    </button>`;
  }).join('');
  const dots = el('#featured-pagination');
  dots.innerHTML = Array.from({length: pageCount},(_,i) => `<button class="featured-dot" type="button" data-featured-page="${i}" aria-label="Страница ${i+1}" aria-current="${featuredPage===i}"></button>`).join('');
  el('#featured-prev').disabled = pageCount < 2;
  el('#featured-next').disabled = pageCount < 2;
  if (featuredConfig.autoplay && pageCount > 1 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches && !document.hidden) {
    const seconds = Math.min(20, Math.max(3, Number(featuredConfig.intervalSeconds) || 5));
    featuredTimer = setInterval(() => { featuredPage = (featuredPage + 1) % pageCount; renderFeaturedCarousel(); }, seconds * 1000);
  }
}

// v47: vertical scrolling stays native; a deliberate horizontal touch swipe changes pages.
// No third-party slider, no extra downloads and no accidental product opening after a swipe.
(() => {
  const track = document.querySelector('#featured-items');
  if (!track) return;
  let start = null;
  let ignoreClick = false;
  track.addEventListener('touchstart', event => {
    if (event.touches.length !== 1) { start = null; return; }
    const touch = event.touches[0];
    start = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });
  track.addEventListener('touchcancel', () => { start = null; }, { passive: true });
  track.addEventListener('touchend', event => {
    if (!start || event.changedTouches.length !== 1) { start = null; return; }
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    start = null;
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    const pages = Math.ceil(visibleFeaturedSlides().length / featuredPageSize());
    if (pages < 2) return;
    ignoreClick = true;
    setTimeout(() => { ignoreClick = false; }, 450);
    featuredPage = (featuredPage + (dx < 0 ? 1 : -1) + pages) % pages;
    renderFeaturedCarousel();
  }, { passive: true });
  track.addEventListener('click', event => {
    if (!ignoreClick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    ignoreClick = false;
  }, true);
})();

document.addEventListener('click', event => {
  const item = event.target.closest('[data-featured-product]');
  if (item) {
    const product = products.find(product => String(product.id) === item.dataset.featuredProduct);
    if (product) openProduct(product);
    return;
  }
  const page = event.target.closest('[data-featured-page]');
  if (page) { featuredPage = Number(page.dataset.featuredPage); renderFeaturedCarousel(); return; }
  if (event.target.closest('#featured-prev') || event.target.closest('#featured-next')) {
    const totalPages = Math.ceil(visibleFeaturedSlides().length / featuredPageSize());
    if (totalPages < 2) return;
    featuredPage = (featuredPage + (event.target.closest('#featured-next') ? 1 : -1) + totalPages) % totalPages;
    renderFeaturedCarousel();
  }
});
window.addEventListener('resize', () => {
  const current = featuredPageSize();
  if (current !== window.soyuzFeaturedPageSize) { window.soyuzFeaturedPageSize = current; featuredPage = 0; renderFeaturedCarousel(); }
});
document.addEventListener('visibilitychange', () => {
  // Pause offscreen rotation without reconstructing the cards or refetching assets.
  if (document.hidden) stopFeaturedTimer();
  else if (featuredConfig?.autoplay) renderFeaturedCarousel();
});

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
  edition: 'all',
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
const NEW_PRODUCT_WINDOW_DAYS = 7;

function isRecentlyPublished(value, windowDays = NEW_PRODUCT_WINDOW_DAYS) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return false;
  const publishedDay = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const ageDays = Math.floor((today - publishedDay) / 86400000);
  return ageDays >= 0 && ageDays <= windowDays;
}
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

function productDisplayName(product) {
  const artist = splitProductTitle(product.artist);
  const title = splitProductTitle(product.title);
  return {
    artist: artist.main,
    title: title.main,
    details: [artist.details, title.details].filter(Boolean).join(' ')
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

function editionMatches(product, selection) {
  if (selection === 'all') return true;
  // Edition classification is sourced only from the catalog's "Издание" spec.
  // Semicolon-combined values such as "Импортное;Коллекционное" are supported.
  const editions = String(product.specs?.['Издание'] || '')
    .split(/[;,|]/)
    .map(value => value.trim().toLocaleLowerCase('ru'));
  return editions.includes(selection === 'import' ? 'импортное' : 'российское');
}

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
      && editionMatches(product, state.edition)
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
  const displayName = productDisplayName(product);
  const badge = product.badge && product.badge !== 'Новинка'
    ? product.badge
    : (isRecentlyPublished(product.publishedAt) ? 'Новинка' : '');
  return `<article class="product-card" data-category="${safe(product.category)}" data-product="${safe(product.id)}" tabindex="0" aria-label="Подробнее: ${safe(displayName.artist)} — ${safe(displayName.title)}">
    <div class="cover ${product.image ? 'has-image' : ''}" style="--cover:${categoryColor[product.category]}" data-mark="${safe(product.artist)}">
      ${cover}
      ${badge ? `<span class="badge">${safe(badge)}</span>` : ''}
    </div>
    <div class="product-info">
      <div class="product-title-row"><div class="product-title-copy"><h3>${safe(displayName.artist)}</h3>${displayName.title ? `<h4>${safe(displayName.title)}</h4>` : ''}</div><button class="favorite-button ${favorite ? 'active' : ''}" type="button" data-favorite="${safe(product.id)}" aria-label="${favorite ? 'Убрать из избранного' : 'Добавить в избранное'}">${favorite ? '♥' : '♡'}</button></div>
      ${displayName.details ? `<p class="album-details">${safe(displayName.details)}</p>` : '<p class="album-details empty" aria-hidden="true"></p>'}
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
  const displayName = productDisplayName(product);
  const defaultTab = description ? 'description' : 'specs';
  el('#product-detail').innerHTML = `
    <div class="detail-gallery">
      ${images[0] ? `<img class="detail-main-image" id="detail-main-image" src="${safe(images[0])}" alt="${safe(displayName.title || displayName.artist)}">` : '<div class="detail-image-placeholder">Нет изображения</div>'}
      ${images.length > 1 ? `<div class="detail-thumbnails">${images.slice(0, 10).map((image, index) => `<button type="button" data-detail-image="${safe(image)}" aria-label="Показать фото ${index + 1}"><img src="${safe(image)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
    </div>
    <div class="detail-content">
      <p class="eyebrow">${safe(categoryName[product.category] || 'Товар')}</p>
      <h2>${safe(displayName.artist)}</h2>
      ${displayName.title ? `<p class="detail-title">${safe(displayName.title)}</p>` : ''}
      ${displayName.details ? `<p class="album-details detail-name-details">${safe(displayName.details)}</p>` : ''}
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
  el('#favorites-back').hidden = !state.favoritesOnly;
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
      if (!window.SOYUZ_AUTH?.getSession()?.access_token) {
        window.SOYUZ_AUTH?.requestWaitlistAfterLogin(product);
        return;
      }
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
all('input[name="edition"]').forEach(input => input.addEventListener('change', () => {
  state.edition = input.value;
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
  state.edition = 'all';
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
  document.querySelector('input[name="edition"][value="all"]').checked = true;
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
el('#favorites-back').addEventListener('click', () => {
  state.favoritesOnly = false;
  state.visibleCount = 48;
  render();
  el('#catalog').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  state.edition = 'all';
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
  document.querySelector('input[name="edition"][value="all"]').checked = true;
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
    const displayName = productDisplayName(product);
    const secondary = [displayName.title, displayName.details].filter(Boolean).join(' ');
    return `<div class="cart-line"><span><b>${safe(displayName.artist)}</b>${secondary ? `<br><small>${safe(secondary)}</small>` : ''}</span><span>${count} × ${money(product.price)}</span><button type="button" data-remove="${safe(id)}">Удалить</button></div>`;
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
    featuredProductsById = new Map(products.map(product => [String(product.id), product]));
    const maxPrice = Math.ceil(Math.max(...products.map(product => product.price), 1000) / 5000) * 5000;
    el('#price-range').max = maxPrice;
    el('#price-range').value = maxPrice;
    state.maxPrice = maxPrice;
    el('#price-output').textContent = money(maxPrice);
    persist();
    render();
    renderFeaturedCarousel();
  } catch (error) {
    el('#product-grid').innerHTML = '<p class="loading">Не удалось загрузить каталог. Обновите страницу.</p>';
    console.error(error);
  }
}

async function loadSiteContent() {
  try {
    const response = await fetch(`site-content.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return;
    const content = await response.json();
    featuredConfig = content.newReleases || null;
    featuredPage = 0;
    renderFeaturedCarousel();
    const about = content.about || {};
    const aboutSection = el('#about');
    const headingSize = Math.min(88, Math.max(28, Number(about.headingFontSize) || 72));
    const bodySize = Math.min(28, Math.max(14, Number(about.bodyFontSize) || 22));
    aboutSection.style.setProperty('--about-heading-size', `${headingSize}px`);
    aboutSection.style.setProperty('--about-body-size', `${bodySize}px`);
    if (about.eyebrow) el('#about-eyebrow').textContent = about.eyebrow;
    if (about.heading) {
      const heading = el('#about-title');
      heading.textContent = '';
      String(about.heading).split(/\r?\n/).forEach((line, index, lines) => {
        const match = line.match(/^(.*?)(SOYUZ MUSIC\.?)$/i);
        if (match) {
          heading.append(document.createTextNode(match[1]));
          const emphasis = document.createElement('em');
          emphasis.textContent = match[2];
          heading.append(emphasis);
        } else {
          heading.append(document.createTextNode(line));
        }
        if (index < lines.length - 1) heading.append(document.createElement('br'));
      });
    }
    if (Array.isArray(about.paragraphs) && about.paragraphs.length) {
      const copy = el('#about-copy');
      copy.textContent = '';
      about.paragraphs.forEach((text, index) => {
        const paragraph = document.createElement('p');
        if (index === about.paragraphs.length - 1) paragraph.className = 'about-signature';
        String(text).split(/\r?\n/).forEach((line, lineIndex, lines) => {
          paragraph.append(document.createTextNode(line));
          if (lineIndex < lines.length - 1) paragraph.append(document.createElement('br'));
        });
        copy.append(paragraph);
      });
    }
  } catch (error) {
    console.error(error);
  }
}

loadSiteContent();
loadProducts();
